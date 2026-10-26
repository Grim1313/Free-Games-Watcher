import { scanKey, enabledStores, storeOf } from "./lib/stores.js";
import { CHECK_ALARM_NAME, FOLLOWUP_ALARM_NAME } from "./lib/constants.js";
import { updateBadge } from "./lib/badge.js";
import { getHistoryEntries, getLatestPromotionEntries } from "./lib/history.js";
import {
  clearNotificationTarget,
  openNotificationTarget,
  sendTestNotification,
} from "./lib/notifications.js";
import {
  clearStoredHistory,
  markPromotionsRead,
  recoverInterruptedCheckState,
  runPromotionCheck,
  refreshCounts,
  visibleEntries,
} from "./lib/promotions.js";
import { getRuntimeState, setRuntimeState } from "./lib/runtime-state.js";
import { getSettings, resetSettings, saveSettings } from "./lib/settings.js";
import { ensureSchemaVersion, readKey, writeLocal } from "./lib/storage.js";
import {
  ensureCheckAlarm,
  resetCheckAlarm,
  scheduleCheckIn,
  scheduleAfterError,
  scheduleAfterSuccess,
  scheduleFollowup,
} from "./lib/scheduler.js";
import { mutate } from "./lib/queue.js";
import { getActions, changeAction } from "./lib/actions.js";
import { exportBackup, importBackup, validateBackup } from "./lib/backup.js";

async function updateDerived() {
  const settings = await getSettings();
  const state = await mutate(refreshCounts);
  await updateBadge(state, settings);
  await scheduleFollowup(settings);
}
async function bootstrap() {
  await mutate(ensureSchemaVersion);
  await recoverInterruptedCheckState();
  await ensureCheckAlarm(await getSettings());
  await updateDerived();
}
// Register listeners synchronously, and guard all entry points with initialization.
const ready = bootstrap();
ready.catch(() => undefined);
let scheduledRun = null;
async function runAndReschedule(trigger) {
  await ready;
  if (scheduledRun) return scheduledRun;
  scheduledRun = (async () => {
    const result = await runPromotionCheck(trigger);
    const settings = await getSettings();
    if (!result.ok)
      await scheduleAfterError(settings, result.runtimeState.backoffLevel || 1);
    else if (result.discarded || trigger === "manual" || trigger === "followup")
      await ensureCheckAlarm(settings);
    else await scheduleAfterSuccess(settings);
    await updateDerived();
    return result;
  })().finally(() => {
    scheduledRun = null;
  });
  return scheduledRun;
}
async function getData() {
  const [
    settings,
    runtimeState,
    latestPromotions,
    historyEntries,
    userActions,
    diagnostics,
    upcomingPromotions,
  ] = await Promise.all([
    getSettings(),
    recoverInterruptedCheckState(),
    getLatestPromotionEntries(),
    getHistoryEntries(),
    getActions(),
    readKey("diagnostics", {}),
    readKey("upcomingPromotions", []),
  ]);
  return {
    ok: true,
    settings,
    runtimeState,
    latestPromotions,
    historyEntries,
    userActions,
    diagnostics,
    upcomingPromotions: upcomingPromotions.filter((p) => p.region === settings.region && p.startsAt > Date.now()
      && enabledStores(settings).includes(storeOf(p))),
    visiblePromotions: visibleEntries(latestPromotions, settings, userActions),
  };
}
chrome.runtime.onInstalled.addListener(() => {
  runAndReschedule("install").catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  ready.catch(() => undefined);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if ([CHECK_ALARM_NAME, FOLLOWUP_ALARM_NAME].includes(alarm.name))
    runAndReschedule(
      alarm.name === FOLLOWUP_ALARM_NAME ? "followup" : "scheduled",
    ).catch(() => undefined);
});
chrome.notifications.onClicked.addListener((id) => {
  openNotificationTarget(id)
    .then(() => chrome.notifications.clear(id))
    .then(() => mutate(() => clearNotificationTarget(id)))
    .catch(() => undefined);
});
chrome.notifications.onClosed.addListener((id) => {
  mutate(() => clearNotificationTarget(id)).catch(() => undefined);
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (sender.id && sender.id !== chrome.runtime.id)
      throw new Error("invalidData");
    await ready;
    switch (message?.type) {
      case "GET_POPUP_DATA":
      case "GET_OPTIONS_DATA":
      case "GET_HISTORY_DATA":
      case "GET_DIAGNOSTICS":
        return getData();
      case "CHECK_NOW":
        return runAndReschedule("manual");
      case "MARK_ALL_READ":
      case "MARK_READ": {
        if (message.type === "MARK_READ" && !Array.isArray(message.ids))
          throw new Error("invalidData");
        await markPromotionsRead(
          message.type === "MARK_ALL_READ" ? null : message.ids,
        );
        await updateDerived();
        return { ok: true };
      }
      case "SET_ACTION": {
        const result = await changeAction(
          message.stableId,
          message.action,
          message.payload || {},
        );
        await updateDerived();
        return result;
      }
      case "SAVE_SETTINGS": {
        let scheduleChanged = false;
        let checkSoon = false;
        const settings = await mutate(async () => {
          const old = await getSettings();
          const next = await saveSettings(message.settings || {});
          scheduleChanged =
            next.checkIntervalMinutes !== old.checkIntervalMinutes ||
            next.trackFreeToKeep !== old.trackFreeToKeep ||
            scanKey(next) !== scanKey(old);
          checkSoon =
            next.trackFreeToKeep && enabledStores(next).length > 0 &&
            (!old.trackFreeToKeep || scanKey(next) !== scanKey(old));
          if (scanKey(next) !== scanKey(old)) {
            await writeLocal({ metadataCache: {} });
            await setRuntimeState({
              lastSuccessAt: 0,
              lastFullSuccessAt: 0,
              lastErrorMessage: "",
              lastProviderSummary: "",
              pendingQuietCount: 0,
              lastCheckOutcome: next.trackFreeToKeep ? "idle" : "paused",
            });
          }
          if (next.trackFreeToKeep && !old.trackFreeToKeep)
            await setRuntimeState({ lastCheckOutcome: "idle" });
          return next;
        });
        if (checkSoon) await scheduleCheckIn(30000);
        else if (scheduleChanged) await resetCheckAlarm(settings);
        else await ensureCheckAlarm(settings);
        await updateDerived();
        return { ok: true, settings };
      }
      case "RESET_SETTINGS": {
        const settings = await mutate(resetSettings);
        await resetCheckAlarm(settings);
        await updateDerived();
        return { ok: true, settings };
      }
      case "CLEAR_HISTORY":
        return clearStoredHistory();
      case "TEST_NOTIFICATION":
        await sendTestNotification(await getSettings());
        return { ok: true };
      case "EXPORT_BACKUP":
        return { ok: true, data: await exportBackup() };
      case "VALIDATE_BACKUP": {
        const data = validateBackup(message.data);
        return {
          ok: true,
          count: Object.keys(data.userActions).length,
          region: data.settings.region,
        };
      }
      case "IMPORT_BACKUP": {
        const result = await importBackup(message.data);
        await resetCheckAlarm(result.settings);
        await updateDerived();
        return result;
      }
      default:
        throw new Error("invalidData");
    }
  })()
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ ok: false, error: error.message || "operationFailed" }),
    );
  return true;
});
