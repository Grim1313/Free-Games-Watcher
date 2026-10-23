import {
  CONTENT_TYPES,
  ENTRY_STATUS,
  MAX_HISTORY_ITEMS,
  MAX_LATEST_ITEMS,
  NOTIFICATION_STATUS,
  PROMO_TYPES,
  STORAGE_KEYS,
} from "./constants.js";
import { readKey } from "./storage.js";
import {
  buildSteamUrlFromStableId,
  daysToMs,
  normalizeWhitespace,
  safeArray,
  safeNumber,
  sanitizeSteamAssetUrl,
  sanitizeSteamReviewSummary,
  sanitizeSteamUrl,
} from "./utils.js";

function getPromotionMatchKey(promotion) {
  const stableId =
    typeof promotion?.stableId === "string" ? promotion.stableId : "";
  const promoType =
    typeof promotion?.promoType === "string" ? promotion.promoType : "";
  if (stableId && promoType) {
    return `${stableId}|${promoType}`;
  }

  const appId = safeNumber(promotion?.appId, 0);
  const packageId = safeNumber(promotion?.packageId, 0);
  const numericKey =
    appId > 0 ? `app:${appId}` : packageId > 0 ? `sub:${packageId}` : "";
  return numericKey && promoType ? `${numericKey}|${promoType}` : "";
}

export function sanitizePromotionEntry(raw = {}) {
  const source = typeof raw === "object" && raw ? raw : {};
  const reviewSummary = sanitizeSteamReviewSummary(source);
  return {
    campaignId: typeof source.campaignId === "string" ? source.campaignId : "",
    genres: Array.isArray(source.genres) ? source.genres.map(String) : [],
    platforms: Array.isArray(source.platforms)
      ? source.platforms.map(String)
      : [],
    stale: Boolean(source.stale),
    missingCount: safeNumber(source.missingCount, 0),
    confirmedEnded: Boolean(source.confirmedEnded),
    region: typeof source.region === "string" ? source.region : "US",
    id: typeof source.id === "string" ? source.id : "",
    fingerprint:
      typeof source.fingerprint === "string" ? source.fingerprint : "",
    stableId: typeof source.stableId === "string" ? source.stableId : "",
    appId: safeNumber(source.appId, 0),
    packageId: safeNumber(source.packageId, 0),
    title: typeof source.title === "string" ? source.title : "",
    promoType:
      typeof source.promoType === "string" ? source.promoType : "free-to-keep",
    rawTypeLabel:
      typeof source.rawTypeLabel === "string" ? source.rawTypeLabel : "",
    contentType:
      typeof source.contentType === "string" ? source.contentType : "unknown",
    basePriceFormatted:
      typeof source.basePriceFormatted === "string"
        ? normalizeWhitespace(source.basePriceFormatted).slice(0, 64)
        : "",
    url: sanitizeSteamUrl(
      source.url || buildSteamUrlFromStableId(source.stableId),
    ),
    headerImage: sanitizeSteamAssetUrl(source.headerImage),
    capsuleImage: sanitizeSteamAssetUrl(source.capsuleImage),
    screenshotThumbnail: sanitizeSteamAssetUrl(source.screenshotThumbnail),
    screenshotFull: sanitizeSteamAssetUrl(source.screenshotFull),
    ...reviewSummary,
    sourceId: typeof source.sourceId === "string" ? source.sourceId : "",
    sourceFingerprint:
      typeof source.sourceFingerprint === "string"
        ? source.sourceFingerprint
        : "",
    startsAt: safeNumber(source.startsAt, 0),
    endsAt: safeNumber(source.endsAt, 0),
    firstSeenAt: safeNumber(source.firstSeenAt, 0),
    lastSeenAt: safeNumber(source.lastSeenAt, 0),
    lastCheckedAt: safeNumber(source.lastCheckedAt, 0),
    lastNotifiedAt: safeNumber(source.lastNotifiedAt, 0),
    unread: Boolean(source.unread),
    status:
      typeof source.status === "string" ? source.status : ENTRY_STATUS.ACTIVE,
    notificationStatus:
      typeof source.notificationStatus === "string"
        ? source.notificationStatus
        : NOTIFICATION_STATUS.PENDING,
    lastStateChangeAt: safeNumber(source.lastStateChangeAt, 0),
  };
}

export function sanitizePromotionEntries(raw) {
  return safeArray(raw)
    .map((entry) => sanitizePromotionEntry(entry))
    .filter((entry) => entry.id);
}

export async function getHistoryEntries() {
  const stored = await readKey(STORAGE_KEYS.history, []);
  return sanitizePromotionEntries(stored);
}

export async function getLatestPromotionEntries() {
  const stored = await readKey(STORAGE_KEYS.latestPromotions, []);
  return sanitizePromotionEntries(stored);
}

