import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, extractEpic, extractGogCatalog, extractGogSections, probeSource } from "../scripts/source-audit/core.mjs";

const now = Date.parse("2026-10-26T12:00:00Z");
const window = (percentage = 0, start = "2026-10-22T15:00:00Z", end = "2026-10-29T15:00:00Z") => ({
  startDate: start, endDate: end, discountSetting: { discountType: "PERCENTAGE", discountPercentage: percentage },
});
const item = (overrides = {}) => ({ id: "offer1", namespace: "ns1", title: "Test game", offerType: "BASE_GAME",
  price: { totalPrice: { originalPrice: 1999, discountPrice: 0, currencyCode: "USD", currencyInfo: { decimals: 2 } } },
  catalogNs: { mappings: [{ pageType: "productHome", pageSlug: "test-game" }] },
  promotions: { promotionalOffers: [{ promotionalOffers: [window()] }], upcomingPromotionalOffers: [] }, ...overrides });
const feed = (...elements) => ({ data: { Catalog: { searchStore: { elements } } } });

test("Epic: accept paid-to-free dated offer and preserve store identity", () => {
  const result = extractEpic(feed(item()), "US", now);
  assert.equal(result.current.length, 1);
  assert.equal(result.current[0].productId, "ns1:offer1");
  assert.equal(result.current[0].url, "https://store.epicgames.com/en-US/p/test-game");
});
test("Epic: freegames tag, permanent free, ordinary discount and price conflict are not giveaways", () => {
  const base = item();
  const result = extractEpic(feed(
    item({ promotions: null, categories: [{ path: "freegames" }] }),
    item({ price: { totalPrice: { originalPrice: 0, discountPrice: 0 } } }),
    item({ promotions: { promotionalOffers: [{ promotionalOffers: [window(20)] }] } }),
    item({ price: { totalPrice: { ...base.price.totalPrice, discountPrice: 399 } } }),
  ), "US", now);
  assert.equal(result.current.length, 0);
  assert.equal(result.rejected.length, 4);
  assert.equal(result.warnings.length, 1);
});
test("Epic: upcoming free offer is separate even while its current price is paid", () => {
  const result = extractEpic(feed(item({
    price: { totalPrice: { originalPrice: 2499, discountPrice: 1749 } },
    promotions: { promotionalOffers: [{ promotionalOffers: [window(70)] }],
      upcomingPromotionalOffers: [{ promotionalOffers: [window(0, "2026-10-29T15:00:00Z", "2026-11-05T16:00:00Z")] }] },
  })), "US", now);
  assert.equal(result.current.length, 0);
  assert.equal(result.upcoming.length, 1);
});
test("Epic: expiration is exclusive; malformed schema/date is an error, not no offers", () => {
  assert.equal(extractEpic(feed(item()), "US", Date.parse("2026-10-29T15:00:00Z")).current.length, 0);
  assert.throws(() => extractEpic({}, "US", now), /Invalid Epic/);
  assert.throws(() => extractEpic(feed(item({ promotions: { promotionalOffers: [{ promotionalOffers: [window(0, "invalid")] }] } })), "US", now), /invalid promotion dates/);
});
test("GOG: preserve unknown price, distinguish zero-base demo from discounted candidate, do not invent dates", () => {
  const make = (id, amount, base) => ({ id, title: "Example", productType: "game", tags: [{ slug: "demo" }],
    price: { finalMoney: { amount, currency: "USD" }, baseMoney: { amount: base } } });
  const r = extractGogCatalog({ productCount: 9, pages: 1, products: [make("1", "0.00", "0.00"), make("2", "0.00", "9.99"), make("3", null, "9.99")] }, "US");
  assert.equal(r.items[0].classification, "zero-base-price-not-confirmed-giveaway");
  assert.equal(r.items[0].demoTag, true);
  assert.equal(r.items[1].classification, "zero-price-discount-needs-terms");
  assert.equal(r.items[1].endsAt, null);
  assert.equal(r.items[2].classification, "unknown-price");
  assert.equal(r.coverageLimited, true);
});
test("GOG: valid empty response differs from broken schema; section discovery preserves flags", () => {
  assert.equal(extractGogCatalog({ products: [], productCount: 0 }, "US").total, 0);
  assert.throws(() => extractGogCatalog({}, "US"), /Invalid GOG/);
  assert.throws(() => extractGogSections({ sections: [] }), /Invalid GOG/);
  const r = extractGogSections({ config: { pageId: "page" }, sections: [{ sectionType: "GIVEAWAY_SECTION", sectionId: "abc", hideOnLoad: true }] });
  assert.equal(r.giveawaySections[0].hideOnLoad, true);
});
test("Audit: bound region inputs and use only read endpoints", () => {
  assert.throws(() => buildPlan(["../RU"]));
  const plan = buildPlan(["US", "US"]);
  assert.equal(plan.filter((p) => p.kind === "epic").length, 1);
  assert.ok(plan.every((p) => !/claim|login|token/i.test(p.url)));
});
test("Audit: anonymous requests retain network error causes and distinguish HTTP 401", async (t) => {
  let options;
  t.mock.method(globalThis, "fetch", async (_url, init) => { options = init; return new Response('{"message":"Unauthorized"}', { status: 401 }); });
  const result = await probeSource({ id: "status", url: "https://www.gog.com/giveaway/status", expectedStatus: 401 });
  assert.equal(options.credentials, "omit");
  assert.equal(result.result.outcome, "expected-auth-required");
  globalThis.fetch = async () => { throw new TypeError("fetch failed", { cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }) }); };
  const failed = await probeSource({ id: "network", url: "https://example.com" });
  assert.equal(failed.result.error.code, "ECONNREFUSED");
  assert.equal(failed.result.outcome, "network-error");
});
