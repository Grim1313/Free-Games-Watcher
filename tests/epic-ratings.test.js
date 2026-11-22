import test from "node:test";
import assert from "node:assert/strict";
import { enrichEpicRatings } from "../src/lib/providers/epicRatings.js";
import { runPromotionCheck } from "../src/lib/promotions.js";
import { createPromotionNotifications } from "../src/lib/notifications.js";
import { sanitizeSettings } from "../src/lib/settings.js";
import { sanitizePromotionEntry } from "../src/lib/history.js";
import { epicFeed } from "./multistore-fixtures.mjs";
import { environment, response } from "./helpers.mjs";

const game = (id = "123") => ({
  stableId: `epic:test-namespace:${id}`, contentType: "game",
  url: `https://store.epicgames.com/en-US/p/${id}`,
});

test("Epic scores reach current and upcoming games, history and alerts, and survive a second scan", async t => {
  const env = environment(t, { settings: sanitizeSettings({ enabledStores: ["epic"], language: "ru" }) });
  const lookups = [];
  globalThis.fetch = async (url, options) => {
    if (url.includes("freeGamesPromotions")) return response(epicFeed());
    if (url.includes("/graphql")) return response({ data: { Catalog: { searchStore: { elements: [], paging: { total: 0 } } } } });
    assert.equal(options.credentials, "omit");
    lookups.push(url);
    if (url.endsWith("/test-game")) return response("<h2>Epic Player Ratings</h2><p>Captured from players in the Epic Games ecosystem.</p><h2>3.7</h2><h2>Ratings &amp; Reviews</h2>92%");
    if (url.endsWith("/future-game")) throw Error("HTTP 403");
    // Reduced EGData /polls response for Bread & Fred. The offer identity is synthetic.
    assert.ok(url.endsWith("/offers/456/polls"));
    return response({ _id: "test-namespace", averageRating: 3.64, pollResult: [] });
  };
  await runPromotionCheck();
  const active = env.data.latestPromotions[0];
  assert.equal(env.data.runtimeState.lastCheckOutcome, "success");
  assert.equal(active.epicRating, 3.7);
  assert.equal(active.reviewTotal, 0);
  assert.equal(env.data.history[0].epicRating, 3.7);
  assert.equal(env.data.upcomingPromotions[0].epicRating, 3.64);
  assert.equal(env.notifications[0].options.contextMessage, "Оценка игроков Epic: 3,7 из 5");
  await runPromotionCheck();
  assert.equal(lookups.length, 3);
  assert.equal(env.notifications.length, 1);
  await createPromotionNotifications([active], { reminder: true, settings: { language: "en" } });
  assert.equal(env.notifications.at(-1).options.contextMessage, "Epic player rating: 3.7 out of 5");
});

test("Epic ignores critic scores, poll answer totals, invalid stars and unrelated sandboxes", async t => {
  environment(t);
  const offer = game();
  for (const [namespace, averageRating] of [["other", 4.8], ["test-namespace", null], ["test-namespace", 6], ["test-namespace", "4.5"]]) {
    globalThis.fetch = async url => url.endsWith("/polls")
      ? response({ _id: namespace, averageRating, pollResult: [{ total: 900 }] })
      : response("<h2>Epic Player Ratings</h2><h2>Ratings &amp; Reviews</h2><strong>4.5 / 5</strong>");
    await enrichEpicRatings([offer], []);
    assert.equal(offer.epicRating, 0);
  }
  for (const stableId of ["gog:123", "app:123"])
    assert.equal(sanitizePromotionEntry({ ...offer, epicRating: 4.9, stableId }).epicRating, undefined);
});

test("Epic refreshes only eligible games, reuses prior scores on outages and bounds requests", async t => {
  environment(t);
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error("offline"); };
  const games = Array.from({ length: 8 }, (_, i) => game(String(i)));
  const dlc = { ...game("dlc"), contentType: "dlc" };
  const previous = [{ ...games[0], epicRating: 4.52, epicRatingCheckedAt: 1 }];
  await enrichEpicRatings([...games, dlc], previous);
  assert.equal(requests, 12);
  assert.equal(dlc.epicRating, undefined);
  assert.equal(games[0].epicRating, 4.52);
  const next = games.map(p => game(p.stableId.split(":")[2]));
  await enrichEpicRatings(next, games);
  assert.equal(requests, 16);
  assert.equal(next[0].epicRating, 4.52);
});
