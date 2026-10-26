import test from "node:test";
import assert from "node:assert/strict";
import { environment, entry, steamFetch, response } from "./helpers.mjs";
import { sanitizeSettings } from "../src/lib/settings.js";
import {
  assignCampaigns,
  runPromotionCheck,
  markPromotionsRead,
  clearStoredHistory,
  visibleEntries,
} from "../src/lib/promotions.js";
import { actionState, changeAction } from "../src/lib/actions.js";
import {
  buildPromotionIdentity,
  buildPromotionFingerprint,
  shouldNotifyPromotion,
} from "../src/lib/dedupe.js";
import { mergePromotionEntries } from "../src/lib/history.js";
import { applyPromotionFilters, getStatusLabel } from "../src/lib/filters.js";
import { ensureSchemaVersion } from "../src/lib/storage.js";
import {
  exportBackup,
  importBackup,
  validateBackup,
} from "../src/lib/backup.js";
import {
  ensureCheckAlarm,
  getFollowupTime,
  quietEndAfter,
} from "../src/lib/scheduler.js";
import { CHECK_ALARM_NAME } from "../src/lib/constants.js";
import {
  createPromotionNotifications,
  openNotificationTarget,
} from "../src/lib/notifications.js";
import { getTranslator } from "../src/lib/i18n.js";
import { setRuntimeState } from "../src/lib/runtime-state.js";

