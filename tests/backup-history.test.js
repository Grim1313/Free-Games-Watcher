import test from "node:test";
import assert from "node:assert/strict";
import { environment, entry, steamFetch } from "./helpers.mjs";
import { exportBackup, importBackup, validateBackup, mergeBackupHistory } from "../src/lib/backup.js";
import { sanitizeSettings } from "../src/lib/settings.js";
import { sanitizePromotionEntry } from "../src/lib/history.js";
import { assignCampaigns, runPromotionCheck } from "../src/lib/promotions.js";
import { shouldNotifyPromotion } from "../src/lib/dedupe.js";
import { MAX_BACKUP_BYTES, MAX_HISTORY_ITEMS } from "../src/lib/constants.js";

const backup = (history = [entry()], extra = {}) => ({
  format: "steam-promo-watch", version: 3, exportedAt: new Date().toISOString(),
  settings: sanitizeSettings({ enabledStores: ["steam"], region: "US" }), userActions: {}, history, ...extra,
});

test("full and settings-only exports use one v3 format and exclude operational state", async (t) => {
  environment(t, {
    settings: sanitizeSettings(), history: [entry({ title: "Archived title" })],
    latestPromotions: [entry({ title: "Current title" })],
    metadataCache: { private: true }, notifiedPromotions: { private: true },
    userActions: { "app:123": { claimed: true } },
  });
  const full = await exportBackup();
  assert.equal(full.version, 3);
  assert.equal(full.history.length, 1);
  assert.equal(full.history[0].title, "Current title");
  assert.equal(full.history[0].importedAt, undefined);
  assert.equal(full.metadataCache, undefined);
  assert.equal(full.notifiedPromotions, undefined);
  const settingsOnly = await exportBackup({ includeHistory: false });
  assert.equal(settingsOnly.history, undefined);
  assert.equal(validateBackup(settingsOnly).hasHistory, false);
  assert.equal(validateBackup(full).hasHistory, true);
});

test("legacy v1/v2 and unchecked history replace only settings and marks", async (t) => {
  const { data } = environment(t, { history: [entry()], latestPromotions: [entry()], notifiedPromotions: { local: {} } });
  const preserved = structuredClone(data);
  for (const version of [1, 2, 3]) {
    const input = backup([entry({ stableId: "gog:321" })], { version, settings: { region: "DE" }, userActions: { "app:123": { ignored: true } } });
    if (version < 3) delete input.history;
    await importBackup(input, { includeHistory: false });
    assert.equal(data.settings.region, "DE");
    assert.deepEqual(data.history, preserved.history);
    assert.deepEqual(data.latestPromotions, preserved.latestPromotions);
    assert.deepEqual(data.notifiedPromotions, preserved.notifiedPromotions);
  }
});

test("import merges all stores, canonicalizes duplicate IDs, and preserves local records", async (t) => {
  const local = entry({ title: "Local wins", unread: true });
  const { data } = environment(t, { history: [local], latestPromotions: [local] });
  const input = backup([
    entry({ id: "different-provider-id", title: "Stale imported title" }),
    entry({ stableId: "gog:321", campaignId: "gog:321|free-to-keep", gogRating: 4.5, gogRatingCount: 80 }),
    entry({ stableId: "epic:ns:offer", campaignId: "epic:ns:offer|free-to-keep" }),
  ]);
  await importBackup(input);
  assert.equal(data.history.length, 3);
  const steam = data.history.find(e => e.stableId === "app:123");
  assert.equal(steam.title, "Local wins");
  assert.equal(steam.unread, true);
  assert.equal(steam.importedAt, 0);
  const gog = data.history.find(e => e.stableId === "gog:321");
  assert.equal(gog.gogRating, 4.5);
  assert.equal(gog.unread, false);
  assert.equal(gog.stale, true);
  assert.ok(gog.importedAt > 0);
  assert.deepEqual(data.latestPromotions, [local]);
  await importBackup(input);
  assert.equal(data.history.length, 3);
});

test("invalid archives fail atomically even when history is unchecked", async (t) => {
  const { data } = environment(t, { settings: { region: "US" }, history: [entry()] });
  const before = structuredClone(data);
  for (const input of [
    backup({}), backup([null]), backup([entry({ stableId: "javascript:bad" })]),
    backup([entry({ endsAt: "tomorrow" })]), backup([entry({ endsAt: 1e20 })]),
    backup([entry({ status: "bogus" })]), backup([entry({ promoType: "unknown" })]),
    backup(Array.from({ length: MAX_HISTORY_ITEMS + 1 }, () => entry())),
    "x".repeat(MAX_BACKUP_BYTES + 1),
    backup([], { userActions: { "bad:id": {} } }),
  ]) {
    await assert.rejects(importBackup(input, { includeHistory: false }), /invalidBackup/);
    assert.deepEqual(data, before);
  }
  const circular = {}; circular.self = circular;
  assert.throws(() => validateBackup(circular), /invalidBackup/);
  assert.throws(() => validateBackup(backup([], { version: 99 })), /unsupportedBackup/);
});

test("archive limits keep recent records and untrusted URLs are sanitized", () => {
  const merged = mergeBackupHistory(Array.from({ length: 450 }, (_, i) => entry({ stableId: `app:${i + 1}`, firstSeenAt: i, lastSeenAt: i })));
  assert.equal(merged.length, 400);
  assert.equal(merged[0].stableId, "app:450");
  const clean = validateBackup(backup([entry({ url: "javascript:alert(1)", headerImage: "https://evil.example/tracker.png", store: "gog" })])).history[0];
  assert.equal(clean.store, "steam");
  assert.match(clean.url, /^https:\/\/store\.steampowered\.com\//);
  assert.equal(clean.headerImage, "");
});

test("import does not notify or populate live offers; scan and reminders stay silent for restored campaigns", async (t) => {
  const { data, notifications } = environment(t);
  const now = Date.now();
  const imported = entry({ endsAt: now + 2 * 3600000, lastNotifiedAt: now - 86400000 });
  await importBackup(backup([imported], { userActions: { "app:123": { snoozePending: true, snoozedUntil: now - 1000 } } }));
  assert.equal(notifications.length, 0);
  assert.equal(data.latestPromotions, undefined);
  assert.equal(data.userActions["app:123"].snoozePending, false);
  globalThis.fetch = steamFetch();
  await runPromotionCheck("manual");
  assert.equal(notifications.length, 0);
  assert.equal(data.latestPromotions.length, 1);
  assert.ok(data.latestPromotions[0].importedAt);
  assert.equal(data.latestPromotions[0].unread, false);
  assert.equal(data.latestPromotions[0].firstSeenAt, imported.firstSeenAt);
  assert.equal(data.latestPromotions[0].lastNotifiedAt, imported.lastNotifiedAt);
  // Existing delivery records must not cause a restored campaign reminder.
  data.notifiedPromotions = { [imported.id]: { fingerprint: imported.fingerprint, lastNotifiedAt: now - 120000 } };
  await runPromotionCheck("manual");
  assert.equal(notifications.length, 0);
  assert.equal(shouldNotifyPromotion(data.latestPromotions[0], {}, data.settings, now + 90 * 86400000).shouldNotify, false);
  const next = assignCampaigns([entry({ endsAt: now + 86400000 })], [sanitizePromotionEntry({ ...data.history[0], status: "expired", confirmedEnded: true })], now)[0];
  assert.equal(next.importedAt, 0);
  assert.equal(shouldNotifyPromotion(next, data.notifiedPromotions, data.settings, now).shouldNotify, true);
});
