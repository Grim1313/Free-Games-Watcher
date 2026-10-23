import test from "node:test";
import assert from "node:assert/strict";
import { environment, row, response, entry } from "./helpers.mjs";
import {
  steamStoreSearchProvider,
  validateSearchResponse,
} from "../src/lib/providers/steamStoreSearchProvider.js";
import { verifyMissingPromotions } from "../src/lib/providers/index.js";
import { enrichPromotions } from "../src/lib/providers/enrichmentProvider.js";

test("invalid JSON shape and unrecognized nonempty markup are not empty success", () => {
  for (const data of [
    {},
    { total_count: 3, results_html: "<html>captcha</html>" },
    { total_count: 0 },
  ])
    assert.throws(() => validateSearchResponse(data));
  assert.equal(
    validateSearchResponse({ total_count: 0, results_html: "" }).total_count,
    0,
  );
});
test("search passes one region, removes language exclusion and stops at actual total", async (t) => {
  environment(t);
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return response({ total_count: 1, results_html: row() });
  };
  const result = await steamStoreSearchProvider.fetchPromotions({
    region: "DE",
  });
  assert.equal(result.complete, true);
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.ok(url.includes("cc=de"));
    assert.ok(!url.includes("supportedlang"));
  }
});
test("secondary search failure preserves primary results and exposes partial status", async (t) => {
  environment(t);
  globalThis.fetch = async (url) => {
    if (url.includes("category1")) throw new Error("timeout");
    return response({ total_count: 1, results_html: row() });
  };
  const result = await steamStoreSearchProvider.fetchPromotions();
  assert.equal(result.promotions.length, 1);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.length);
});
test("page cap bounds requests and reports coverage separately from transport failures", async (t) => {
  environment(t);
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return response({ total_count: 9999, results_html: row() });
  };
  const result = await steamStoreSearchProvider.fetchPromotions();
  assert.equal(requests, 12);
  assert.equal(result.coverageLimited, true);
  assert.equal(result.complete, true);
});
test("missing app is expired only when a paid purchase option confirms it", async (t) => {
  environment(t);
  globalThis.fetch = async () =>
    response({
      response: {
        store_items: [
          { appid: 123, best_purchase_option: { final_price_in_cents: "999" } },
        ],
      },
    });
  assert.equal(
    (
      await verifyMissingPromotions([entry()], { region: "US" })
    ).confirmedEnded.has("app:123"),
    true,
  );
  globalThis.fetch = async () => response({ response: { store_items: [] } });
  assert.equal(
    (await verifyMissingPromotions([entry()], { region: "US" })).confirmedEnded
      .size,
    0,
  );
});
test("active purchase option recovers an offer missing from search", async (t) => {
  environment(t);
  const ends = Math.floor((Date.now() + 86400000) / 1000);
  globalThis.fetch = async () =>
    response({
      response: {
        store_items: [
          {
            appid: 123,
            best_purchase_option: {
              is_free_to_keep: true,
              free_to_keep_ends: ends,
            },
          },
        ],
      },
    });
  const result = await verifyMissingPromotions([entry()], { region: "US" });
  assert.equal(result.recovered.length, 1);
  assert.equal(result.recovered[0].endsAt, ends * 1000);
});
test("negative deadline cache suppresses repeated requests until TTL", async (t) => {
  environment(t);
  const now = Date.now();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("unexpected");
  };
  const cache = {
    "app:123": {
      region: "US",
      type: "game",
      updatedAt: now,
      reviewUpdatedAt: now,
      freeToKeepDeadlineUpdatedAt: now,
      freeToKeepDeadlineTimeZone: "StoreBrowse",
      freeToKeepDeadlineVersion: 4,
      freeToKeepEndsAt: 0,
    },
  };
  await enrichPromotions([entry()], cache, { region: "US" });
  assert.equal(requests, 0);
});
test("future deadlines refresh after TTL and use the selected region", async (t) => {
  environment(t);
  const now = Date.now();
  const urls = [];
  const oldEnd = now + 86400000,
    newEnd = now + 172800000;
  globalThis.fetch = async (url) => {
    urls.push(url);
    return response({
      response: {
        store_items: [
          {
            appid: 123,
            best_purchase_option: {
              is_free_to_keep: true,
              free_to_keep_ends: newEnd / 1000,
            },
          },
        ],
      },
    });
  };
  const cache = {
    "app:123": {
      region: "DE",
      type: "game",
      updatedAt: now,
      reviewUpdatedAt: now,
      freeToKeepDeadlineUpdatedAt: now - 7 * 3600000,
      freeToKeepDeadlineTimeZone: "StoreBrowse",
      freeToKeepDeadlineVersion: 4,
      freeToKeepEndsAt: oldEnd,
    },
  };
  const result = await enrichPromotions([entry()], cache, { region: "DE" });
  assert.equal(result.promotions[0].endsAt, newEnd);
  assert.ok(decodeURIComponent(urls[0]).includes('"country_code":"DE"'));
});
