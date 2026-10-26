import test from "node:test";
import assert from "node:assert/strict";
import { environment, entry, steamFetch, response } from "./helpers.mjs";
import { epicFeed, gogPage, gogGiveaway } from "./multistore-fixtures.mjs";
import { parseEpicFeed } from "../src/lib/providers/epicProvider.js";
import { parseGogGiveaway, fetchGogPromotions } from "../src/lib/providers/gogProvider.js";
import { runPromotionCheck, visibleEntries } from "../src/lib/promotions.js";
import { sanitizeSettings, getSettings } from "../src/lib/settings.js";
import { storeOf, validStableId, storeUrl, storeAsset } from "../src/lib/stores.js";
import { sanitizePromotionEntry, mergePromotionEntries } from "../src/lib/history.js";
import { changeAction } from "../src/lib/actions.js";
import { ensureSchemaVersion } from "../src/lib/storage.js";
import { exportBackup, validateBackup } from "../src/lib/backup.js";
import { getFollowupTime } from "../src/lib/scheduler.js";
import { openNotificationTarget } from "../src/lib/notifications.js";

const all = () => sanitizeSettings({ enabledStores: ["steam", "epic", "gog"] });
function sources(now = Date.now(), fail = "", calls = []) {
  const steam = steamFetch();
  return async (url, options) => {
    calls.push(url);
    if (url.includes("epicgames.com")) {
      assert.equal(options.credentials, "omit");
      if (fail === "epic") throw new Error("Epic offline");
      return response(epicFeed(now));
    }
    if (url.includes("sections.gog.com")) return response(url.includes("/sections/") ? gogGiveaway(now) : gogPage());
    if (url.includes("catalog.gog.com")) return response({ productCount: 0, products: [] });
    return steam(url, options);
  };
}

