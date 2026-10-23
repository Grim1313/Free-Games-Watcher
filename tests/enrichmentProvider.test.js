import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichPromotions,
  extractSteamFreeToKeepEndsAtFromHtml,
  parseSteamFreeToKeepEndsAt,
} from "../src/lib/providers/enrichmentProvider.js";
import { PROMOTION_DEADLINE_TTL_MS } from "../src/lib/constants.js";

test("extractSteamFreeToKeepEndsAtFromHtml parses Steam free-to-keep purchase text", () => {
  const nowTs = Date.UTC(2026, 5, 1, 16, 0);
  const expectedTs = Date.UTC(2026, 5, 1, 17, 0);
  const html = `
    <p class="game_purchase_discount_quantity ">
      Free to keep when you get it before Jun 1 @ 10:00am.
      Some limitations apply.
    </p>
  `;

  assert.equal(extractSteamFreeToKeepEndsAtFromHtml(html, nowTs), expectedTs);
});

test("extractSteamFreeToKeepEndsAtFromHtml can parse deadline text outside the purchase class", () => {
  const nowTs = Date.UTC(2026, 5, 1, 16, 0);
  const expectedTs = Date.UTC(2026, 5, 1, 17, 0);

  assert.equal(
    extractSteamFreeToKeepEndsAtFromHtml(
      "Free to keep when you get it before Jun 1 @ 10:00am.",
      nowTs,
    ),
    expectedTs,
  );
});

test("extractSteamFreeToKeepEndsAtFromHtml can parse escaped Steam script text", () => {
  const nowTs = Date.UTC(2026, 5, 1, 16, 0);
  const expectedTs = Date.UTC(2026, 5, 1, 17, 0);

  assert.equal(
    extractSteamFreeToKeepEndsAtFromHtml(
      "Free to keep when you get it before Jun 1 @ 10:00am. Some <\\/span> text",
      nowTs,
    ),
    expectedTs,
  );
});

test("parseSteamFreeToKeepEndsAt rolls no-year January deadlines into the next year", () => {
  const nowTs = Date.UTC(2026, 11, 31, 20, 0);
  const expectedTs = Date.UTC(2027, 0, 2, 18, 0);

  assert.equal(
    parseSteamFreeToKeepEndsAt(
      "Free to keep when you get it before Jan 2 @ 10:00am.",
      nowTs,
    ),
    expectedTs,
  );
});

test("parseSteamFreeToKeepEndsAt parses localized Steam times as device-local time", () => {
  const nowTs = Date.UTC(2026, 5, 2, 8, 0);
  const expectedTs = new Date(2026, 6, 1, 20, 0, 0, 0).getTime();

  assert.equal(
    parseSteamFreeToKeepEndsAt(
      "Free to keep when you get it before Jul 1 @ 8:00pm.",
      nowTs,
    ),
    expectedTs,
  );
});

