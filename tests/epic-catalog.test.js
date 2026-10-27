import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { environment, response } from "./helpers.mjs";
import { epicFeed } from "./multistore-fixtures.mjs";
import { epicCatalogUrl, parseEpicCatalog, fetchEpicCatalog, fetchEpicPromotions } from "../src/lib/providers/epicProvider.js";
import { runPromotionCheck } from "../src/lib/promotions.js";
import { sanitizeSettings } from "../src/lib/settings.js";

// Reduced real Browse response observed in Chrome on 27 October 2026; no account data.
const mafia = JSON.parse(await readFile(new URL("./fixtures/epic-mafia-hotel.json", import.meta.url), "utf8"));
const now = Date.parse("2026-10-27T12:00:00Z");
const page = (elements, total = elements.length) => ({ data: { Catalog: { searchStore: { elements, paging: { total } } } } });
function currentItem(id = mafia.id) {
  const item = structuredClone(mafia);
  item.id = id;
  item.price.lineOffers[0].appliedRules[0].endDate = new Date(Date.now() + 86400000).toISOString();
  return item;
}

test("real Mafia Hotel catalog record becomes a timed paid-to-free game without weekly promotions", () => {
  const parsed = parseEpicCatalog(page([mafia]), "US", now);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.promotions.length, 1);
  const p = parsed.promotions[0];
  assert.equal(p.title, "MAFIA HOTEL");
  assert.equal(p.stableId, "epic:c102cb63a52643d1a4c3ca009439eece:7813a97e72ed4a49be807e6de8bc4f2c");
  assert.equal(p.contentType, "game");
  assert.equal(p.sourceId, "epic-catalog");
  assert.equal(p.url, "https://store.epicgames.com/en-US/p/mafia-hotel-eaea4c");
  assert.equal(p.basePriceFormatted, "$1.99");
  assert.equal(p.endsAt, Date.parse("2026-11-01T17:02:00Z"));
  assert.equal(p.startsAt, 0);
  assert.match(p.headerImage, /mafia-hotel-1lkct/);
});

test("catalog rejects F2P, paid discounts, vouchers, code-only offers and preorders", () => {
  for (const mutate of [
    (i) => { i.price.totalPrice.originalPrice = 0; i.price.totalPrice.discount = 0; },
    (i) => { i.price.totalPrice.discountPrice = 99; },
    (i) => { i.price.totalPrice.discount = 99; },
    (i) => { i.price.totalPrice.voucherDiscount = 199; },
    (i) => { i.isCodeRedemptionOnly = true; },
    (i) => { i.prePurchase = true; },
  ]) {
    const item = structuredClone(mafia); mutate(item);
    assert.equal(parseEpicCatalog(page([item]), "US", now).promotions.length, 0);
  }
});

test("catalog requires a safe link and valid discount deadline, preserving valid neighboring records", () => {
  for (const mutate of [
    (i) => { i.price.lineOffers = []; },
    (i) => { i.price.lineOffers[0].appliedRules[0].endDate = "bad"; },
    (i) => { i.price.lineOffers[0].appliedRules[0].discountSetting.discountType = "AMOUNT"; },
    (i) => { i.price.totalPrice.discountPrice = "0"; },
    (i) => { i.offerMappings = []; i.catalogNs.mappings = []; },
    (i) => { i.offerMappings[0].pageSlug = "../unsafe"; },
  ]) {
    const item = structuredClone(mafia); item.id = "invalid"; mutate(item);
    const result = parseEpicCatalog(page([item, mafia]), "US", now);
    assert.equal(result.promotions.length, 1);
    assert.equal(result.complete, false);
  }
  assert.throws(() => parseEpicCatalog({ errors: [{}] }, "US"), /API errors/);
  assert.throws(() => parseEpicCatalog({ data: { Catalog: { searchStore: { elements: [] } } } }, "US"), /paging/);
});

test("expired catalog discount confirms its end and DLC uses its own product mapping", () => {
  const parsed = parseEpicCatalog(page([mafia]), "US", Date.parse("2026-11-01T17:02:00Z"));
  assert.equal(parsed.promotions.length, 0);
  assert.equal(parsed.confirmedEnded.size, 1);
  const dlc = structuredClone(mafia);
  dlc.categories = [{ path: "addons" }];
  dlc.offerMappings = [{ pageType: "offer", pageSlug: "test-dlc" }];
  const p = parseEpicCatalog(page([dlc]), "US", now).promotions[0];
  assert.equal(p.contentType, "dlc");
  assert.equal(p.url, "https://store.epicgames.com/en-US/p/test-dlc");
});

test("catalog query narrows regional zero-price discounts without cookies or authorization", async (t) => {
  environment(t);
  const url = new URL(epicCatalogUrl("RU", 40));
  assert.equal(url.origin, "https://store.epicgames.com");
  const variables = JSON.parse(url.searchParams.get("variables"));
  assert.equal(variables.country, "RU"); assert.equal(variables.allowCountries, "RU");
  assert.equal(variables.start, 40); assert.equal(variables.count, 40);
  assert.equal(variables.onSale, true); assert.equal(variables.priceRange, "[0,0]");
  globalThis.fetch = async (_, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    return response(page([]));
  };
  assert.equal((await fetchEpicCatalog("RU")).complete, true);
});