const settings = (extra) => sanitizeSettings(extra);
test("campaign identity survives provider, HTML and deadline updates", () => {
  const a = entry(),
    b = {
      ...a,
      sourceId: "fallback",
      sourceFingerprint: "changed HTML",
      endsAt: Date.now() + 86400000,
    };
  assert.equal(buildPromotionIdentity(a), buildPromotionIdentity(b));
  assert.equal(buildPromotionFingerprint(a), buildPromotionFingerprint(b));
  assert.equal(
    shouldNotifyPromotion(
      b,
      { [a.id]: { fingerprint: a.fingerprint, lastNotifiedAt: Date.now() } },
      settings(),
      Date.now(),
    ).shouldNotify,
    false,
  );
});
test("only a confirmed end opens a new campaign", () => {
  const now = Date.now(),
    p = entry();
  assert.equal(
    assignCampaigns([p], [{ ...p, stale: true }], now)[0].fingerprint,
    p.fingerprint,
  );
  assert.notEqual(
    assignCampaigns(
      [p],
      [{ ...p, status: "expired", confirmedEnded: true }],
      now,
    )[0].fingerprint,
    p.fingerprint,
  );
});
test("missing and partial search results preserve offers; confirmed end expires them", () => {
  const e = entry();
  const merge = (opts) =>
    mergePromotionEntries([e], [], Date.now(), opts).entries[0];
  assert.equal(merge({ complete: false }).status, "active");
  assert.equal(merge({ complete: true }).status, "active");
  assert.equal(merge({}).stale, true);
  assert.equal(
    merge({ confirmedEnded: new Set([e.stableId]) }).status,
    "expired",
  );
});
test("known elapsed deadline disappears even when search retains a stale row", () => {
  const now = Date.now();
  assert.equal(
    mergePromotionEntries([], [entry({ endsAt: now - 1 })], now).entries[0]
      .status,
    "expired",
  );
  assert.equal(getStatusLabel("expired", "sent"), "Ended");
});
test("filters combine rating sample size, genres and platforms", () => {
  const s = settings({
    filters: {
      minRating: 80,
      minReviews: 100,
      genres: ["Action"],
      platforms: ["linux"],
    },
  });
  const good = entry({
    reviewPercent: 90,
    reviewTotal: 120,
    genres: ["Action"],
    platforms: ["linux"],
  });
  assert.equal(applyPromotionFilters([good], s).accepted.length, 1);
  for (const patch of [
    { reviewPercent: 70 },
    { reviewTotal: 50 },
    { genres: ["RPG"] },
    { platforms: ["windows"] },
  ])
    assert.equal(
      applyPromotionFilters([{ ...good, ...patch }], s).accepted.length,
      0,
    );
});
test("unrated review policy is explicit", () => {
  assert.equal(
    applyPromotionFilters(
      [entry()],
      settings({ filters: { includeUnrated: false } }),
    ).accepted.length,
    0,
  );
  assert.equal(
    applyPromotionFilters(
      [entry()],
      settings({ filters: { minRating: 90, includeUnrated: true } }),
    ).accepted.length,
    1,
  );
  assert.equal(
    applyPromotionFilters(
      [entry()],
      settings({ filters: { minRating: 90, includeUnrated: false } }),
    ).accepted.length,
    0,
  );
});
test("claim, temporary hiding, snooze and permanent ignore have distinct scopes", () => {
  const e = entry(),
    now = Date.now();
  assert.equal(
    actionState(e, { [e.stableId]: { claimed: true } }, now),
    "claimed",
  );
  assert.equal(
    actionState(
      { ...e, fingerprint: "next" },
      { [e.stableId]: { hiddenCampaign: e.fingerprint } },
      now,
    ),
    "",
  );
  assert.equal(
    actionState(e, { [e.stableId]: { snoozedUntil: now - 1 } }, now),
    "",
  );
  assert.equal(
    actionState(
      { ...e, fingerprint: "next" },
      { [e.stableId]: { ignored: true } },
      now,
    ),
    "ignored",
  );
});
test("actions can be undone without clearing other games", async (t) => {
  const { data } = environment(t);
  const result = await changeAction("app:123", "claim", { title: "Game" });
  await changeAction("app:456", "ignore");
  await changeAction("app:123", "undo", { previous: result.previous });
  assert.ok(!data.userActions["app:123"]);
  assert.equal(data.userActions["app:456"].ignored, true);
});
test("marking displayed entries read preserves entries not displayed", async (t) => {
  const entries = Array.from({ length: 11 }, (_, i) => entry({ id: `p${i}` }));
  const { data } = environment(t, {
    latestPromotions: entries,
    history: entries,
  });
  await markPromotionsRead(entries.slice(0, 10).map((e) => e.id));
  assert.equal(data.latestPromotions[10].unread, true);
  assert.equal(data.history[0].unread, false);
});
test("clearing archive keeps active offers and personal marks", async (t) => {
  const { data } = environment(t, {
    history: [entry()],
    latestPromotions: [entry()],
    userActions: { "app:123": { claimed: true } },
  });
  await clearStoredHistory();
  assert.equal(data.history.length, 0);
  assert.equal(data.latestPromotions.length, 1);
  assert.equal(data.userActions["app:123"].claimed, true);
});
test("0.5.0 migration preserves ignored titles and delivered notifications across sources", async (t) => {
  const old = entry({
    id: "app:123|free-to-keep|steam-store-search",
    fingerprint: "old-html",
    status: "dismissed",
  });
  const { data } = environment(t, {
    schemaVersion: 1,
    history: [old],
    latestPromotions: [old],
    notifiedPromotions: {
      [old.id]: { fingerprint: "old-html", lastNotifiedAt: 100 },
    },
    dismissedPromotions: {
      [old.id]: { stableId: "app:123", title: "Test game", dismissedAt: 123 },
    },
  });
  await ensureSchemaVersion();
  assert.equal(data.schemaVersion, 3);
  assert.equal(data.userActions["app:123"].ignored, true);
  assert.equal(data.latestPromotions[0].id, "app:123|free-to-keep");
  assert.equal(
    data.notifiedPromotions["app:123|free-to-keep"].fingerprint,
    data.latestPromotions[0].fingerprint,
  );
  const snapshot = JSON.stringify(data);
  await ensureSchemaVersion();
  assert.equal(JSON.stringify(data), snapshot);
});
test("backup round trip excludes operational caches and validates before writing", async (t) => {
  const { data } = environment(t, {
    settings: settings({ region: "DE", language: "ru" }),
    userActions: { "app:123": { claimed: true, title: "Title" } },
    metadataCache: { secret: "not exported" },
  });
  const backup = await exportBackup();
  assert.ok(!backup.metadataCache);
  await importBackup(JSON.stringify(backup));
  assert.equal(data.settings.region, "DE");
  assert.equal(data.userActions["app:123"].claimed, true);
  const before = JSON.stringify(data);
  await assert.rejects(importBackup("{bad"), /invalidBackup/);
  assert.equal(JSON.stringify(data), before);
  assert.throws(
    () => validateBackup({ ...backup, version: 999 }),
    /unsupportedBackup/,
  );
  assert.throws(
    () => validateBackup({ ...backup, userActions: { bad: {} } }),
    /invalidBackup/,
  );
});
test("paused tracking performs no network access and is not an error", async (t) => {
  const { data } = environment(t, {
    settings: settings({ trackFreeToKeep: false }),
  });
  globalThis.fetch = () => {
    throw new Error("must not fetch");
  };
  assert.equal((await runPromotionCheck()).ok, true);
  assert.equal(data.runtimeState.lastCheckOutcome, "paused");
});
test("scan deduplicates, commits metadata and does not repeat the same notification", async (t) => {
  const { data, notifications } = environment(t, { settings: settings() });
  globalThis.fetch = steamFetch();
  assert.equal((await runPromotionCheck()).ok, true);
  assert.equal(data.latestPromotions.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal((await runPromotionCheck()).ok, true);
  assert.equal(notifications.length, 1);
});
test("an action and read mark made during a network request survive the scan", async (t) => {
  const { data, notifications } = environment(t, {
    settings: settings(),
    latestPromotions: [entry()],
    history: [entry()],
  });
  let release, started;
  const gate = new Promise((r) => (release = r)),
    waiting = new Promise((r) => (started = r));
  const fetch = steamFetch();
  let once = false;
  globalThis.fetch = async (url) => {
    if (!once) {
      once = true;
      started();
      await gate;
    }
    return fetch(url);
  };
  const check = runPromotionCheck();
  await waiting;
  await changeAction("app:123", "claim");
  await markPromotionsRead([entry().id]);
  release();
  await check;
  assert.equal(data.latestPromotions[0].unread, false);
  assert.equal(data.userActions["app:123"].claimed, true);
  assert.equal(notifications.length, 0);
});
test("region changes discard in-flight results from the old region", async (t) => {
  const { data } = environment(t, { settings: settings() });
  let release, started;
  const gate = new Promise((r) => (release = r)),
    waiting = new Promise((r) => (started = r));
  const fetch = steamFetch();
  let once = false;
  globalThis.fetch = async (url) => {
    if (!once) {
      once = true;
      started();
      await gate;
    }
    return fetch(url);
  };
  const check = runPromotionCheck();
  await waiting;
  data.settings.region = "DE";
  release();
  assert.equal((await check).discarded, true);
  assert.ok(!data.latestPromotions);
});
for (const change of ["region", "pause"]) {
  test(`failed old request is discarded after ${change} changes`, async (t) => {
    const { data } = environment(t, { settings: settings() });
    let release, started;
    const gate = new Promise((r) => (release = r));
    const waiting = new Promise((r) => (started = r));
    globalThis.fetch = async () => {
      started();
      await gate;
      throw new Error("network failure");
    };
    const check = runPromotionCheck();
    await waiting;
    if (change === "region") data.settings.region = "DE";
    else data.settings.trackFreeToKeep = false;
    release();
    const result = await check;
    assert.equal(result.ok, true);
    assert.equal(result.discarded, true);
    assert.equal(
      data.runtimeState.lastCheckOutcome,
      change === "region" ? "idle" : "paused",
    );
    assert.equal(data.runtimeState.lastErrorMessage, "");
  });
}

test("quiet hours retain pending offers and send only after the quiet interval", async (t) => {
  const realNow = Date.now;
  let now = new Date(2026, 9, 23, 23, 30).getTime();
  Date.now = () => now;
  t.after(() => (Date.now = realNow));
  const { data, notifications } = environment(t, {
    settings: settings({
      quietHoursEnabled: true,
      quietHoursStart: "23:00",
      quietHoursEnd: "08:00",
    }),
  });
  globalThis.fetch = steamFetch();
  await runPromotionCheck();
  assert.equal(notifications.length, 0);
  assert.equal(data.runtimeState.pendingQuietCount, 1);
  assert.equal(
    quietEndAfter(data.settings, now),
    new Date(2026, 9, 24, 8).getTime(),
  );
  now = new Date(2026, 9, 24, 8).getTime();
  await runPromotionCheck("followup");
  assert.equal(notifications.length, 1);
  assert.equal(data.runtimeState.pendingQuietCount, 0);
});
test("deadline reminder sends once and is suppressed for claimed games", async (t) => {
  const { data, notifications } = environment(t, {
    settings: settings({ reminderHours: 48 }),
  });
  globalThis.fetch = steamFetch();
  await runPromotionCheck();
  data.notifiedPromotions[entry().id].lastNotifiedAt -= 120000;
  await runPromotionCheck("followup");
  assert.equal(notifications.length, 2);
  await runPromotionCheck("followup");
  assert.equal(notifications.length, 2);
  delete data.notifiedPromotions[`${entry().id}:reminder`];
  await changeAction("app:123", "claim");
  await runPromotionCheck();
  assert.equal(notifications.length, 2);
});
test("OS notification failure retains scan data and retries later", async (t) => {
  const { data } = environment(t, { settings: settings() });
  globalThis.fetch = steamFetch();
  chrome.notifications.create = async () => {
    throw new Error("OS denied");
  };
  assert.equal((await runPromotionCheck()).ok, true);
  assert.equal(data.latestPromotions.length, 1);
  assert.ok(!data.notifiedPromotions?.[entry().id]);
  let calls = 0;
  chrome.notifications.create = async () => {
    calls++;
  };
  await runPromotionCheck();
  assert.equal(calls, 1);
});
test("notification batch summary points to the extension list and acknowledges only delivered groups", async (t) => {
  const { data } = environment(t);
  let calls = 0;
  chrome.notifications.create = async () => {
    calls++;
    if (calls === 2 || calls === 3) throw new Error("failed");
  };
  const delivered = [];
  const entries = Array.from({ length: 6 }, (_, i) =>
    entry({
      id: `p${i}`,
      fingerprint: `p${i}`,
      appId: 0,
      stableId: `sub:${i + 1}`,
    }),
  );
  await createPromotionNotifications(entries, {
    onDelivered: (group) => delivered.push(...group.map((e) => e.id)),
    onError: () => {},
  });
  assert.ok(!delivered.includes("p1"));
  const summary = Object.entries(data.notificationLinks).find(([, v]) =>
    v.url.endsWith("/history.html"),
  );
  assert.ok(summary);
  let opened;
  chrome.tabs.create = async (options) => {
    opened = options.url;
  };
  await openNotificationTarget(summary[0]);
  assert.equal(opened, "chrome-extension://test/src/ui/history.html");
});
test("lost alarm is restored promptly when last scan is overdue", async (t) => {
  const now = Date.now();
  const { alarms } = environment(t, {
    runtimeState: { lastSuccessAt: now - 86400000, nextCheckAt: now - 60000 },
  });
  await ensureCheckAlarm(settings());
  assert.ok(alarms.get(CHECK_ALARM_NAME).scheduledTime <= Date.now() + 31000);
  await ensureCheckAlarm(settings({ trackFreeToKeep: false }));
  assert.ok(!alarms.has(CHECK_ALARM_NAME));
});
test("followup planning respects quiet hours, snooze, expiry and reminder delivery", () => {
  const now = new Date(2026, 9, 23, 23, 30).getTime(),
    s = settings({ quietHoursEnabled: true });
  assert.equal(
    getFollowupTime([], s, {}, {}, { pendingQuietCount: 1 }, now),
    new Date(2026, 9, 24, 8).getTime(),
  );
  assert.equal(
    getFollowupTime([entry({ endsAt: now - 1 })], s, {}, {}, {}, now),
    0,
  );
  assert.equal(
    getFollowupTime(
      [],
      s,
      { "app:123": { snoozedUntil: now + 3600000 } },
      {},
      {},
      now,
    ),
    now + 3600000,
  );
});
test("runtime writes preserve concurrent status and alarm patches", async (t) => {
  const { data } = environment(t);
  await Promise.all([
    setRuntimeState({ nextCheckAt: 123 }),
    setRuntimeState({ unreadCount: 5 }),
  ]);
  assert.equal(data.runtimeState.nextCheckAt, 123);
  assert.equal(data.runtimeState.unreadCount, 5);
});
test("English and Russian translations cover the same UI and notification keys", async () => {
  const { readFile } = await import("node:fs/promises");
  const en = JSON.parse(
    await readFile(new URL("../_locales/en/messages.json", import.meta.url)),
  );
  const ru = JSON.parse(
    await readFile(new URL("../_locales/ru/messages.json", import.meta.url)),
  );
  assert.deepEqual(Object.keys(en), Object.keys(ru));
  assert.equal((await getTranslator("ru"))("claim"), "Уже забрал");
  assert.equal((await getTranslator("en"))("claim"), "Already claimed");
});

test("snooze sends again when due even if the original alert was delivered", async (t) => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  t.after(() => (Date.now = realNow));
  const { data, notifications } = environment(t, {
    settings: settings({ remindersEnabled: false }),
  });
  globalThis.fetch = steamFetch();
  await runPromotionCheck();
  await changeAction("app:123", "snooze", { hours: 1 });
  now += 30 * 60000;
  await runPromotionCheck();
  assert.equal(notifications.length, 1);
  now += 31 * 60000;
  await runPromotionCheck("followup");
  assert.equal(notifications.length, 2);
  assert.equal(data.userActions["app:123"].snoozePending, false);
  await runPromotionCheck();
  assert.equal(notifications.length, 2);
});
test("known end and future reminder times wake the scheduler at the actual deadline", () => {
  const now = Date.now(),
    e = entry({ endsAt: now + 185 * 60000 });
  const record = { [e.id]: { fingerprint: e.fingerprint } };
  assert.equal(
    getFollowupTime([e], settings({ reminderHours: 3 }), {}, record, {}, now),
    now + 5 * 60000,
  );
  assert.equal(
    getFollowupTime(
      [e],
      settings({ notificationsEnabled: false }),
      {},
      record,
      {},
      now,
    ),
    e.endsAt,
  );
});