test("store identities and safe URLs cannot cross stores or accept hostile hosts", () => {
  assert.equal(storeOf("app:123"), "steam");
  assert.equal(storeOf("epic:ns:123"), "epic");
  assert.equal(validStableId("gog:123"), true);
  assert.equal(validStableId("epic:ns:../123"), false);
  assert.equal(storeUrl({ stableId: "gog:123", url: "https://www.gog.com.attacker.test/game/x" }), "https://www.gog.com/");
  assert.equal(storeUrl({ stableId: "app:123", url: "javascript:alert(1)" }), "https://store.steampowered.com/app/123/");
  assert.equal(storeAsset("https://cdn1.epicgames.com/a.png", "gog:123"), "");
  assert.equal(storeAsset("https://cdn1.epicgames.com/a.png", "epic:ns:123"), "https://cdn1.epicgames.com/a.png");
});
test("fresh install enables three stores; legacy settings retain Steam only", async (t) => {
  environment(t);
  assert.deepEqual((await getSettings()).enabledStores, ["steam", "epic", "gog"]);
  assert.deepEqual((await exportBackup()).settings.enabledStores, ["steam", "epic", "gog"]);
  assert.deepEqual(sanitizeSettings({ region: "RU" }).enabledStores, ["steam"]);
  assert.deepEqual(sanitizeSettings({ enabledStores: ["gog", "unknown", "gog"] }).enabledStores, ["gog"]);
});
test("Epic separates future offers and rejects zero price without a dated paid-to-free offer", () => {
  const now = Date.now(), data = epicFeed(now);
  let result = parseEpicFeed(data, "US", now);
  assert.equal(result.promotions.length, 1);
  assert.equal(result.upcoming.length, 1);
  const p = data.data.Catalog.searchStore.elements[0];
  p.promotions = null;
  assert.equal(parseEpicFeed(data, "US", now).promotions.length, 0);
  p.promotions = { promotionalOffers: [{ promotionalOffers: [{ startDate: "bad", endDate: "bad" }] }] };
  assert.throws(() => parseEpicFeed(data, "US", now), /dates/);
});
test("GOG official section extracts identity, end and claim URL without normalizing stars to Steam reviews", () => {
  const now = Date.now(), parsed = parseGogGiveaway(gogGiveaway(now), "US", now);
  assert.equal(parsed.state, "active");
  assert.equal(parsed.promotion.stableId, "gog:123");
  assert.equal(parsed.promotion.endsAt, now + 86400000);
  assert.equal(parsed.promotion.reviewTotal, 0);
  assert.equal(parsed.promotion.claimUrl, "https://www.gog.com/en/");
  assert.equal(parseGogGiveaway(gogGiveaway(now), "US", now + 86400000).state, "expired");
  const bad = gogGiveaway(now); delete bad.properties.endDate;
  assert.throws(() => parseGogGiveaway(bad, "US", now));
});
test("GOG discounted free catalog item is not enough; broken section is partial, not empty success", async (t) => {
  environment(t);
  globalThis.fetch = async (url) => response(url.includes("catalog.gog.com")
    ? { productCount: 1, products: [{ id: "999", price: { finalMoney: { amount: "0.00" } } }] }
    : url.includes("/sections/") ? { properties: {} } : gogPage());
  const result = await fetchGogPromotions(all());
  assert.equal(result.promotions.length, 0);
  assert.equal(result.complete, false);
  assert.equal(result.warnings.length, 2);
});
test("multi-store scan keeps same-title games independent, future offers silent, and repeat scan deduplicated", async (t) => {
  const env = environment(t, { settings: all() }); globalThis.fetch = sources();
  const first = await runPromotionCheck();
  assert.equal(first.ok, true);
  assert.equal(first.promotionsFound, 3);
  assert.equal(env.data.latestPromotions.length, 3);
  assert.equal(env.data.upcomingPromotions.length, 1);
  assert.equal(env.notifications.length, 3);
  assert.equal(new Set(env.data.latestPromotions.map((p) => p.stableId)).size, 3);
  await changeAction("app:123", "claim");
  assert.equal(visibleEntries(env.data.latestPromotions, all(), env.data.userActions).length, 2);
  await runPromotionCheck();
  assert.equal(env.notifications.length, 3);
  const epicNotification = env.notifications.find((n) => n.options.message.startsWith("Epic Games Store"));
  let opened;
  chrome.tabs.create = async (value) => { opened = value.url; };
  await openNotificationTarget(epicNotification.id);
  assert.equal(opened, "https://store.epicgames.com/en-US/p/test-game");
});
test("one store outage retains its offer as stale, keeps last success and does not expire another store", async (t) => {
  const env = environment(t, { settings: all() }); globalThis.fetch = sources();
  await runPromotionCheck();
  const lastSuccess = env.data.diagnostics.storeResults.epic.lastSuccessAt;
  globalThis.fetch = sources(Date.now(), "epic");
  const result = await runPromotionCheck();
  assert.equal(result.ok, true);
  assert.equal(env.data.runtimeState.lastCheckOutcome, "partial");
  const epic = env.data.latestPromotions.find((p) => storeOf(p) === "epic");
  assert.equal(epic.status, "active"); assert.equal(epic.stale, true);
  assert.equal(env.data.diagnostics.storeResults.epic.lastSuccessAt, lastSuccess);
  assert.equal(env.data.diagnostics.storeResults.gog.ok, true);
  assert.equal(env.notifications.length, 3);
});
test("disabled stores are not fetched or notified; selected stores changing mid-scan discard result", async (t) => {
  const env = environment(t, { settings: all() }), calls = [];
  globalThis.fetch = sources(Date.now(), "", calls);
  env.data.settings.enabledStores = ["epic"];
  await runPromotionCheck();
  assert.equal(calls.length, 1);
  assert.equal(env.notifications.length, 1);
  globalThis.fetch = async () => { env.data.settings.enabledStores = ["gog"]; return response(epicFeed()); };
  assert.equal((await runPromotionCheck()).discarded, true);
  assert.equal(env.notifications.length, 1);
});
test("no selected stores pauses without requests", async (t) => {
  environment(t, { settings: sanitizeSettings({ enabledStores: [] }) });
  globalThis.fetch = async () => { throw new Error("must not fetch"); };
  assert.equal((await runPromotionCheck()).runtimeState.lastCheckOutcome, "paused");
});
test("schema 2 migration preserves campaign fingerprints, actions and delivery records exactly", async (t) => {
  const initial = { schemaVersion: 2, settings: { region: "RU" }, latestPromotions: [entry({ campaignId: "legacy-cycle", fingerprint: "legacy-cycle" })],
    userActions: { "app:123": { claimed: true } }, notifiedPromotions: { legacy: { fingerprint: "legacy-cycle" } } };
  const { data } = environment(t, initial); await ensureSchemaVersion();
  assert.equal(data.schemaVersion, 3);
  for (const key of ["settings", "latestPromotions", "userActions", "notifiedPromotions"]) assert.deepEqual(data[key], initial[key]);
  delete data.settings;
  data.schemaVersion = 2;
  await ensureSchemaVersion();
  assert.deepEqual((await getSettings()).enabledStores, ["steam"]);
});
test("backup v2 retains cross-store marks and URLs; backup v1 remains importable", async (t) => {
  environment(t, { settings: all() });
  await changeAction("epic:ns:123", "claim", { title: "Game", url: "https://store.epicgames.com/en-US/p/game" });
  const exported = await exportBackup(); assert.equal(exported.version, 2);
  assert.equal(validateBackup(exported).userActions["epic:ns:123"].claimed, true);
  assert.equal(validateBackup(exported).userActions["epic:ns:123"].url, "https://store.epicgames.com/en-US/p/game");
  assert.deepEqual(validateBackup({ format: "steam-promo-watch", version: 1, settings: {}, userActions: { "app:123": { ignored: true } } }).settings.enabledStores, ["steam"]);
});
test("Steam review thresholds do not hide Epic/GOG; unknown genre/platform filters still apply", () => {
  const settings = all(); settings.filters.includeUnrated = false; settings.filters.minRating = 95;
  const now = Date.now(), e = sanitizePromotionEntry({ ...parseEpicFeed(epicFeed(now), "US", now).promotions[0], id: "epic-test", status: "active" });
  assert.equal(visibleEntries([e], settings, {}).length, 1);
  settings.filters.platforms = ["linux"];
  assert.equal(visibleEntries([e], settings, {}).length, 0);
});
test("store-specific merge does not mark disabled store checked, and future start schedules a scan", () => {
  const now = Date.now(), old = entry({ lastCheckedAt: now - 1000 });
  const result = mergePromotionEntries([old], [], now, { storeResults: { epic: { ok: true, complete: true } } });
  assert.equal(result.entries[0].lastCheckedAt, now - 1000);
  const future = { stableId: "epic:ns:123", region: "US", status: "upcoming", startsAt: now + 3600000 };
  assert.equal(getFollowupTime([future], all(), {}, {}, {}, now), future.startsAt);
  assert.equal(getFollowupTime([future], sanitizeSettings({}), {}, {}, {}, now), 0);
});