test("catalog pagination finds later offers and stops at the reported end", async (t) => {
  environment(t); const starts = [];
  globalThis.fetch = async (url) => {
    const start = JSON.parse(new URL(url).searchParams.get("variables")).start; starts.push(start);
    return response(start === 0 ? page(Array.from({ length: 40 }, (_, i) => currentItem(`first-${i}`)), 41)
      : page([currentItem()], 41));
  };
  const result = await fetchEpicCatalog("US");
  assert.deepEqual(starts, [0, 40]); assert.equal(result.promotions.length, 41);
  assert.equal(result.complete, true);
});

test("catalog failure on a later page retains found offers and marks incomplete coverage", async (t) => {
  environment(t); let calls = 0;
  globalThis.fetch = async () => { if (calls++) throw new Error("HTTP 503"); return response(page([currentItem()], 2)); };
  const result = await fetchEpicCatalog("US");
  assert.equal(result.hadSuccess, true); assert.equal(result.complete, false);
  assert.equal(result.promotions.length, 1); assert.match(result.warnings.join(), /HTTP 503/);
});

test("catalog pagination is bounded and detects repeated or prematurely empty pages", async (t) => {
  environment(t); let calls = 0;
  globalThis.fetch = async () => response(page([currentItem(`offer-${calls++}`)], 1000));
  const budget = await fetchEpicCatalog("US");
  assert.equal(calls, 5); assert.equal(budget.complete, false); assert.match(budget.warnings.join(), /budget/);
  calls = 0;
  globalThis.fetch = async () => { calls++; return response(page([currentItem()], 1000)); };
  const repeated = await fetchEpicCatalog("US");
  assert.equal(calls, 2); assert.equal(repeated.promotions.length, 1); assert.match(repeated.warnings.join(), /repeated/);
  globalThis.fetch = async () => response(page([], 2));
  assert.match((await fetchEpicCatalog("US")).warnings.join(), /empty/);
});

test("Epic combines and deduplicates both sources, preserving weekly dates and future offers", async (t) => {
  environment(t);
  const feed = epicFeed();
  const duplicate = currentItem("123"); duplicate.namespace = "test-namespace";
  globalThis.fetch = async (url) => response(url.includes("graphql") ? page([duplicate, currentItem()]) : feed);
  const result = await fetchEpicPromotions({ region: "US" });
  assert.equal(result.complete, true); assert.equal(result.promotions.length, 2); assert.equal(result.upcoming.length, 1);
  assert.equal(result.promotions.find((p) => p.stableId === "epic:test-namespace:123").sourceId, "epic-promotions");
  assert.equal(result.sources.length, 2);
  duplicate.price.lineOffers[0].appliedRules[0].endDate = "2020-01-01T00:00:00Z";
  assert.equal((await fetchEpicPromotions({})).confirmedEnded.has("epic:test-namespace:123"), false);
});

test("either Epic source can fail without losing the other; both failing is not empty success", async (t) => {
  environment(t);
  for (const failed of ["catalog", "feed", "both"]) {
    globalThis.fetch = async (url) => {
      const catalog = url.includes("graphql");
      if (failed === "both" || catalog === (failed === "catalog")) throw new Error("HTTP 403");
      return response(catalog ? page([currentItem()]) : epicFeed());
    };
    const result = await fetchEpicPromotions({});
    assert.equal(result.hadSuccess, failed !== "both"); assert.equal(result.complete, false);
    assert.equal(result.promotions.length, failed === "both" ? 0 : 1);
    assert.equal(result.sources.filter((s) => s.ok).length, failed === "both" ? 0 : 1);
  }
});

test("Mafia Hotel survives repeat scans without duplicate notification and catalog outage keeps it stale", async (t) => {
  const env = environment(t, { settings: sanitizeSettings({ enabledStores: ["epic"] }) });
  let failCatalog = false;
  globalThis.fetch = async (url) => {
    if (!url.includes("graphql")) return response(epicFeed());
    if (failCatalog) throw new Error("HTTP 403");
    return response(page([currentItem()]));
  };
  await runPromotionCheck(); await runPromotionCheck();
  assert.equal(env.notifications.length, 2);
  assert.equal(env.data.latestPromotions.filter((p) => p.title === "MAFIA HOTEL").length, 1);
  failCatalog = true; await runPromotionCheck();
  const offer = env.data.latestPromotions.find((p) => p.title === "MAFIA HOTEL");
  assert.equal(offer.status, "active"); assert.equal(offer.stale, true);
  assert.equal(env.data.runtimeState.lastCheckOutcome, "partial");
  assert.equal(env.notifications.length, 2);
});