export function mergePromotionEntries(
  existingEntries,
  promotions,
  nowTs,
  options = {},
) {
  const currentMap = new Map(
    sanitizePromotionEntries(existingEntries).map((entry) => [entry.id, entry]),
  );
  const activeIds = new Set();
  const newEntries = [];
  const merged = [];

  for (const promotion of promotions) {
    activeIds.add(promotion.id);
    const existing = currentMap.get(promotion.id);
    const isChangedCycle =
      !existing || existing.fingerprint !== promotion.fingerprint;
    const next = sanitizePromotionEntry({
      ...existing,
      ...promotion,
      firstSeenAt: isChangedCycle ? nowTs : existing?.firstSeenAt || nowTs,
      lastSeenAt: nowTs,
      lastCheckedAt: nowTs,
      lastStateChangeAt: isChangedCycle
        ? nowTs
        : existing?.lastStateChangeAt || nowTs,
      unread: isChangedCycle ? true : Boolean(existing?.unread),
      status:
        promotion.endsAt > 0 && promotion.endsAt <= nowTs
          ? ENTRY_STATUS.EXPIRED
          : ENTRY_STATUS.ACTIVE,
      stale: false,
      missingCount: 0,
      notificationStatus: isChangedCycle
        ? NOTIFICATION_STATUS.PENDING
        : existing?.notificationStatus || NOTIFICATION_STATUS.PENDING,
    });
    if (isChangedCycle) {
      newEntries.push(next);
    }
    merged.push(next);
  }

  for (const entry of currentMap.values()) {
    if (activeIds.has(entry.id)) {
      continue;
    }
    const expired = sanitizePromotionEntry({
      ...entry,
      status:
        entry.status === ENTRY_STATUS.DISMISSED
          ? ENTRY_STATUS.DISMISSED
          : options.confirmedEnded?.has(entry.stableId) ||
              (entry.endsAt > 0 && entry.endsAt <= nowTs)
            ? ENTRY_STATUS.EXPIRED
            : entry.status,
      stale: true,
      confirmedEnded:
        options.confirmedEnded?.has(entry.stableId) || entry.confirmedEnded,
      missingCount: entry.missingCount + (options.complete ? 1 : 0),
      lastCheckedAt: nowTs,
    });
    merged.push(expired);
  }

  merged.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === ENTRY_STATUS.ACTIVE ? -1 : 1;
    }
    return right.firstSeenAt - left.firstSeenAt;
  });

  const retentionDays = options.retentionDays || 30;
  const maxItems = options.maxItems || MAX_HISTORY_ITEMS;
  const cutoff = nowTs - daysToMs(retentionDays);

  const pruned = merged
    .filter((entry) => {
      if (entry.status === ENTRY_STATUS.ACTIVE) {
        return true;
      }
      return Math.max(entry.lastSeenAt, entry.firstSeenAt) >= cutoff;
    })
    .slice(0, maxItems);

  return {
    entries: pruned,
    newEntries,
  };
}

export function markEntriesRead(entries) {
  return sanitizePromotionEntries(entries).map((entry) => ({
    ...entry,
    unread: false,
  }));
}

export function dismissEntry(entries, id, nowTs, matchKey = "") {
  return sanitizePromotionEntries(entries).map((entry) => {
    if (
      entry.id !== id &&
      (!matchKey || getPromotionMatchKey(entry) !== matchKey)
    ) {
      return entry;
    }
    return {
      ...entry,
      status: ENTRY_STATUS.DISMISSED,
      notificationStatus: NOTIFICATION_STATUS.DISMISSED,
      unread: false,
      lastStateChangeAt: nowTs,
    };
  });
}

export function restoreEntry(
  entries,
  id,
  nowTs,
  notifiedMap = {},
  matchKey = "",
) {
  const sourceNotifiedMap =
    typeof notifiedMap === "object" && notifiedMap ? notifiedMap : {};
  return sanitizePromotionEntries(entries).map((entry) => {
    if (
      entry.id !== id &&
      (!matchKey || getPromotionMatchKey(entry) !== matchKey)
    ) {
      return entry;
    }

    const notifiedRecord = sourceNotifiedMap[entry.id];
    const isCurrentlyActive =
      entry.lastSeenAt > 0 && entry.lastSeenAt === entry.lastCheckedAt;
    return {
      ...entry,
      status: isCurrentlyActive ? ENTRY_STATUS.ACTIVE : ENTRY_STATUS.EXPIRED,
      notificationStatus:
        notifiedRecord?.fingerprint === entry.fingerprint
          ? NOTIFICATION_STATUS.SENT
          : NOTIFICATION_STATUS.PENDING,
      unread: false,
      lastStateChangeAt: nowTs,
    };
  });
}

