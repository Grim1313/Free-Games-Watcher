import { storeOf, storeUrl, safeStoreUrl, STORE_NAMES } from "./stores.js";
import {
  APP_NAME,
  MAX_NOTIFICATION_LINKS,
  MAX_NOTIFICATIONS_PER_BATCH,
  NOTIFICATION_LINK_TTL_MS,
  NOTIFICATION_PREFIX,
  STORAGE_KEYS,
} from "./constants.js";
import { readKey, writeLocal } from "./storage.js";
import {
  createHash,
  getPromotionImageUrl,
  sanitizeGogRating,
} from "./utils.js";
import { getTranslator } from "./i18n.js";

const TEST_NOTIFICATION_PREFIX = `${NOTIFICATION_PREFIX}:test:`;

function discountMessage(endsAt, t) {
  if (!endsAt) return t("notificationDiscount");
  // Keep the compact numeric deadline identical across notification locales.
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(endsAt);
  return t("notificationDiscountUntil", { date });
}

function steamRatingMessage(promotion, t) {
  return t("steamNotificationRatingSummary", {
    percent: promotion.reviewPercent,
    count: new Intl.NumberFormat(t.locale, {
      notation: promotion.reviewTotal >= 100000 ? "compact" : "standard",
      maximumFractionDigits: 1,
    }).format(promotion.reviewTotal),
  });
}

async function createWithImageFallback(id, options) {
  try {
    return await chrome.notifications.create(id, options);
  } catch (error) {
    if (!options.imageUrl) throw error;
    const basic = { ...options, type: "basic" };
    delete basic.imageUrl;
    return chrome.notifications.create(id, basic);
  }
}

function getNotificationIconUrl() {
  return chrome.runtime.getURL("resources/icons/icon128.png");
}

function sanitizeNotificationLinks(raw = {}) {
  const source = typeof raw === "object" && raw ? raw : {};
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key || typeof value !== "object" || !value) {
      continue;
    }
    result[key] = {
      url:
        value.url === chrome.runtime.getURL("src/ui/history.html")
          ? value.url
          : safeStoreUrl(value.url) || chrome.runtime.getURL("src/ui/history.html"),
      createdAt: Number(value.createdAt) || 0,
    };
  }
  return result;
}

async function getNotificationLinks() {
  const stored = await readKey(STORAGE_KEYS.notificationLinks, {});
  return sanitizeNotificationLinks(stored);
}

function pruneNotificationLinks(links, nowTs) {
  const entries = Object.entries(sanitizeNotificationLinks(links))
    .filter(([, value]) => nowTs - value.createdAt <= NOTIFICATION_LINK_TTL_MS)
    .sort((left, right) => right[1].createdAt - left[1].createdAt)
    .slice(0, MAX_NOTIFICATION_LINKS);

  return Object.fromEntries(entries);
}

export async function createPromotionNotifications(promotions, config = {}) {
  const nowTs = Date.now();
  const t = await getTranslator(config.settings?.language || "auto");
  const links = await getNotificationLinks();
  const createdIds = [];
  const groups =
    promotions.length > MAX_NOTIFICATIONS_PER_BATCH
      ? [
          ...promotions.slice(0, MAX_NOTIFICATIONS_PER_BATCH).map((p) => [p]),
          promotions.slice(MAX_NOTIFICATIONS_PER_BATCH),
        ]
      : promotions.map((p) => [p]);
  for (const group of groups) {
    const promotion = group[0];
    const summary =
      group.length > 1 ||
      promotions.indexOf(promotion) >= MAX_NOTIFICATIONS_PER_BATCH;
    const notificationId = `${NOTIFICATION_PREFIX}:${config.reminder ? "reminder" : "new"}:${createHash(group.map((p) => p.fingerprint || p.id).join("|"))}`;
    const imageUrl = summary
      ? ""
      : getPromotionImageUrl(promotion, { preferScreenshot: false });
    const options = {
      type: imageUrl ? "image" : "basic",
      iconUrl: getNotificationIconUrl(),
      title: summary
        ? APP_NAME
        : config.reminder
          ? `${t("endingSoon")}: ${promotion.title}`
          : promotion.title,
      message: summary
        ? t("notificationSummary", { count: group.length })
        : `${STORE_NAMES[storeOf(promotion)]} · ${discountMessage(promotion.endsAt, t)}`,
      priority: 0,
      silent: false,
    };
    if (imageUrl) options.imageUrl = imageUrl;
    if (!summary && storeOf(promotion) === "steam" && promotion.reviewTotal)
      options.contextMessage = steamRatingMessage(promotion, t);
    if (!summary && storeOf(promotion) === "gog") {
      const { gogRating, gogRatingCount } = sanitizeGogRating(promotion);
      if (gogRating)
        options.contextMessage = t("gogNotificationRatingSummary", {
          rating: new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(gogRating),
          count: new Intl.NumberFormat(t.locale).format(gogRatingCount),
        });
    }
    try {
      await createWithImageFallback(notificationId, options);
      links[notificationId] = {
        url: summary
          ? chrome.runtime.getURL("src/ui/history.html")
          : storeUrl({ ...promotion, url: promotion.claimUrl || promotion.url }),
        createdAt: nowTs,
      };
      await writeLocal({
        [STORAGE_KEYS.notificationLinks]: pruneNotificationLinks(links, nowTs),
      });
      createdIds.push(notificationId);
      await config.onDelivered?.(group);
    } catch (error) {
      if (config.onError) config.onError(error);
      else throw error;
    }
  }
  return createdIds;
}

export async function openNotificationTarget(notificationId) {
  if (notificationId.startsWith(TEST_NOTIFICATION_PREFIX)) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/options.html#notifications") });
    return;
  }
  const links = await getNotificationLinks();
  const target = links[notificationId];
  const url = target?.url || "https://store.steampowered.com/";
  await chrome.tabs.create({ url });
}

export async function clearNotificationTarget(notificationId) {
  if (notificationId.startsWith(TEST_NOTIFICATION_PREFIX)) return;
  const links = await getNotificationLinks();
  delete links[notificationId];
  await writeLocal({
    [STORAGE_KEYS.notificationLinks]: pruneNotificationLinks(links, Date.now()),
  });
}

export async function sendTestNotification(settings = {}) {
  if (await chrome.notifications.getPermissionLevel() !== "granted")
    throw new Error("notificationsBlocked");
  const t = await getTranslator(settings.language);
  // A user-requested test is a new event each time, unlike deduplicated giveaways.
  // Local assets avoid store requests and image-download delays.
  return createWithImageFallback(`${TEST_NOTIFICATION_PREFIX}${crypto.randomUUID()}`, {
    type: "image",
    iconUrl: getNotificationIconUrl(),
    imageUrl: chrome.runtime.getURL("src/ui/assets/notification-demo.png"),
    title: t("notificationTestTitle"),
    message: `${discountMessage(Date.now() + 24 * 60 * 60 * 1000, t)}\n$19.99 → $0`,
    contextMessage: steamRatingMessage({ reviewPercent: 94, reviewTotal: 12345 }, t),
    priority: 0,
    silent: false,
  });
}
