import test from "node:test";
import assert from "node:assert/strict";

import {
  dismissPromotionRecord,
  isPromotionDismissed,
  restorePromotionRecord,
} from "../src/lib/dedupe.js";

test("isPromotionDismissed matches the same promotion across different sources", () => {
  const dismissedMap = dismissPromotionRecord(
    {},
    {
      id: "app:3534240|free-to-keep|steam-store-featured",
      stableId: "app:3534240",
      appId: 3534240,
      packageId: 0,
      title: "Uncanny Tales: cold road",
      promoType: "free-to-keep",
      contentType: "game",
      url: "https://store.steampowered.com/app/3534240/",
      fingerprint: "old-fingerprint",
    },
    100,
  );

  assert.equal(
    isPromotionDismissed(
      {
        id: "app:3534240|free-to-keep|steam-store-search",
        stableId: "app:3534240",
        appId: 3534240,
        packageId: 0,
        promoType: "free-to-keep",
        fingerprint: "new-fingerprint",
      },
      dismissedMap,
    ),
    true,
  );
});

test("restorePromotionRecord removes matching ignored entries across sources", () => {
  let dismissedMap = dismissPromotionRecord(
    {},
    {
      id: "app:3534240|free-to-keep|steam-store-featured",
      stableId: "app:3534240",
      appId: 3534240,
      packageId: 0,
      title: "Uncanny Tales: cold road",
      promoType: "free-to-keep",
      contentType: "game",
      url: "https://store.steampowered.com/app/3534240/",
      fingerprint: "first",
    },
    100,
  );

  dismissedMap = dismissPromotionRecord(
    dismissedMap,
    {
      id: "app:3534240|free-to-keep|steam-store-search",
      stableId: "app:3534240",
      appId: 3534240,
      packageId: 0,
      title: "Uncanny Tales: cold road",
      promoType: "free-to-keep",
      contentType: "game",
      url: "https://store.steampowered.com/app/3534240/",
      fingerprint: "second",
    },
    200,
  );

  const restoredMap = restorePromotionRecord(
    dismissedMap,
    "app:3534240|free-to-keep|steam-store-search",
  );
  assert.deepEqual(restoredMap, {});
});
