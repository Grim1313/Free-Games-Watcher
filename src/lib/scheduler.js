import { storeOf, enabledStores } from "./stores.js";
import { CHECK_ALARM_NAME, FOLLOWUP_ALARM_NAME } from "./constants.js";
import { getRuntimeState, setRuntimeState } from "./runtime-state.js";
import {
  computeBackoffMs,
  minutesToMs,
  isQuietHoursActive,
  parseTimeString,
} from "./utils.js";
import { getLatestPromotionEntries } from "./history.js";
import { getActions } from "./actions.js";
import { visibleEntries } from "./promotions.js";
import { readKey } from "./storage.js";

export const getCheckAlarm = () => chrome.alarms.get(CHECK_ALARM_NAME);
export async function scheduleCheckAt(when) {
  await chrome.alarms.create(CHECK_ALARM_NAME, { when });
  await setRuntimeState({ nextCheckAt: when });
  return when;
}
export const scheduleCheckIn = (delay) =>
  scheduleCheckAt(Date.now() + Math.max(delay, 30000));
export async function ensureCheckAlarm(settings) {
  if (!settings.trackFreeToKeep || !enabledStores(settings).length) {
    await chrome.alarms.clear(CHECK_ALARM_NAME);
    await chrome.alarms.clear(FOLLOWUP_ALARM_NAME);
    await setRuntimeState({ nextCheckAt: 0, lastCheckOutcome: "paused" });
    return 0;
  }
  const existing = await getCheckAlarm();
  const state = await getRuntimeState();
  const due =
    state.nextCheckAt ||
    (state.lastSuccessAt
      ? state.lastSuccessAt + minutesToMs(settings.checkIntervalMinutes)
      : Date.now());
  const scheduledTime = existing?.scheduledTime;
  if (scheduledTime && scheduledTime > Date.now()) {
    await setRuntimeState({ nextCheckAt: scheduledTime });
    return scheduledTime;
  }
  return scheduleCheckAt(Math.max(Date.now() + 30000, due));
}
export async function resetCheckAlarm(settings) {
  return settings.trackFreeToKeep && enabledStores(settings).length
    ? scheduleCheckIn(minutesToMs(settings.checkIntervalMinutes))
    : ensureCheckAlarm(settings);
}
export const scheduleAfterError = (settings, level) =>
  settings.trackFreeToKeep && enabledStores(settings).length
    ? scheduleCheckIn(computeBackoffMs(settings.checkIntervalMinutes, level))
    : ensureCheckAlarm(settings);
export const scheduleAfterSuccess = (settings) => resetCheckAlarm(settings);
export function quietEndAfter(settings, timestamp) {
  if (!isQuietHoursActive(settings, timestamp)) return timestamp;
  const end = parseTimeString(settings.quietHoursEnd);
  const date = new Date(timestamp);
  date.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (date.getTime() <= timestamp) date.setDate(date.getDate() + 1);
  return date.getTime();
}
export function getFollowupTime(
  entries,
  settings,
  actions,
  notified,
  state,
  now = Date.now(),
) {
  if (!settings.trackFreeToKeep || !enabledStores(settings).length) return 0;
  const candidates = Object.entries(actions)
    .filter(([id, a]) => enabledStores(settings).includes(storeOf(id)) && !a.claimed && !a.ignored)
    .map(([, a]) => a)
    .map((a) =>
      a.snoozedUntil > now
        ? a.snoozedUntil
        : a.snoozePending && settings.notificationsEnabled
          ? now + 15 * 60000
          : 0,
    )
    .filter((t) => t > now);
  candidates.push(
    ...entries
      .filter(
        (e) =>
          e.status === "active" &&
          e.endsAt > now &&
          e.region === settings.region && enabledStores(settings).includes(storeOf(e)),
      )
      .map((e) => e.endsAt),
  );
  candidates.push(...entries.filter((e) => e.status === "upcoming" && e.startsAt > now
    && e.region === settings.region && enabledStores(settings).includes(storeOf(e))).map((e) => e.startsAt));
  if (settings.notificationsEnabled) {
    if (state.pendingQuietCount && isQuietHoursActive(settings, now))
      candidates.push(quietEndAfter(settings, now));
    if (settings.remindersEnabled) {
      for (const e of visibleEntries(entries, settings, actions, now)) {
        if (
          !e.endsAt ||
          e.endsAt <= now ||
          notified[e.id]?.fingerprint !== e.fingerprint ||
          notified[`${e.id}:reminder`]?.fingerprint === e.fingerprint
        )
          continue;
        const target = e.endsAt - settings.reminderHours * 3600000;
        let due =
          target > now
            ? target
            : Math.max(
                now + 30000,
                Math.min(now + 15 * 60000, e.endsAt - 60000),
              );
        due = quietEndAfter(settings, due);
        if (due < e.endsAt) candidates.push(due);
      }
    }
  }
  return candidates.length ? Math.max(now + 30000, Math.min(...candidates)) : 0;
}
export async function scheduleFollowup(settings) {
  const [entries, actions, notified, state, upcoming] = await Promise.all([
    getLatestPromotionEntries(),
    getActions(),
    readKey("notifiedPromotions", {}),
    getRuntimeState(),
    readKey("upcomingPromotions", []),
  ]);
  const when = getFollowupTime([...entries, ...upcoming], settings, actions, notified, state);
  if (when) await chrome.alarms.create(FOLLOWUP_ALARM_NAME, { when });
  else await chrome.alarms.clear(FOLLOWUP_ALARM_NAME);
  return when;
}
