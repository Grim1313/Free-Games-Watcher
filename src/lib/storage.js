import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from "./constants.js";

export async function readLocal(keys = null) {
  return chrome.storage.local.get(keys);
}

export async function writeLocal(values) {
  await chrome.storage.local.set(values);
  return values;
}

export async function removeLocal(keys) {
  await chrome.storage.local.remove(keys);
}

export async function readKey(key, fallback) {
  const result = await chrome.storage.local.get(key);
  return Object.prototype.hasOwnProperty.call(result, key)
    ? result[key]
    : fallback;
}

export async function updateKey(key, fallback, updater) {
  const current = await readKey(key, fallback);
  const next = await updater(current);
  await writeLocal({ [key]: next });
  return next;
}

export async function ensureSchemaVersion() {
  const current = await readKey(STORAGE_KEYS.schemaVersion, 0);
  if (current > STORAGE_SCHEMA_VERSION) throw new Error("unsupportedBackup");
  if (current === STORAGE_SCHEMA_VERSION) return;
  const data = await readLocal();
  const canonical = (entry) =>
    `${entry.stableId}|${entry.promoType || "free-to-keep"}`;
  const migrateEntries = (entries = []) => {
    const merged = new Map();
    for (const entry of entries) {
      if (!/^(app|sub):\d+$/.test(entry.stableId || "")) continue;
      const id = canonical(entry);
      const previous = merged.get(id);
      const next = {
        ...entry,
        id,
        campaignId: id,
        fingerprint: id,
        status:
          entry.status === "dismissed"
            ? entry.lastSeenAt === entry.lastCheckedAt
              ? "active"
              : "expired"
            : entry.status,
      };
      if (!previous || next.lastSeenAt > previous.lastSeenAt)
        merged.set(id, next);
    }
    return [...merged.values()];
  };
  const notified = {};
  for (const [id, record] of Object.entries(data.notifiedPromotions || {})) {
    const key = id.split("|").slice(0, 2).join("|");
    if (!notified[key] || record.lastNotifiedAt > notified[key].lastNotifiedAt)
      notified[key] = { ...record, fingerprint: key };
  }
  const userActions = { ...(data.userActions || {}) };
  for (const record of Object.values(data.dismissedPromotions || {})) {
    if (/^(app|sub):\d+$/.test(record.stableId || ""))
      userActions[record.stableId] = {
        ...userActions[record.stableId],
        ignored: true,
        title: record.title,
        updatedAt: record.dismissedAt,
      };
  }
  await writeLocal({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    history: migrateEntries(data.history),
    latestPromotions: migrateEntries(data.latestPromotions),
    notifiedPromotions: notified,
    userActions,
    dismissedPromotions: {},
    metadataCache: {},
  });
}