export function buildIgnoredPromotionEntries(
  dismissedMap,
  latestEntries,
  historyEntries,
) {
  const currentEntries = new Map();
  const currentEntriesByMatchKey = new Map();

  for (const entry of [
    ...sanitizePromotionEntries(latestEntries),
    ...sanitizePromotionEntries(historyEntries),
  ]) {
    if (!currentEntries.has(entry.id)) {
      currentEntries.set(entry.id, entry);
    }

    const matchKey = getPromotionMatchKey(entry);
    if (matchKey && !currentEntriesByMatchKey.has(matchKey)) {
      currentEntriesByMatchKey.set(matchKey, entry);
    }
  }

  const sourceDismissedMap =
    typeof dismissedMap === "object" && dismissedMap ? dismissedMap : {};
  const ignoredEntries = new Map();

  for (const [id, rawRecord] of Object.entries(sourceDismissedMap)) {
    if (!id || typeof rawRecord !== "object" || !rawRecord) {
      continue;
    }

    const matchKey = getPromotionMatchKey(rawRecord);
    const entry =
      currentEntries.get(id) ||
      (matchKey ? currentEntriesByMatchKey.get(matchKey) : null);
    const stableId =
      entry?.stableId ||
      (typeof rawRecord.stableId === "string" ? rawRecord.stableId : "");
    const ignoredEntry = {
      ...entry,
      id,
      title:
        entry?.title ||
        (typeof rawRecord.title === "string"
          ? rawRecord.title
          : "Unknown promotion"),
      stableId,
      appId: entry?.appId || safeNumber(rawRecord.appId, 0),
      packageId: entry?.packageId || safeNumber(rawRecord.packageId, 0),
      url:
        entry?.url ||
        (typeof rawRecord.url === "string" && rawRecord.url) ||
        buildSteamUrlFromStableId(stableId),
      promoType:
        entry?.promoType ||
        (typeof rawRecord.promoType === "string"
          ? rawRecord.promoType
          : PROMO_TYPES.FREE_TO_KEEP),
      contentType:
        entry?.contentType ||
        (typeof rawRecord.contentType === "string"
          ? rawRecord.contentType
          : CONTENT_TYPES.UNKNOWN),
      dismissedAt: safeNumber(
        rawRecord.dismissedAt,
        entry?.lastStateChangeAt || 0,
      ),
    };
    const ignoredKey = getPromotionMatchKey(ignoredEntry) || ignoredEntry.id;
    const existing = ignoredEntries.get(ignoredKey);

    if (!existing || ignoredEntry.dismissedAt > existing.dismissedAt) {
      ignoredEntries.set(ignoredKey, ignoredEntry);
    }
  }

  return Array.from(ignoredEntries.values()).sort(
    (left, right) => right.dismissedAt - left.dismissedAt,
  );
}

export function buildHistoryViewEntries(historyEntries, ignoredEntries) {
  const mergedEntries = new Map();

  for (const entry of sanitizePromotionEntries(historyEntries)) {
    mergedEntries.set(getPromotionMatchKey(entry) || entry.id, entry);
  }

  for (const ignoredEntry of safeArray(ignoredEntries)) {
    if (!ignoredEntry?.id) {
      continue;
    }

    const mergeKey = getPromotionMatchKey(ignoredEntry) || ignoredEntry.id;
    const existing = mergedEntries.get(mergeKey);
    mergedEntries.set(
      mergeKey,
      sanitizePromotionEntry({
        ...existing,
        ...ignoredEntry,
        status: ENTRY_STATUS.DISMISSED,
        notificationStatus: NOTIFICATION_STATUS.DISMISSED,
        unread: false,
        lastStateChangeAt: safeNumber(
          ignoredEntry.dismissedAt,
          existing?.lastStateChangeAt || 0,
        ),
      }),
    );
  }

  return Array.from(mergedEntries.values()).sort((left, right) => {
    const leftTs = Math.max(
      left.lastSeenAt,
      left.firstSeenAt,
      left.lastStateChangeAt,
    );
    const rightTs = Math.max(
      right.lastSeenAt,
      right.firstSeenAt,
      right.lastStateChangeAt,
    );
    return rightTs - leftTs;
  });
}

export function countUnreadActive(entries) {
  return sanitizePromotionEntries(entries).filter(
    (entry) => entry.status === ENTRY_STATUS.ACTIVE && entry.unread,
  ).length;
}

export function countActivePromotions(
  entries,
  promoType = PROMO_TYPES.FREE_TO_KEEP,
) {
  return sanitizePromotionEntries(entries).filter(
    (entry) =>
      entry.status === ENTRY_STATUS.ACTIVE && entry.promoType === promoType,
  ).length;
}

export function buildLatestEntries(entries) {
  return sanitizePromotionEntries(entries).slice(0, MAX_LATEST_ITEMS);
}
