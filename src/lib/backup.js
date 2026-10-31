import { validStableId } from "./stores.js";
import { sanitizeSettings, getSettings } from "./settings.js";
import { getActions, sanitizeActions } from "./actions.js";
import { writeLocal } from "./storage.js";
import { mutate } from "./queue.js";
import { MAX_BACKUP_BYTES, MAX_HISTORY_ITEMS } from "./constants.js";
import { getHistoryEntries, getLatestPromotionEntries, sanitizePromotionEntry } from "./history.js";
import { buildPromotionIdentity } from "./dedupe.js";

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const recency = (entry) => Math.max(entry.lastSeenAt, entry.firstSeenAt, entry.lastStateChangeAt);

// One record per store offer/type, matching live history. Local records win
// duplicates; keep the most recent records within the existing history cap.
export function mergeBackupHistory(preferred, incoming = []) {
  const map = new Map();
  for (const raw of [...preferred, ...incoming]) {
    if (!validStableId(raw?.stableId)) continue;
    const entry = sanitizePromotionEntry(raw);
    const id = buildPromotionIdentity(entry);
    if (!map.has(id)) map.set(id, { ...entry, id });
  }
  return [...map.values()].sort((a, b) => recency(b) - recency(a)).slice(0, MAX_HISTORY_ITEMS);
}

export async function exportBackup({ includeHistory = true } = {}) {
  return mutate(async () => {
    const backup = {
      format: "steam-promo-watch",
      version: 3,
      exportedAt: new Date().toISOString(),
      settings: await getSettings(),
      userActions: await getActions(),
    };
    if (includeHistory) {
      backup.history = mergeBackupHistory(await getLatestPromotionEntries(), await getHistoryEntries());
      // Transfer visible history, not the receiving installation's delivery guard.
      backup.history = backup.history.map(({ importedAt, ...entry }) => entry);
    }
    validateBackup(JSON.stringify(backup, null, 2));
    return backup;
  });
}

function validateHistory(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_HISTORY_ITEMS) throw new Error("invalidBackup");
  return raw.map((entry) => {
    if (!isObject(entry) || !validStableId(entry.stableId)
      || entry.promoType !== "free-to-keep" || typeof entry.title !== "string"
      || !entry.title.trim() || entry.title.length > 300
      || !["active", "expired", "dismissed"].includes(entry.status)) throw new Error("invalidBackup");
    for (const key of ["startsAt", "endsAt", "firstSeenAt", "lastSeenAt", "lastCheckedAt", "lastNotifiedAt", "lastStateChangeAt"]) {
      if (entry[key] !== undefined && (!Number.isFinite(entry[key]) || entry[key] < 0 || entry[key] > 8640000000000000)) throw new Error("invalidBackup");
    }
    for (const key of ["campaignId", "fingerprint"]) {
      if (entry[key] !== undefined && (typeof entry[key] !== "string" || entry[key].length > 200)) throw new Error("invalidBackup");
    }
    const clean = sanitizePromotionEntry({ ...entry, store: undefined, importedAt: 0 });
    const id = buildPromotionIdentity(clean);
    const campaignId = clean.campaignId || id;
    return { ...clean, id, campaignId, fingerprint: campaignId };
  });
}

export function validateBackup(input) {
  let text, data;
  try {
    text = typeof input === "string" ? input : JSON.stringify(input);
    if (!text || text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error();
    data = JSON.parse(text);
  } catch {
    throw new Error("invalidBackup");
  }
  if (data?.format !== "steam-promo-watch" || ![1, 2, 3].includes(data.version)) throw new Error("unsupportedBackup");
  if (!isObject(data.settings) || !isObject(data.userActions)
    || Object.keys(data.userActions).length > 2000
    || Object.entries(data.userActions).some(([key, value]) => !validStableId(key) || !isObject(value))) throw new Error("invalidBackup");
  const hasHistory = data.version === 3 && Object.hasOwn(data, "history");
  return {
    settings: sanitizeSettings(data.settings),
    userActions: sanitizeActions(data.userActions),
    exportedAt: typeof data.exportedAt === "string" && Number.isFinite(Date.parse(data.exportedAt)) ? data.exportedAt : "",
    hasHistory,
    history: hasHistory ? mergeBackupHistory(validateHistory(data.history)) : [],
  };
}

export async function importBackup(input, { includeHistory = true } = {}) {
  const data = validateBackup(input);
  return mutate(async () => {
    const now = Date.now();
    const values = { settings: data.settings, userActions: data.userActions, metadataCache: {} };
    if (includeHistory && data.hasHistory) {
      const latest = await getLatestPromotionEntries();
      const local = await getHistoryEntries();
      const existing = new Set([...latest, ...local].map(buildPromotionIdentity));
      const imported = data.history.map((entry) => ({
        ...entry, importedAt: now, unread: false, stale: true,
        status: entry.confirmedEnded || (entry.endsAt && entry.endsAt <= now) ? "expired" : entry.status,
      }));
      values.history = mergeBackupHistory([...latest, ...local], imported);
      for (const entry of imported) {
        if (!existing.has(entry.id) && values.userActions[entry.stableId])
          values.userActions[entry.stableId].snoozePending = false;
      }
    }
    await writeLocal(values);
    return { ok: true, settings: data.settings, count: Object.keys(data.userActions).length };
  });
}
