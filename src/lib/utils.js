import { storeOf, storeAsset } from "./stores.js";
import {
  DEBUG,
  FETCH_TIMEOUT_MS,
  PROMO_TYPES,
  CONTENT_TYPES,
} from "./constants.js";

const STEAM_STORE_HOST = "store.steampowered.com";
const STEAM_ASSET_HOST_RE = /(^|\.)steamstatic\.com$/i;
const STEAM_CDN_ASSET_HOST = "https://cdn.cloudflare.steamstatic.com";
const INTEGER_NUMBER_FORMATTER = new Intl.NumberFormat();

export function debugLog(...args) {
  if (DEBUG) {
    console.log("[Free Games Watcher]", ...args);
  }
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function minutesToMs(minutes) {
  return minutes * 60 * 1000;
}

export function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

export function createHash(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(html) {
  return String(html || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export function stripHtml(html) {
  const withoutScripts = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|section|article|h1|h2|h3|h4|h5|h6|span)>/gi, " ");
  return normalizeWhitespace(
    decodeHtmlEntities(withoutScripts.replace(/<[^>]+>/g, " ")),
  );
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function chunkArray(items, size) {
  const chunks = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

export function formatDateTime(timestamp) {
  if (!timestamp) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "Never";
  }

  const diff = timestamp - Date.now();
  const abs = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (abs < hour) {
    return rtf.format(Math.round(diff / minute), "minute");
  }
  if (abs < day) {
    return rtf.format(Math.round(diff / hour), "hour");
  }
  return rtf.format(Math.round(diff / day), "day");
}

export function formatPromotionDeadline(timestamp) {
  const normalized = safeNumber(timestamp, 0);
  if (!normalized) {
    return "";
  }
  return `Ends ${formatDateTime(normalized)} (${formatRelativeTime(normalized)})`;
}

export function formatPromotionDeadlineStatus(timestamp, checkedAt = 0) {
  const deadline = formatPromotionDeadline(timestamp);
  if (deadline) {
    return deadline;
  }
  const checked = safeNumber(checkedAt, 0);
  return checked
    ? `End time unavailable · Last checked ${formatDateTime(checked)}`
    : "End time unavailable";
}

export function parseTimeString(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function isQuietHoursActive(settings, timestamp = Date.now()) {
  if (!settings?.quietHoursEnabled) {
    return false;
  }
  const start = parseTimeString(settings.quietHoursStart);
  const end = parseTimeString(settings.quietHoursEnd);
  if (start === null || end === null || start === end) {
    return false;
  }

  const local = new Date(timestamp);
  const currentMinutes = local.getHours() * 60 + local.getMinutes();

  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

export function textAreaToList(value) {
  return String(value || "")
    .split(/\r?\n|,/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

export function uniqueLowerList(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const normalized = normalizeWhitespace(item).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function buildSteamUrlFromStableId(stableId) {
  const match = /^(app|sub):(\d+)$/.exec(String(stableId || ""));
  if (!match) {
    return "https://store.steampowered.com/";
  }
  return `https://store.steampowered.com/${match[1]}/${match[2]}/`;
}

export function sanitizeSteamUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== STEAM_STORE_HOST) {
      return "https://store.steampowered.com/";
    }
    return parsed.toString();
  } catch {
    return "https://store.steampowered.com/";
  }
}

export function sanitizeSteamAssetUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return "";
    }
    if (
      STEAM_ASSET_HOST_RE.test(parsed.hostname) ||
      parsed.hostname === STEAM_STORE_HOST
    ) {
      return parsed.toString();
    }
    return "";
  } catch {
    return "";
  }
}

export function buildSteamHeaderImageUrl(appId) {
  const normalizedAppId = Number(appId);
  if (!Number.isInteger(normalizedAppId) || normalizedAppId <= 0) {
    return "";
  }
  return `${STEAM_CDN_ASSET_HOST}/steam/apps/${normalizedAppId}/header.jpg`;
}

export function sanitizeSteamReviewSummary(raw = {}) {
  const source = typeof raw === "object" && raw ? raw : {};
  const reviewScore = Math.max(
    0,
    safeNumber(source.reviewScore ?? source.review_score, 0),
  );
  const reviewScoreDesc =
    typeof (source.reviewScoreDesc ?? source.review_score_desc) === "string"
      ? normalizeWhitespace(source.reviewScoreDesc ?? source.review_score_desc)
      : "";
  const reviewPositive = Math.max(
    0,
    safeNumber(source.reviewPositive ?? source.total_positive, 0),
  );
  const reviewNegative = Math.max(
    0,
    safeNumber(source.reviewNegative ?? source.total_negative, 0),
  );
  const reviewTotal = Math.max(
    reviewPositive + reviewNegative,
    safeNumber(source.reviewTotal ?? source.total_reviews, 0),
  );
  const explicitPercent = safeNumber(
    source.reviewPercent ?? source.positive_percent,
    -1,
  );
  const reviewPercent =
    reviewPositive + reviewNegative > 0
      ? clamp(Math.round((reviewPositive / reviewTotal) * 100), 0, 100)
      : explicitPercent >= 0
        ? clamp(Math.round(explicitPercent), 0, 100)
        : 0;

  return {
    reviewScore,
    reviewScoreDesc,
    reviewPositive,
    reviewNegative,
    reviewTotal,
    reviewPercent,
  };
}

export function hasSteamReviewSummary(raw = {}) {
  return sanitizeSteamReviewSummary(raw).reviewTotal > 0;
}

export function sanitizeGogRating(raw = {}) {
  const rating = safeNumber(raw.gogRating, 0), count = safeNumber(raw.gogRatingCount, 0);
  const valid = rating > 0 && rating <= 5 && Number.isSafeInteger(count) && count > 0;
  return { gogRating: valid ? Math.round(rating * 10) / 10 : 0, gogRatingCount: valid ? count : 0 };
}

export function getSteamReviewTone(raw = {}) {
  const { reviewPercent, reviewTotal } = sanitizeSteamReviewSummary(raw);
  if (reviewTotal <= 0) {
    return "unknown";
  }
  if (reviewPercent >= 90) {
    return "excellent";
  }
  if (reviewPercent >= 75) {
    return "good";
  }
  if (reviewPercent >= 50) {
    return "mixed";
  }
  return "bad";
}

export function formatCompactNumber(value) {
  const normalized = Math.max(0, safeNumber(value, 0));
  if (normalized < 1000) {
    return String(Math.round(normalized));
  }

  const units = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];

  for (const [threshold, suffix] of units) {
    if (normalized >= threshold) {
      const compact = Math.round((normalized / threshold) * 10) / 10;
      const text = Number.isInteger(compact)
        ? String(compact)
        : compact.toFixed(1);
      return `${text.replace(/\.0$/, "")}${suffix}`;
    }
  }

  return String(Math.round(normalized));
}

export function formatIntegerNumber(value) {
  return INTEGER_NUMBER_FORMATTER.format(Math.max(0, safeNumber(value, 0)));
}

export function formatSteamReviewTooltip(raw = {}) {
  const summary = sanitizeSteamReviewSummary(raw);
  if (summary.reviewTotal <= 0) {
    return "";
  }

  const parts = [];
  if (summary.reviewScoreDesc) {
    parts.push(summary.reviewScoreDesc);
  }
  parts.push(`${summary.reviewPercent}% positive`);
  parts.push(`${formatIntegerNumber(summary.reviewTotal)} Steam reviews`);
  return parts.join(" · ");
}

export function formatSteamReviewNotificationSummary(raw = {}) {
  const summary = sanitizeSteamReviewSummary(raw);
  if (summary.reviewTotal <= 0) {
    return "";
  }

  const parts = [];
  if (summary.reviewScoreDesc) {
    parts.push(summary.reviewScoreDesc);
  }
  parts.push(`${summary.reviewPercent}% positive`);
  parts.push(`${formatCompactNumber(summary.reviewTotal)} reviews`);
  return parts.join(" · ");
}

// Store artwork only: gallery screenshots are not a stable visual identity.
// Guess a legacy header URL only when no explicit artwork URL was supplied.
export function getPromotionCoverUrls(promotion) {
  const source = typeof promotion === "object" && promotion ? promotion : {};
  const candidates = [source.headerImage, source.capsuleImage]
    .map((value) => storeAsset(value, source))
    .filter(Boolean);
  if (!candidates.length && storeOf(source) === "steam") {
    const stableIdMatch = /^app:(\d+)$/.exec(String(source.stableId || ""));
    const fallback = buildSteamHeaderImageUrl(
      source.appId || stableIdMatch?.[1],
    );
    if (fallback) candidates.push(fallback);
  }
  return [...new Set(candidates)];
}

export function getPromotionImageUrl(promotion, options = {}) {
  const source = typeof promotion === "object" && promotion ? promotion : {};
  const preferScreenshot = options.preferScreenshot !== false;
  const screenshotKey = options.fullSize
    ? "screenshotFull"
    : "screenshotThumbnail";
  const stableIdMatch = /^app:(\d+)$/.exec(String(source.stableId || ""));
  const fallbackHeaderImage = buildSteamHeaderImageUrl(
    source.appId || stableIdMatch?.[1] || 0,
  );
  const ordered = preferScreenshot
    ? [
        source[screenshotKey],
        source.headerImage,
        source.capsuleImage,
        fallbackHeaderImage,
      ]
    : [
        source.headerImage,
        source.capsuleImage,
        fallbackHeaderImage,
        source[screenshotKey],
      ];

  for (const candidate of ordered) {
    const sanitized = storeAsset(candidate, source);
    if (sanitized) {
      return sanitized;
    }
  }

  return "";
}

export function computeBackoffMs(intervalMinutes, backoffLevel) {
  const base = minutesToMs(intervalMinutes);
  const factor = Math.max(1, Math.pow(2, Math.max(0, backoffLevel)));
  return Math.min(base * factor, Math.max(base, 6 * 60 * 60 * 1000));
}

export async function fetchJsonWithTimeout(
  url,
  options = {},
  timeoutMs = FETCH_TIMEOUT_MS,
) {
  return fetchWithTimeout(
    url,
    {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    },
    timeoutMs,
    (response) => response.json(),
  );
}

export async function fetchTextWithTimeout(
  url,
  options = {},
  timeoutMs = FETCH_TIMEOUT_MS,
) {
  return fetchWithTimeout(url, options, timeoutMs, (response) =>
    response.text(),
  );
}

export async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = FETCH_TIMEOUT_MS,
  readBody = null,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return readBody ? await readBody(response) : response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getPromotionTypeLabel(type) {
  return "Free to Keep";
}

export function getContentTypeLabel(type) {
  switch (type) {
    case CONTENT_TYPES.DLC:
      return "DLC";
    case CONTENT_TYPES.SOUNDTRACK:
      return "Soundtrack";
    case CONTENT_TYPES.DEMO:
      return "Demo";
    case CONTENT_TYPES.TOOL:
      return "Tool";
    case CONTENT_TYPES.PACKAGE:
      return "Package";
    case CONTENT_TYPES.GAME:
      return "Game";
    default:
      return "Unknown";
  }
}

export function titleLooksLikeSoundtrack(value) {
  return /\b(soundtrack|ost|original soundtrack)\b/i.test(String(value || ""));
}
