import { MAX_DISMISSED_ITEMS, MAX_NOTIFIED_ITEMS } from "./constants.js";
import { safeNumber } from "./utils.js";

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

function findDismissedRecordEntry(dismissedMap, promotion) {
  const sanitized = sanitizeDismissedMap(dismissedMap);
  const exactId = typeof promotion?.id === "string" ? promotion.id : "";
  if (exactId && sanitized[exactId]) {
    return [exactId, sanitized[exactId]];
  }

  const targetKey = getPromotionMatchKey(promotion);
  if (!targetKey) {
    return null;
  }

  for (const [id, record] of Object.entries(sanitized)) {
    if (getPromotionMatchKey(record) === targetKey) {
      return [id, record];
    }
  }

  return null;
}

export function sanitizeNotifiedMap(raw = {}) {
  const source = typeof raw === "object" && raw ? raw : {};
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key || typeof value !== "object" || !value) {
      continue;
    }
    result[key] = {
      fingerprint:
        typeof value.fingerprint === "string" ? value.fingerprint : "",
      firstNotifiedAt: safeNumber(value.firstNotifiedAt, 0),
      lastNotifiedAt: safeNumber(value.lastNotifiedAt, 0),
    };
  }
  return result;
}

export function sanitizeDismissedMap(raw = {}) {
  const source = typeof raw === "object" && raw ? raw : {};
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key || typeof value !== "object" || !value) {
      continue;
    }
    result[key] = {
      fingerprint:
        typeof value.fingerprint === "string" ? value.fingerprint : "",
      title: typeof value.title === "string" ? value.title : "",
      dismissedAt: safeNumber(value.dismissedAt, 0),
      stableId: typeof value.stableId === "string" ? value.stableId : "",
      appId: safeNumber(value.appId, 0),
      packageId: safeNumber(value.packageId, 0),
      url: typeof value.url === "string" ? value.url : "",
      promoType: typeof value.promoType === "string" ? value.promoType : "",
      contentType:
        typeof value.contentType === "string" ? value.contentType : "",
    };
  }
  return result;
}

export function buildPromotionIdentity(promotion) {
  return `${promotion.stableId}|${promotion.promoType}`;
}

export function buildPromotionFingerprint(promotion) {
  // A campaign survives metadata, deadline and provider changes.
  return promotion.campaignId || buildPromotionIdentity(promotion);
}

export function shouldNotifyPromotion(promotion, notifiedMap, settings, nowTs) {
  if (promotion.importedAt) return { shouldNotify: false, reason: "imported-history" };
  const record = notifiedMap[promotion.id];
  if (!record) {
    return { shouldNotify: true, reason: "new" };
  }
  if (record.fingerprint !== promotion.fingerprint) {
    return { shouldNotify: true, reason: "changed" };
  }
  if (
    settings.renotifyAfterRetention &&
    settings.notifiedRetentionDays > 0 &&
    nowTs - record.lastNotifiedAt >=
      settings.notifiedRetentionDays * 24 * 60 * 60 * 1000
  ) {
    return { shouldNotify: true, reason: "ttl-expired" };
  }
  return { shouldNotify: false, reason: "already-notified" };
}

export function markPromotionsNotified(
  notifiedMap,
  promotions,
  nowTs,
  settings,
) {
  const next = { ...sanitizeNotifiedMap(notifiedMap) };
  for (const promotion of promotions) {
    const existing = next[promotion.id];
    next[promotion.id] = {
      fingerprint: promotion.fingerprint,
      firstNotifiedAt: existing?.firstNotifiedAt || nowTs,
      lastNotifiedAt: nowTs,
    };
  }
  return pruneNotifiedMap(next, settings, nowTs);
}

export function pruneNotifiedMap(notifiedMap, settings, nowTs) {
  const entries = Object.entries(sanitizeNotifiedMap(notifiedMap));
  const filtered = [];
  for (const entry of entries) {
    const [, value] = entry;
    if (!value.lastNotifiedAt) {
      continue;
    }
    if (
      settings.renotifyAfterRetention &&
      settings.notifiedRetentionDays > 0 &&
      nowTs - value.lastNotifiedAt >=
        settings.notifiedRetentionDays * 24 * 60 * 60 * 1000
    ) {
      continue;
    }
    filtered.push(entry);
  }

  filtered.sort(
    (left, right) => right[1].lastNotifiedAt - left[1].lastNotifiedAt,
  );
  return Object.fromEntries(filtered.slice(0, MAX_NOTIFIED_ITEMS));
}

export function isPromotionDismissed(promotion, dismissedMap) {
  return Boolean(findDismissedRecordEntry(dismissedMap, promotion));
}

export function dismissPromotionRecord(dismissedMap, promotion, nowTs) {
  const next = { ...sanitizeDismissedMap(dismissedMap) };
  const targetKey = getPromotionMatchKey(promotion);
  if (targetKey) {
    for (const [id, record] of Object.entries(next)) {
      if (getPromotionMatchKey(record) === targetKey) {
        delete next[id];
      }
    }
  }

  next[promotion.id] = {
    fingerprint: promotion.fingerprint,
    title: promotion.title,
    dismissedAt: nowTs,
    stableId: promotion.stableId,
    appId: promotion.appId,
    packageId: promotion.packageId,
    url: promotion.url,
    promoType: promotion.promoType,
    contentType: promotion.contentType,
  };
  return pruneDismissedMap(next);
}

export function restorePromotionRecord(dismissedMap, promotionId) {
  const next = { ...sanitizeDismissedMap(dismissedMap) };
  const targetEntry = findDismissedRecordEntry(next, { id: promotionId });
  if (!targetEntry) {
    delete next[promotionId];
    return next;
  }

  const [, record] = targetEntry;
  const targetKey = getPromotionMatchKey(record);
  if (!targetKey) {
    delete next[promotionId];
    return next;
  }

  for (const [id, currentRecord] of Object.entries(next)) {
    if (getPromotionMatchKey(currentRecord) === targetKey) {
      delete next[id];
    }
  }

  return next;
}

export function pruneDismissedMap(dismissedMap) {
  const entries = Object.entries(sanitizeDismissedMap(dismissedMap));
  entries.sort((left, right) => right[1].dismissedAt - left[1].dismissedAt);
  return Object.fromEntries(entries.slice(0, MAX_DISMISSED_ITEMS));
}
