import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { environment, response } from "./helpers.mjs";
import { epicFeed } from "./multistore-fixtures.mjs";
import { parseEgdataCatalog, fetchEgdataCatalog, fetchEpicPromotions } from "../src/lib/providers/epicProvider.js";
import { runPromotionCheck } from "../src/lib/promotions.js";
import { sanitizeSettings } from "../src/lib/settings.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/egdata-mafia-hotel.json", import.meta.url), "utf8"));
const now = Date.parse("2026-10-27T12:00:00Z");
const page = (offers, total = offers.length, page = 1) => ({ offers, total, page, limit: 40, meta: { timed_out: false } });
function currentItem(id = fixture.id) {
  const item = structuredClone(fixture);
  item.id = item.price.offerId = item.price.appliedRules[0].promotionSetting.discountOffers[0].offerId = id;
  item.price.appliedRules[0].startDate = new Date(Date.now() - 3600000).toISOString();
  item.price.appliedRules[0].endDate = new Date(Date.now() + 86400000).toISOString();
  return item;
}

test("real EGData Mafia Hotel preserves Epic identity, regional price and explicit sale dates", () => {
  const result = parseEgdataCatalog(page([fixture]), "US", now);
  assert.equal(result.complete, true); assert.equal(result.promotions.length, 1);
  const p = result.promotions[0];
  assert.equal(p.stableId, `epic:${fixture.namespace}:${fixture.id}`);
  assert.equal(p.sourceId, "epic-egdata"); assert.equal(p.contentType, "game");
  assert.equal(p.startsAt, Date.parse("2026-10-24T18:01:00Z"));
  assert.equal(p.endsAt, Date.parse("2026-11-01T17:02:00Z"));
  assert.equal(p.basePriceFormatted, "$1.99");
  assert.equal(p.url, "https://store.epicgames.com/en-US/p/mafia-hotel-eaea4c");
});

test("EGData rejects mobile/test, country-restricted, conditional, expired and future offers", () => {
  for (const mutate of [
    (i) => { i.tags = [{ id: "39070" }]; },
    (i) => { i.categories = ["application"]; },
    (i) => { i.effectiveDate = "2026-10-28T12:00:00Z"; },
    (i) => { i.viewableDate = "2026-10-28T12:00:00Z"; },
    (i) => { i.countriesBlacklist = ["US"]; },
    (i) => { i.countriesWhitelist = ["RU"]; },
    (i) => { i.price.appliedRules[0].promotionStatus = "INACTIVE"; },
    (i) => { i.price.appliedRules[0].promotionSetting.promotionType = "CONDITIONAL"; },
    (i) => { i.price.appliedRules[0].promotionSetting.discountOffers = [{ offerId: "other" }]; },
    (i) => { i.price.appliedRules[0].regionIds = ["RU"]; },
    (i) => { i.price.appliedRules[0].endDate = "2026-10-26T12:00:00Z"; },
    (i) => { i.price.appliedRules[0].endDate = null; },
    (i) => { i.price.appliedRules[0].startDate = "2026-10-28T12:00:00Z"; },
    (i) => { i.price.price.originalPrice = 0; },
  ]) {
    const item = structuredClone(fixture); mutate(item);
    assert.equal(parseEgdataCatalog(page([item]), "US", now).promotions.length, 0);
  }
});

test("EGData validates price identity, currency, response shape and timeouts", () => {
  for (const mutate of [
    (i) => { i.price.offerId = "different"; },
    (i) => { i.price.namespace = "different"; },
    (i) => { i.price.price.currencyCode = "invalid"; },
  ]) {
    const item = structuredClone(fixture); mutate(item);
    const result = parseEgdataCatalog(page([item]), "US", now);
    assert.equal(result.promotions.length, 0); assert.equal(result.complete, false);
  }
  assert.throws(() => parseEgdataCatalog({ ...page([fixture]), meta: { timed_out: true } }, "US", now));
  assert.throws(() => parseEgdataCatalog({ offers: [] }, "US", now));
});

test("EGData currency minor units and country restrictions apply independently", () => {
  const item = structuredClone(fixture);
  item.price.price.currencyCode = "JPY"; item.price.price.originalPrice = item.price.price.discount = 100;
  item.price.region = "JP";
  assert.equal(parseEgdataCatalog(page([item]), "JP", now).promotions[0].basePriceFormatted, "¥100");
  item.countriesBlacklist = ["JP"];
  assert.equal(parseEgdataCatalog(page([item]), "JP", now).promotions.length, 0);
});

test("EGData fetch is anonymous, paginated and stops after positive prices", async (t) => {
  environment(t); const calls = [];
  const paid = currentItem("paid"); paid.price.price.discountPrice = 99;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).searchParams.get("country"), "US");
    assert.equal(options.credentials, "omit");
    const body = JSON.parse(options.body); calls.push(body);
    return response(body.page === 1 ? page(Array.from({ length: 40 }, (_, i) => currentItem(`item-${i}`)), 100)
      : page([currentItem(), paid], 100, 2));
  };
  const result = await fetchEgdataCatalog("US");
  assert.equal(result.complete, true); assert.equal(result.promotions.length, 41);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { onSale: true, sortBy: "price", sortDir: "asc", page: 1, limit: 40 });
});

test("EGData partial pages and query budgets retain offers without declaring full success", async (t) => {
  environment(t); let calls = 0;
  globalThis.fetch = async () => { if (calls++) throw new Error("HTTP 429"); return response(page([currentItem()], 2)); };
  const partial = await fetchEgdataCatalog("US");
  assert.equal(partial.hadSuccess, true); assert.equal(partial.complete, false); assert.equal(partial.promotions.length, 1);
  globalThis.fetch = async (_, options) => {
    const p = JSON.parse(options.body).page;
    return response(page([currentItem(`item-${p}`)], 1000, p));
  };
  const budget = await fetchEgdataCatalog("US");
  assert.equal(budget.promotions.length, 5); assert.equal(budget.complete, false);
  assert.match(budget.warnings.join(), /budget/);
});

test("fallback is used only after a catalog failure and recovery does not duplicate notifications", async (t) => {
  const env = environment(t, { settings: sanitizeSettings({ enabledStores: ["epic"] }) });
  let directWorks = false, fallbackCalls = 0;
  const item = currentItem();
  globalThis.fetch = async (url, options) => {
    if (url.includes("freeGamesPromotions")) return response(epicFeed());
    if (url.includes("api.egdata.app")) { fallbackCalls++; return response(page([item])); }
    if (!directWorks) throw new Error("HTTP 403");
    const direct = { ...item, categories: item.categories.map((path) => ({ path })),
      price: { totalPrice: { ...item.price.price, fmtPrice: { originalPrice: "$1.99" } }, lineOffers: [{ appliedRules: item.price.appliedRules }] } };
    return response({ data: { Catalog: { searchStore: { elements: [direct], paging: { total: 1 } } } } });
  };
  await runPromotionCheck();
  assert.equal(env.data.latestPromotions.find((p) => p.title === "MAFIA HOTEL").sourceId, "epic-egdata");
  assert.equal(env.data.diagnostics.storeResults.epic.complete, true);
  assert.equal(env.notifications.length, 2);
  directWorks = true; await runPromotionCheck();
  assert.equal(fallbackCalls, 1);
  assert.equal(env.notifications.length, 2);
  assert.equal(env.data.latestPromotions.find((p) => p.title === "MAFIA HOTEL").sourceId, "epic-catalog");
  assert.equal((await fetchEpicPromotions({})).sources.length, 2);
});