test("enrichPromotions adds Steam review summary fields from appreviews", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const nowTs = Date.UTC(2026, 0, 1, 16, 0);
  const endsAt = Date.UTC(2026, 0, 1, 18, 0);

  Date.now = () => nowTs;

  globalThis.fetch = async (url) => {
    if (url.includes("IStoreBrowseService/GetItems")) {
      return {
        ok: true,
        async json() {
          return {
            response: {
              store_items: [
                {
                  appid: 599140,
                  best_purchase_option: {
                    is_free_to_keep: true,
                    free_to_keep_ends: endsAt / 1000,
                  },
                },
              ],
            },
          };
        },
      };
    }

    if (url.includes("/api/appdetails?")) {
      return {
        ok: true,
        async json() {
          return {
            599140: {
              success: true,
              data: {
                name: "Graveyard Keeper",
                type: "game",
                genres: [{ description: "Simulation" }],
                categories: [{ description: "Single-player" }],
                header_image:
                  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg",
                capsule_image:
                  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/capsule.jpg",
                screenshots: [
                  {
                    path_thumbnail:
                      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/shot_600.jpg",
                    path_full:
                      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/shot_1920.jpg",
                  },
                ],
                price_overview: {
                  initial: 999,
                  final: 0,
                  initial_formatted: "$9.99",
                },
              },
            },
          };
        },
      };
    }

    if (url.includes("/appreviews/599140?")) {
      return {
        ok: true,
        async json() {
          return {
            success: 1,
            query_summary: {
              review_score: 8,
              review_score_desc: "Very Positive",
              total_positive: 42320,
              total_negative: 7033,
              total_reviews: 49353,
            },
          };
        },
      };
    }

    if (url.includes("/app/599140/")) {
      return {
        ok: true,
        async text() {
          return '<p class="game_purchase_discount_quantity ">Free to keep when you get it before Jan 1 @ 10:00am.</p>';
        },
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  t.after(() => {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  });

  const result = await enrichPromotions(
    [
      {
        id: "app:599140|free-to-keep|steam-store-search",
        stableId: "app:599140",
        appId: 599140,
        title: "",
        promoType: "free-to-keep",
        sourceId: "steam-store-search",
      },
    ],
    {},
  );

  assert.equal(result.promotions.length, 1);
  assert.equal(result.promotions[0].reviewScore, 8);
  assert.equal(result.promotions[0].reviewScoreDesc, "Very Positive");
  assert.equal(result.promotions[0].reviewPositive, 42320);
  assert.equal(result.promotions[0].reviewNegative, 7033);
  assert.equal(result.promotions[0].reviewTotal, 49353);
  assert.equal(result.promotions[0].reviewPercent, 86);
  assert.equal(result.promotions[0].endsAt, endsAt);
  assert.equal(result.promotions[0].basePriceFormatted, "$9.99");

  assert.equal(result.metadataCache["app:599140"].reviewScore, 8);
  assert.equal(result.metadataCache["app:599140"].reviewPercent, 86);
  assert.equal(
    result.metadataCache["app:599140"].priceInitialFormatted,
    "$9.99",
  );
  assert.equal(result.metadataCache["app:599140"].freeToKeepEndsAt, endsAt);
});

test("enrichPromotions retries Steam deadline lookup when cached end time miss is stale", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const nowTs = Date.UTC(2026, 5, 1, 16, 0);
  const endsAt = Date.UTC(2026, 5, 1, 17, 0);
  let appPageRequests = 0;
  let appPageFetchOptions = null;

  Date.now = () => nowTs;

  globalThis.fetch = async (url, options) => {
    if (url.includes("/app/3771740/")) {
      appPageRequests += 1;
      appPageFetchOptions = options;
      return {
        ok: true,
        async text() {
          return '<p class="game_purchase_discount_quantity ">Free to keep when you get it before Jun 1 @ 10:00am.</p>';
        },
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  t.after(() => {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  });

  const result = await enrichPromotions(
    [
      {
        id: "app:3771740|free-to-keep|steam-store-search",
        stableId: "app:3771740",
        appId: 3771740,
        title: "IQ Under Construction",
        promoType: "free-to-keep",
        sourceId: "steam-store-search",
      },
    ],
    {
      "app:3771740": {
        title: "IQ Under Construction",
        type: "game",
        priceInitial: 299,
        priceFinal: 299,
        priceDiscountPercent: 100,
        priceFinalFormatted: "Free",
        freeToKeepEndsAt: 0,
        freeToKeepDeadlineUpdatedAt: nowTs - PROMOTION_DEADLINE_TTL_MS - 1,
        freeToKeepDeadlineTimeZone: "America/Los_Angeles",
        freeToKeepDeadlineVersion: 2,
        reviewUpdatedAt: nowTs,
        updatedAt: nowTs,
      },
    },
  );

  assert.equal(appPageRequests, 1);
  assert.equal(appPageFetchOptions?.credentials, "omit");
  assert.equal(result.promotions[0].endsAt, endsAt);
});

test("enrichPromotions retries fresh cached deadline misses", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const nowTs = Date.UTC(2026, 5, 1, 16, 0);
  const endsAt = Date.UTC(2026, 5, 1, 17, 0);
  let appPageRequests = 0;

  Date.now = () => nowTs;

  globalThis.fetch = async (url) => {
    if (url.includes("IStoreBrowseService/GetItems")) {
      return {
        ok: true,
        async json() {
          return { response: { store_items: [] } };
        },
      };
    }

    if (url.includes("/app/3771740/")) {
      appPageRequests += 1;
      return {
        ok: true,
        async text() {
          return '<p class="game_purchase_discount_quantity ">Free to keep when you get it before Jun 1 @ 10:00am.</p>';
        },
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  t.after(() => {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  });

  const result = await enrichPromotions(
    [
      {
        id: "app:3771740|free-to-keep|steam-store-search",
        stableId: "app:3771740",
        appId: 3771740,
        title: "IQ Under Construction",
        promoType: "free-to-keep",
        sourceId: "steam-store-search",
      },
    ],
    {
      "app:3771740": {
        title: "IQ Under Construction",
        type: "game",
        priceInitial: 299,
        priceFinal: 299,
        priceDiscountPercent: 100,
        priceFinalFormatted: "Free",
        freeToKeepEndsAt: 0,
        freeToKeepDeadlineUpdatedAt: nowTs,
        freeToKeepDeadlineTimeZone: "America/Los_Angeles",
        freeToKeepDeadlineVersion: 4,
        reviewUpdatedAt: nowTs,
        updatedAt: nowTs,
      },
    },
  );

  assert.equal(appPageRequests, 1);
  assert.equal(result.promotions[0].endsAt, endsAt);
  assert.deepEqual(result.warnings, []);
});

test("enrichPromotions reports when Steam deadline HTML cannot be parsed", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const nowTs = Date.UTC(2026, 5, 1, 16, 0);

  Date.now = () => nowTs;

  globalThis.fetch = async (url) => {
    if (url.includes("IStoreBrowseService/GetItems")) {
      return {
        ok: true,
        async json() {
          return { response: { store_items: [] } };
        },
      };
    }

    if (url.includes("/app/3771740/")) {
      return {
        ok: true,
        async text() {
          return "<html><body>No deadline here</body></html>";
        },
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  t.after(() => {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  });

  const result = await enrichPromotions(
    [
      {
        id: "app:3771740|free-to-keep|steam-store-search",
        stableId: "app:3771740",
        appId: 3771740,
        title: "IQ Under Construction",
        promoType: "free-to-keep",
        sourceId: "steam-store-search",
      },
    ],
    {
      "app:3771740": {
        title: "IQ Under Construction",
        type: "game",
        priceInitial: 299,
        priceFinal: 299,
        priceDiscountPercent: 100,
        priceFinalFormatted: "Free",
        reviewUpdatedAt: nowTs,
        updatedAt: nowTs,
      },
    },
  );

  assert.equal(result.promotions[0].endsAt, 0);
  assert.equal(
    result.metadataCache["app:3771740"].freeToKeepDeadlineUpdatedAt,
    nowTs,
  );
  assert.equal(
    result.metadataCache["app:3771740"].freeToKeepDeadlineTimeZone,
    "StoreBrowse",
  );
  assert.equal(
    result.metadataCache["app:3771740"].freeToKeepDeadlineVersion,
    4,
  );
  assert.match(result.warnings[0], /end time not found for app 3771740/);
});

test("enrichPromotions backfills reviews for fresh cached metadata created before review support", async (t) => {
  const originalFetch = globalThis.fetch;
  const nowTs = Date.now();

  globalThis.fetch = async (url) => {
    if (url.includes("IStoreBrowseService/GetItems")) {
      return {
        ok: true,
        async json() {
          return { response: { store_items: [] } };
        },
      };
    }

    if (url.includes("/api/appdetails?")) {
      return {
        ok: true,
        async json() {
          return {
            599140: {
              success: true,
              data: {
                name: "Graveyard Keeper",
                type: "game",
                genres: [{ description: "Simulation" }],
                categories: [{ description: "Single-player" }],
                header_image:
                  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg",
                capsule_image:
                  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/capsule.jpg",
                screenshots: [
                  {
                    path_thumbnail:
                      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/shot_600.jpg",
                    path_full:
                      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/shot_1920.jpg",
                  },
                ],
                price_overview: {
                  initial: 999,
                  final: 0,
                },
              },
            },
          };
        },
      };
    }

    if (url.includes("/appreviews/599140?")) {
      return {
        ok: true,
        async json() {
          return {
            success: 1,
            query_summary: {
              review_score: 8,
              review_score_desc: "Very Positive",
              total_positive: 42320,
              total_negative: 7033,
              total_reviews: 49353,
            },
          };
        },
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await enrichPromotions(
    [
      {
        id: "app:599140|free-to-keep|steam-store-search",
        stableId: "app:599140",
        appId: 599140,
        title: "",
        promoType: "free-to-keep",
        sourceId: "steam-store-search",
      },
    ],
    {
      "app:599140": {
        title: "Graveyard Keeper",
        type: "game",
        genres: ["Simulation"],
        categories: ["Single-player"],
        headerImage:
          "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg",
        capsuleImage:
          "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/capsule.jpg",
        screenshotThumbnail:
          "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/shot_600.jpg",
        screenshotFull:
          "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/shot_1920.jpg",
        priceInitial: 999,
        priceFinal: 0,
        updatedAt: nowTs,
      },
    },
  );

  assert.equal(result.promotions[0].reviewTotal, 49353);
  assert.equal(result.promotions[0].reviewPercent, 86);
  assert.ok(result.metadataCache["app:599140"].reviewUpdatedAt > 0);
});

test("enrichPromotions confirms 100 percent appdetails discounts with non-zero numeric final price", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (url.includes("IStoreBrowseService/GetItems")) {
      return {
        ok: true,
        async json() {
          return { response: { store_items: [] } };
        },
      };
    }

    if (url.includes("/api/appdetails?")) {
      return {
        ok: true,
        async json() {
          return {
            3550490: {
              success: true,
              data: {
                name: "Overcome Your Fears - Caretaker",
                type: "game",
                genres: [{ description: "Adventure" }],
                categories: [{ description: "Single-player" }],
                header_image:
                  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3550490/header.jpg",
                capsule_image:
                  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3550490/capsule.jpg",
                screenshots: [],
                price_overview: {
                  initial: 599,
                  final: 599,
                  discount_percent: 100,
                  final_formatted: "Free",
                },
              },
            },
          };
        },
      };
    }

    if (url.includes("/appreviews/3550490?")) {
      return {
        ok: true,
        async json() {
          return {
            success: 1,
            query_summary: {
              review_score: 6,
              review_score_desc: "Mostly Positive",
              total_positive: 108,
              total_negative: 32,
              total_reviews: 140,
            },
          };
        },
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await enrichPromotions(
    [
      {
        id: "app:3550490|free-to-keep|metadata-only",
        stableId: "app:3550490",
        appId: 3550490,
        title: "",
        promoType: "free-to-keep",
        sourceId: "metadata-only",
      },
    ],
    {},
  );

  assert.equal(result.promotions.length, 1);
  assert.equal(result.promotions[0].isLikelyFreeToKeep, true);
  assert.equal(result.metadataCache["app:3550490"].priceDiscountPercent, 100);
  assert.equal(result.metadataCache["app:3550490"].priceFinalFormatted, "Free");
});
