import { STORE_IDS } from "./stores.js";
import {
  CHECK_INTERVAL_OPTIONS,
  DEFAULT_CHECK_INTERVAL_MINUTES,
  DEFAULT_HISTORY_RETENTION_DAYS,
  DEFAULT_NOTIFIED_RETENTION_DAYS,
  DEFAULT_QUIET_END,
  DEFAULT_QUIET_START,
  STORAGE_KEYS,
} from "./constants.js";
import { readKey, writeLocal } from "./storage.js";
import {
  clamp,
  textAreaToList,
  uniqueLowerList,
  parseTimeString,
} from "./utils.js";

export const DEFAULT_SETTINGS = Object.freeze({
  notificationsEnabled: true,
  region: "US",
  enabledStores: ["steam", "epic", "gog"],
  language: "auto",
  compactView: false,
  sortBy: "ending",
  remindersEnabled: true,
  reminderHours: 3,
  trackFreeToKeep: true,
  checkIntervalMinutes: DEFAULT_CHECK_INTERVAL_MINUTES,
  quietHoursEnabled: false,
  quietHoursStart: DEFAULT_QUIET_START,
  quietHoursEnd: DEFAULT_QUIET_END,
  badgeEnabled: true,
  historyEnabled: true,
  historyRetentionDays: DEFAULT_HISTORY_RETENTION_DAYS,
  notifiedRetentionDays: DEFAULT_NOTIFIED_RETENTION_DAYS,
  renotifyAfterRetention: true,
  filters: {
    ignoreDlc: true,
    ignoreSoundtracks: true,
    ignoreDemos: true,
    ignoreTools: true,
    ignorePackages: false,
    blockedAppIds: [],
    blockedKeywords: [],
    minRating: 0,
    minReviews: 0,
    includeUnrated: true,
    genres: [],
    platforms: [],
  },
});

function sanitizeCheckInterval(value) {
  const numeric = Number(value);
  return CHECK_INTERVAL_OPTIONS.includes(numeric)
    ? numeric
    : DEFAULT_CHECK_INTERVAL_MINUTES;
}

function sanitizePositiveDayCount(value, fallback) {
  return clamp(Math.round(Number(value) || fallback), 1, 365);
}

export function sanitizeSettings(raw = {}) {
  const source = typeof raw === "object" && raw ? raw : {};
  const filters =
    typeof source.filters === "object" && source.filters ? source.filters : {};

  const blockedAppIds = Array.from(
    new Set(
      textAreaToList(
        Array.isArray(filters.blockedAppIds)
          ? filters.blockedAppIds.join("\n")
          : filters.blockedAppIds,
      )
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );

  const blockedKeywords = uniqueLowerList(
    Array.isArray(filters.blockedKeywords)
      ? filters.blockedKeywords
      : textAreaToList(filters.blockedKeywords),
  );

  return {
    enabledStores: Array.isArray(source.enabledStores)
      ? STORE_IDS.filter((store) => source.enabledStores.includes(store))
      : ["steam"],
    region: /^[A-Z]{2}$/.test(String(source.region || "").toUpperCase())
      ? String(source.region).toUpperCase()
      : "US",
    language: ["auto", "en", "ru"].includes(source.language)
      ? source.language
      : "auto",
    compactView: Boolean(source.compactView),
    sortBy: ["ending", "newest", "rating", "title"].includes(source.sortBy)
      ? source.sortBy
      : "ending",
    remindersEnabled: Boolean(source.remindersEnabled ?? true),
    reminderHours: clamp(Math.round(Number(source.reminderHours) || 3), 1, 72),
    notificationsEnabled: Boolean(
      source.notificationsEnabled ?? DEFAULT_SETTINGS.notificationsEnabled,
    ),
    trackFreeToKeep: Boolean(
      source.trackFreeToKeep ?? DEFAULT_SETTINGS.trackFreeToKeep,
    ),
    checkIntervalMinutes: sanitizeCheckInterval(source.checkIntervalMinutes),
    quietHoursEnabled: Boolean(
      source.quietHoursEnabled ?? DEFAULT_SETTINGS.quietHoursEnabled,
    ),
    quietHoursStart:
      parseTimeString(source.quietHoursStart) !== null
        ? source.quietHoursStart
        : DEFAULT_QUIET_START,
    quietHoursEnd:
      parseTimeString(source.quietHoursEnd) !== null
        ? source.quietHoursEnd
        : DEFAULT_QUIET_END,
    badgeEnabled: Boolean(source.badgeEnabled ?? DEFAULT_SETTINGS.badgeEnabled),
    historyEnabled: Boolean(
      source.historyEnabled ?? DEFAULT_SETTINGS.historyEnabled,
    ),
    historyRetentionDays: sanitizePositiveDayCount(
      source.historyRetentionDays,
      DEFAULT_HISTORY_RETENTION_DAYS,
    ),
    notifiedRetentionDays: sanitizePositiveDayCount(
      source.notifiedRetentionDays,
      DEFAULT_NOTIFIED_RETENTION_DAYS,
    ),
    renotifyAfterRetention: Boolean(
      source.renotifyAfterRetention ?? DEFAULT_SETTINGS.renotifyAfterRetention,
    ),
    filters: {
      ignoreDlc: Boolean(
        filters.ignoreDlc ?? DEFAULT_SETTINGS.filters.ignoreDlc,
      ),
      ignoreSoundtracks: Boolean(
        filters.ignoreSoundtracks ?? DEFAULT_SETTINGS.filters.ignoreSoundtracks,
      ),
      ignoreDemos: Boolean(
        filters.ignoreDemos ?? DEFAULT_SETTINGS.filters.ignoreDemos,
      ),
      ignoreTools: Boolean(
        filters.ignoreTools ?? DEFAULT_SETTINGS.filters.ignoreTools,
      ),
      ignorePackages: Boolean(
        filters.ignorePackages ?? DEFAULT_SETTINGS.filters.ignorePackages,
      ),
      blockedAppIds,
      blockedKeywords,
      minRating: clamp(Math.round(Number(filters.minRating) || 0), 0, 100),
      minReviews: clamp(
        Math.round(Number(filters.minReviews) || 0),
        0,
        10000000,
      ),
      includeUnrated: filters.includeUnrated !== false,
      genres: uniqueLowerList(
        textAreaToList(
          Array.isArray(filters.genres)
            ? filters.genres.join("\n")
            : filters.genres,
        ),
      ).slice(0, 50),
      platforms: (Array.isArray(filters.platforms)
        ? filters.platforms
        : []
      ).filter((p) => ["windows", "mac", "linux"].includes(p)),
    },
  };
}

export async function getSettings() {
  const stored = await readKey(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
  return sanitizeSettings(stored);
}

export async function saveSettings(nextSettings) {
  const current = await getSettings();
  const merged = sanitizeSettings({
    ...current,
    ...nextSettings,
    filters: {
      ...current.filters,
      ...(nextSettings?.filters || {}),
    },
  });
  await writeLocal({ [STORAGE_KEYS.settings]: merged });
  return merged;
}

export async function resetSettings() {
  const sanitized = sanitizeSettings(DEFAULT_SETTINGS);
  await writeLocal({ [STORAGE_KEYS.settings]: sanitized });
  return sanitized;
}
