import { getTranslator } from "./i18n.js";

const BADGE_COLORS = Object.freeze({
  unread: "#d94b3d",
  read: "#2f8f46",
});

function formatBadgeCount(count) {
  return count > 99 ? "99+" : String(count);
}

export async function updateBadge(runtimeState, settings) {
  if (chrome.action.setTitle) {
    const t = await getTranslator(settings.language);
    await chrome.action.setTitle({
      title: `Free Games Watcher · ${t("badgeTitle", { active: runtimeState.activeFreeToKeepCount || 0, unread: runtimeState.unreadCount || 0 })}`,
    });
  }
  if (!settings.badgeEnabled) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  const unreadCount = Number(runtimeState?.unreadCount) || 0;
  const activeFreeToKeepCount =
    Number(runtimeState?.activeFreeToKeepCount) || 0;
  if (activeFreeToKeepCount <= 0) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  await chrome.action.setBadgeBackgroundColor({
    color: unreadCount > 0 ? BADGE_COLORS.unread : BADGE_COLORS.read,
  });
  await chrome.action.setBadgeText({
    text: formatBadgeCount(activeFreeToKeepCount),
  });
}
