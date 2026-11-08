import { extensionApi } from "./browser-api.js";
import { getTranslator } from "./i18n.js";

const BADGE_COLORS = Object.freeze({
  unread: "#d94b3d",
  read: "#2f8f46",
});

function formatBadgeCount(count) {
  return count > 99 ? "99+" : String(count);
}

export async function updateBadge(runtimeState, settings) {
  if (extensionApi().action.setTitle) {
    const t = await getTranslator(settings.language);
    await extensionApi().action.setTitle({
      title: `Free Games Watcher · ${t("badgeTitle", { active: runtimeState.activeFreeToKeepCount || 0, unread: runtimeState.unreadCount || 0 })}`,
    });
  }
  if (!settings.badgeEnabled) {
    await extensionApi().action.setBadgeText({ text: "" });
    return;
  }

  const unreadCount = Number(runtimeState?.unreadCount) || 0;
  const activeFreeToKeepCount =
    Number(runtimeState?.activeFreeToKeepCount) || 0;
  if (activeFreeToKeepCount <= 0) {
    await extensionApi().action.setBadgeText({ text: "" });
    return;
  }

  await extensionApi().action.setBadgeBackgroundColor({
    color: unreadCount > 0 ? BADGE_COLORS.unread : BADGE_COLORS.read,
  });
  await extensionApi().action.setBadgeText({
    text: formatBadgeCount(activeFreeToKeepCount),
  });
}
