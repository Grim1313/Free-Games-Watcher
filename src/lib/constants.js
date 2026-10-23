export const DEBUG = false;

export const APP_NAME = "Steam Promo Watch";
export const STORAGE_SCHEMA_VERSION = 2;
export const CHECK_ALARM_NAME = "steam-promo-check";
export const FOLLOWUP_ALARM_NAME = "steam-promo-followup";
export const NOTIFICATION_PREFIX = "steam-promo-watch";

export const STORAGE_KEYS = Object.freeze({
  schemaVersion: "schemaVersion",
  settings: "settings",
  runtimeState: "runtimeState",
  history: "history",
  latestPromotions: "latestPromotions",
  notifiedPromotions: "notifiedPromotions",
  dismissedPromotions: "dismissedPromotions",
  metadataCache: "metadataCache",
  notificationLinks: "notificationLinks",
  userActions: "userActions",
  diagnostics: "diagnostics",
});

export const CHECK_INTERVAL_OPTIONS = Object.freeze([
  15, 30, 60, 180, 360, 720, 1440,
]);

export const PROMO_TYPES = Object.freeze({
  FREE_TO_KEEP: "free-to-keep",
});

export const CONTENT_TYPES = Object.freeze({
  GAME: "game",
  DLC: "dlc",
  SOUNDTRACK: "soundtrack",
  DEMO: "demo",
  TOOL: "tool",
  PACKAGE: "package",
  UNKNOWN: "unknown",
});

export const ENTRY_STATUS = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  DISMISSED: "dismissed",
});

export const NOTIFICATION_STATUS = Object.freeze({
  NONE: "none",
  PENDING: "pending",
  SENT: "sent",
  QUIET: "suppressed-quiet",
  DISMISSED: "dismissed",
});

export const SOURCE_IDS = Object.freeze({
  STORE_SEARCH: "steam-store-search",
  STORE_FEATURED: "steam-store-featured",
});

export const SOURCE_PRIORITIES = Object.freeze({
  [SOURCE_IDS.STORE_SEARCH]: 3,
  [SOURCE_IDS.STORE_FEATURED]: 2,
});

export const DEFAULT_CHECK_INTERVAL_MINUTES = 180;
export const DEFAULT_HISTORY_RETENTION_DAYS = 30;
export const DEFAULT_NOTIFIED_RETENTION_DAYS = 14;
export const DEFAULT_QUIET_START = "23:00";
export const DEFAULT_QUIET_END = "08:00";

export const FETCH_TIMEOUT_MS = 12000;
export const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROMOTION_DEADLINE_TTL_MS = 6 * 60 * 60 * 1000;
export const NOTIFICATION_LINK_TTL_MS = 2 * 24 * 60 * 60 * 1000;
export const MAX_HISTORY_ITEMS = 400;
export const MAX_LATEST_ITEMS = 400;
export const MAX_NOTIFIED_ITEMS = 500;
export const MAX_DISMISSED_ITEMS = 200;
export const MAX_METADATA_ITEMS = 500;
export const MAX_NOTIFICATION_LINKS = 40;
export const MAX_NOTIFICATIONS_PER_BATCH = 3;
export const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
