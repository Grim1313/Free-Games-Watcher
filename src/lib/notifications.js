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
  buildSteamHeaderImageUrl,
  formatPromotionDeadlineStatus,
  formatSteamReviewNotificationSummary,
  getPromotionImageUrl,
} from "./utils.js";
import { getPromotionTypeLabel } from "./filters.js";
import { getTranslator } from "./i18n.js";

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
    const deadline = promotion.endsAt
      ? t("endsAt", {
          value: new Intl.DateTimeFormat(t.locale, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(promotion.endsAt),
        })
      : t("endUnknown");
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
        : `${STORE_NAMES[storeOf(promotion)]} · ${t("freeToKeep")}. ${deadline}.`,
      priority: 0,
      silent: false,
    };
    if (imageUrl) options.imageUrl = imageUrl;
    if (!summary && storeOf(promotion) === "steam" && promotion.reviewTotal)
      options.contextMessage = t("reviewSummary", {
        percent: promotion.reviewPercent,
        count: promotion.reviewTotal,
      });
    try {
      try {
        await chrome.notifications.create(notificationId, options);
      } catch (error) {
        if (!imageUrl) throw error;
        const basic = { ...options, type: "basic" };
        delete basic.imageUrl;
        await chrome.notifications.create(notificationId, basic);
      }
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
  const links = await getNotificationLinks();
  const target = links[notificationId];
  const url = target?.url || "https://store.steampowered.com/";
  await chrome.tabs.create({ url });
}

export async function clearNotificationTarget(notificationId) {
  const links = await getNotificationLinks();
  delete links[notificationId];
  await writeLocal({
    [STORAGE_KEYS.notificationLinks]: pruneNotificationLinks(links, Date.now()),
  });
}

export async function sendTestNotification(settings = {}) {
  const t = await getTranslator(settings.language);
  const promotion = {
    id: "test-notification",
    stableId: "app:599140",
    appId: 599140,
    title: t("notificationTestTitle"),
    promoType: "free-to-keep",
    reviewScore: 8,
    reviewScoreDesc: "Very Positive",
    reviewPositive: 42320,
    reviewNegative: 7033,
    reviewTotal: 49353,
    reviewPercent: 86,
    endsAt: Date.now() + 24 * 60 * 60 * 1000,
    headerImage: buildSteamHeaderImageUrl(599140),
    capsuleImage: "",
    screenshotThumbnail: "",
    screenshotFull: "",
    url: "https://store.steampowered.com/app/599140/Graveyard_Keeper/",
  };
  await createPromotionNotifications([promotion], { settings });
}
