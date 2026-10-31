import { storeOf, enabledStores, scanKey } from "./stores.js";
import {
  STORAGE_KEYS,
  MAX_HISTORY_ITEMS,
  MAX_LATEST_ITEMS,
} from "./constants.js";
import {
  buildPromotionIdentity,
  buildPromotionFingerprint,
  shouldNotifyPromotion,
  markPromotionsNotified,
} from "./dedupe.js";
import { applyPromotionFilters } from "./filters.js";
import {
  getHistoryEntries,
  getLatestPromotionEntries,
  mergePromotionEntries,
  sanitizePromotionEntry,
  countUnreadActive,
} from "./history.js";
import { createPromotionNotifications } from "./notifications.js";
import { fetchPromotionsFromProviders } from "./providers/index.js";
import {
  buildRecoveredRuntimeState,
  getRuntimeState,
  setRuntimeState,
} from "./runtime-state.js";
import { getSettings } from "./settings.js";
import { readKey, writeLocal } from "./storage.js";
import { isQuietHoursActive } from "./utils.js";
import { actionState, getActions, changeAction } from "./actions.js";
import { mutate } from "./queue.js";

let activeCheckPromise = null;
export async function recoverInterruptedCheckState(now = Date.now()) {
  return mutate(async () => {
    const state = await getRuntimeState();
    if (activeCheckPromise || !state.checkInProgress) return state;
    const recovered = buildRecoveredRuntimeState(state, now);
    await writeLocal({ runtimeState: recovered });
    return recovered;
  });
}
export function visibleEntries(entries, settings, actions, now = Date.now()) {
  return applyPromotionFilters(
    entries.filter(
      (e) =>
        e.status === "active" &&
        (!e.startsAt || e.startsAt <= now) &&
        (!e.endsAt || e.endsAt > now) &&
        (e.region || "US") === settings.region &&
        !actionState(e, actions, now),
    ),
    settings,
  ).accepted;
}
export async function refreshCounts() {
  const [entries, settings, actions] = await Promise.all([
    getLatestPromotionEntries(),
    getSettings(),
    getActions(),
  ]);
  const visible = visibleEntries(entries, settings, actions);
  return setRuntimeState({
    unreadCount: countUnreadActive(visible),
    activeFreeToKeepCount: visible.length,
  });
}
export function assignCampaigns(promotions, existing, now) {
  const previous = new Map();
  for (const e of existing)
    if (!previous.has(buildPromotionIdentity(e)))
      previous.set(buildPromotionIdentity(e), e);
  return promotions.map((p) => {
    const id = buildPromotionIdentity(p);
    const old = previous.get(id);
    // Only a previously confirmed end establishes a new cycle. HTML is never a campaign key.
    const newCycle =
      old &&
      old.status === "expired" &&
      (old.confirmedEnded || (old.endsAt > 0 && old.endsAt <= now)) &&
      (!p.endsAt || p.endsAt > now);
    const campaignId = newCycle ? `${id}:${now}` : old?.campaignId || id;
    return {
      ...p,
      ...(old?.importedAt && !newCycle ? {
        firstSeenAt: old.firstSeenAt,
        lastNotifiedAt: old.lastNotifiedAt,
        notificationStatus: old.notificationStatus,
      } : {}),
      id,
      campaignId,
      importedAt: newCycle ? 0 : old?.importedAt || 0,
      fingerprint: buildPromotionFingerprint({ ...p, campaignId }),
      confirmedEnded: false,
    };
  });
}
async function performPromotionCheck(trigger) {
  const started = Date.now();
  const settings = await getSettings();
  if (!settings.trackFreeToKeep || !enabledStores(settings).length) {
    const runtimeState = await mutate(() =>
      setRuntimeState({
        checkInProgress: false,
        lastCheckOutcome: "paused",
        lastErrorMessage: "",
        pendingQuietCount: 0,
      }),
    );
    return { ok: true, runtimeState };
  }
  await mutate(() =>
    setRuntimeState({
      checkInProgress: true,
      lastCheckStartedAt: started,
      lastCheckOutcome: "running",
      lastErrorMessage: "",
      lastTrigger: trigger,
    }),
  );
  try {
    const known = await getLatestPromotionEntries();
    const result = await fetchPromotionsFromProviders(settings, known);

    return await mutate(async () => {
      const currentSettings = await getSettings();
      if (
        !currentSettings.trackFreeToKeep ||
        scanKey(currentSettings) !== scanKey(settings)
      ) {
        const runtimeState = await setRuntimeState({
          checkInProgress: false,
          lastCheckOutcome: currentSettings.trackFreeToKeep ? "idle" : "paused",
        });
        return { ok: true, discarded: true, runtimeState };
      }
      const now = Date.now();
      const previousDiagnostics = await readKey("diagnostics", {});
      const storeResults = { ...previousDiagnostics.storeResults };
      for (const [store, state] of Object.entries(result.storeResults)) {
        storeResults[store] = { ...state, region: settings.region,
          lastSuccessAt: state.ok ? now : previousDiagnostics.storeResults?.[store]?.region === settings.region
            ? previousDiagnostics.storeResults[store].lastSuccessAt || 0 : 0 };
      }
      if (!result.hadSuccess) {
        await writeLocal({ diagnostics: { checkedAt: now, region: settings.region, complete: false,
          sources: result.sources, storeResults, warnings: result.warnings, found: 0, rejected: [] } });
        throw new Error(result.warnings.join("; ") || "No source available");
      }
      const [history, latest, actions] = await Promise.all([
        getHistoryEntries(),
        getLatestPromotionEntries(),
        getActions(),
      ]);
      const promotions = assignCampaigns(
        result.promotions,
        [...latest, ...history],
        now,
      );
      const mergeOptions = {
        retentionDays: currentSettings.historyRetentionDays,
        complete: result.complete,
        storeResults: result.storeResults,
        confirmedEnded: result.confirmedEnded,
      };
      let nextLatest = mergePromotionEntries(latest, promotions, now, {
        ...mergeOptions,
        maxItems: MAX_LATEST_ITEMS,
      }).entries;
      let nextHistory = currentSettings.historyEnabled
        ? mergePromotionEntries(history, promotions, now, {
            ...mergeOptions,
            maxItems: MAX_HISTORY_ITEMS,
          }).entries
        : history;
      let notified = await readKey(STORAGE_KEYS.notifiedPromotions, {});
      const visible = visibleEntries(nextLatest, currentSettings, actions, now);
      const fresh = visible.filter((e) => !e.stale);
      const quiet = isQuietHoursActive(currentSettings, now);
      const pending = fresh.filter(
        (e) =>
          shouldNotifyPromotion(e, notified, currentSettings, now)
            .shouldNotify ||
          (actions[e.stableId]?.snoozePending &&
            actions[e.stableId].snoozedUntil <= now),
      );
      const pendingIds = new Set(pending.map((e) => e.id));
      const reminders = currentSettings.remindersEnabled
        ? fresh.filter(
            (e) =>
              !e.importedAt &&
              !pendingIds.has(e.id) &&
              e.endsAt > now &&
              e.endsAt - now <= currentSettings.reminderHours * 3600000 &&
              notified[e.id]?.fingerprint === e.fingerprint &&
              notified[e.id]?.lastNotifiedAt < now - 60000 &&
              notified[`${e.id}:reminder`]?.fingerprint !== e.fingerprint,
          )
        : [];
      let sent = 0;
      const notificationErrors = [];
      // Persist the scan before optional OS delivery; OS errors must not erase a valid result.
      const previousUpcoming = await readKey("upcomingPromotions", []);
      const upcomingById = new Map(previousUpcoming.filter((p) =>
        p.region === settings.region && p.startsAt > now && !result.storeResults[storeOf(p)]?.complete,
      ).map((p) => [p.stableId, { ...p, stale: true }]));
      for (const p of result.upcoming) upcomingById.set(p.stableId, sanitizePromotionEntry({
        ...p, id: buildPromotionIdentity(p), status: "upcoming", firstSeenAt: now, lastCheckedAt: now,
      }));
      await writeLocal({
        history: nextHistory,
        latestPromotions: nextLatest,
        upcomingPromotions: [...upcomingById.values()].slice(0, MAX_LATEST_ITEMS),
        metadataCache: result.metadataCache,
      });
      if (currentSettings.notificationsEnabled && !quiet) {
        for (const [items, reminder] of [
          [pending, false],
          [reminders, true],
        ]) {
          if (!items.length) continue;
          await createPromotionNotifications(items, {
            settings: currentSettings,
            reminder,
            onDelivered: async (delivered) => {
              sent += delivered.length;
              const records = delivered.map((e) =>
                reminder ? { ...e, id: `${e.id}:reminder` } : e,
              );
              notified = markPromotionsNotified(notified, records, now, {
                ...currentSettings,
                renotifyAfterRetention: false,
              });
              const ids = new Set(delivered.map((e) => e.id));
              for (const e of delivered)
                if (
                  actions[e.stableId]?.snoozePending &&
                  actions[e.stableId].snoozedUntil <= now
                ) {
                  actions[e.stableId].snoozePending = false;
                  actions[e.stableId].snoozedUntil = 0;
                }
              if (!reminder) {
                const update = (entries) =>
                  entries.map((e) =>
                    ids.has(e.id)
                      ? {
                          ...e,
                          lastNotifiedAt: now,
                          notificationStatus: "sent",
                        }
                      : e,
                  );
                nextLatest = update(nextLatest);
                nextHistory = update(nextHistory);
              }
              await writeLocal({
                notifiedPromotions: notified,
                latestPromotions: nextLatest,
                history: nextHistory,
                userActions: actions,
              });
            },
            onError: (error) =>
              notificationErrors.push(String(error.message || error)),
          });
        }
      }
      const filterResult = applyPromotionFilters(
        nextLatest.filter((e) => e.status === "active"),
        currentSettings,
      );
      const diagnostics = {
        checkedAt: now,
        region: currentSettings.region,
        complete: result.complete,
        durationMs: now - started,
        sources: result.sources,
        storeResults,
        warnings: [...result.warnings, ...notificationErrors],
        found: promotions.length,
        rejected: filterResult.rejected.map(({ promotion, reason }) => ({
          stableId: promotion.stableId,
          title: promotion.title,
          reason,
        })),
      };
      await writeLocal({ diagnostics });
      const runtimeState = await setRuntimeState({
        checkInProgress: false,
        lastCheckFinishedAt: now,
        lastSuccessAt: now,
        lastFullSuccessAt: result.complete
          ? now
          : (await getRuntimeState()).lastFullSuccessAt,
        lastCheckOutcome: result.complete ? "success" : "partial",
        lastErrorMessage: "",
        lastProviderSummary: result.warnings.join("; "),
        pendingQuietCount:
          currentSettings.notificationsEnabled && quiet
            ? pending.length + reminders.length
            : 0,
        backoffLevel: 0,
        lastResultCount: promotions.length,
        unreadCount: countUnreadActive(visible),
        activeFreeToKeepCount: visible.length,
      });
      return {
        ok: true,
        notificationsSent: sent,
        promotionsFound: promotions.length,
        runtimeState,
      };
    });
  } catch (error) {
    return mutate(async () => {
      const currentSettings = await getSettings();
      if (
        !currentSettings.trackFreeToKeep ||
        scanKey(currentSettings) !== scanKey(settings)
      ) {
        const runtimeState = await setRuntimeState({
          checkInProgress: false,
          lastCheckOutcome: currentSettings.trackFreeToKeep ? "idle" : "paused",
          lastErrorMessage: "",
        });
        return { ok: true, discarded: true, runtimeState };
      }
      const state = await getRuntimeState();
      const runtimeState = await setRuntimeState({
        checkInProgress: false,
        lastCheckFinishedAt: Date.now(),
        lastCheckOutcome: "error",
        lastErrorMessage: String(error.message || error),
        backoffLevel: Math.min((state.backoffLevel || 0) + 1, 6),
      });
      return { ok: false, error: "sourceError", runtimeState };
    });
  }
}
export function runPromotionCheck(trigger = "manual") {
  if (!activeCheckPromise)
    activeCheckPromise = performPromotionCheck(trigger).finally(() => {
      activeCheckPromise = null;
    });
  return activeCheckPromise;
}
export async function markPromotionsRead(ids = null) {
  return mutate(async () => {
    const [history, latest] = await Promise.all([
      getHistoryEntries(),
      getLatestPromotionEntries(),
    ]);
    const selected = ids === null ? null : new Set(ids);
    const mark = (entries) =>
      entries.map((e) =>
        !selected || selected.has(e.id) ? { ...e, unread: false } : e,
      );
    await writeLocal({
      history: mark(history),
      latestPromotions: mark(latest),
    });
    return { ok: true, runtimeState: await refreshCounts() };
  });
}
export const markAllPromotionsRead = () => markPromotionsRead();
export async function dismissPromotionById(id) {
  const entries = await getLatestPromotionEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return { ok: false, error: "notFound" };
  return changeAction(entry.stableId, "ignore", { title: entry.title });
}
export const restorePromotionById = (stableId) =>
  changeAction(stableId, "restore");
export async function getIgnoredPromotions() {
  return Object.entries(await getActions())
    .map(([stableId, action]) => ({ stableId, ...action }))
    .filter(
      (a) =>
        a.ignored ||
        a.claimed ||
        a.hiddenCampaign ||
        a.snoozedUntil > Date.now(),
    );
}
export async function clearStoredHistory() {
  await mutate(() => writeLocal({ history: [] }));
  return { ok: true };
}
