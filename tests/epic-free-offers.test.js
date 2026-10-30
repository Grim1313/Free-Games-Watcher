import test from "node:test";
import assert from "node:assert/strict";
import { parseEpicFeed } from "../src/lib/providers/epicProvider.js";
import { runPromotionCheck } from "../src/lib/promotions.js";
import { sanitizeSettings } from "../src/lib/settings.js";
import { environment, response } from "./helpers.mjs";
import { epicFeed } from "./multistore-fixtures.mjs";

function addFreeGames(data) {
  const items = data.data.Catalog.searchStore.elements;
  items.push(...items.map((item) => {
    const free = structuredClone(item);
    free.id += "-free";
    free.price.totalPrice.originalPrice = 0;
    free.price.totalPrice.discountPrice = 0;
    return free;
  }));
  return data;
}

test("Epic skips current and upcoming permanently free games without changing paid giveaways", () => {
  const now = Date.now(), data = epicFeed(now);
  const expected = parseEpicFeed(data, "US", now);
  const actual = parseEpicFeed(addFreeGames(data), "US", now);
  assert.deepEqual(actual.promotions, expected.promotions);
  assert.deepEqual(actual.upcoming, expected.upcoming);
  assert.deepEqual(actual.confirmedEnded, expected.confirmedEnded);
  assert.deepEqual(actual.warnings, []);
  assert.equal(actual.complete, true);

  data.data.Catalog.searchStore.elements = data.data.Catalog.searchStore.elements.slice(2);
  const onlyFree = parseEpicFeed(data, "US", now);
  assert.deepEqual(onlyFree.promotions, []);
  assert.deepEqual(onlyFree.upcoming, []);
  assert.deepEqual(onlyFree.warnings, []);
  assert.equal(onlyFree.complete, true);
});

test("Epic still reports missing or invalid original prices for current and upcoming offers", () => {
  const now = Date.now();
  for (const value of [undefined, null, "0", "1999", -1, NaN, Infinity, 0.5]) {
    const data = epicFeed(now);
    for (const item of data.data.Catalog.searchStore.elements)
      item.price.totalPrice.originalPrice = value;
    const result = parseEpicFeed(data, "US", now);
    assert.equal(result.complete, false, String(value));
    assert.equal(result.warnings.length, 2, String(value));
    assert.deepEqual(result.promotions, []);
    assert.deepEqual(result.upcoming, []);
  }
});

test("Epic free-game promotions do not produce a partial scan or extra notifications", async (t) => {
  const env = environment(t, { settings: sanitizeSettings({ enabledStores: ["epic"] }) });
  const feed = addFreeGames(epicFeed());
  globalThis.fetch = async (url) => {
    if (url.includes("freeGamesPromotions")) return response(feed);
    if (url.includes("/graphql"))
      return response({ data: { Catalog: { searchStore: { elements: [], paging: { total: 0 } } } } });
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await runPromotionCheck();
  assert.equal(result.ok, true);
  assert.equal(env.data.runtimeState.lastCheckOutcome, "success");
  assert.equal(env.data.diagnostics.storeResults.epic.complete, true);
  assert.deepEqual(env.data.diagnostics.warnings, []);
  assert.equal(env.data.latestPromotions.length, 1);
  assert.equal(env.data.upcomingPromotions.length, 1);
  assert.equal(env.notifications.length, 1);
});
