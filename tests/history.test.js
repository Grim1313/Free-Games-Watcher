import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHistoryViewEntries,
  buildIgnoredPromotionEntries,
  restoreEntry,
  sanitizePromotionEntry,
} from "../src/lib/history.js";

test("restoreEntry returns dismissed active entries back to active state", () => {
  const [restored] = restoreEntry(
    [
      {
        campaignId: "",
        genres: [],
        platforms: [],
        stale: false,
        missingCount: 0,
        confirmedEnded: false,
        region: "US",
        id: "promo-1",
        fingerprint: "fp-1",
        status: "dismissed",
        notificationStatus: "dismissed",
        lastSeenAt: 200,
        lastCheckedAt: 200,
        unread: false,
      },
    ],
    "promo-1",
    500,
    {},
  );

  assert.equal(restored.status, "active");
  assert.equal(restored.notificationStatus, "pending");
  assert.equal(restored.lastStateChangeAt, 500);
});

test("restoreEntry keeps notified entries marked as sent", () => {
  const [restored] = restoreEntry(
    [
      {
        campaignId: "",
        genres: [],
        platforms: [],
        stale: false,
        missingCount: 0,
        confirmedEnded: false,
        region: "US",
        id: "promo-1",
        fingerprint: "fp-1",
        status: "dismissed",
        notificationStatus: "dismissed",
        lastSeenAt: 200,
        lastCheckedAt: 300,
        unread: false,
      },
    ],
    "promo-1",
    700,
    {
      "promo-1": { fingerprint: "fp-1" },
    },
  );

  assert.equal(restored.status, "expired");
  assert.equal(restored.notificationStatus, "sent");
  assert.equal(restored.lastStateChangeAt, 700);
});

test("restoreEntry can restore the same promotion across different source ids", () => {
  const [restored] = restoreEntry(
    [
      {
        id: "app:978520|free-to-keep|steam-store-search",
        stableId: "app:978520",
        promoType: "free-to-keep",
        fingerprint: "fp-2",
        status: "dismissed",
        notificationStatus: "dismissed",
        lastSeenAt: 500,
        lastCheckedAt: 500,
        unread: false,
      },
    ],
    "app:978520|free-to-keep|steam-store-featured",
    900,
    {},
    "app:978520|free-to-keep",
  );

  assert.equal(restored.status, "active");
  assert.equal(restored.notificationStatus, "pending");
});

test("buildIgnoredPromotionEntries prefers current entry metadata and sorts newest first", () => {
  const ignored = buildIgnoredPromotionEntries(
    {
      "promo-1": {
        title: "Fallback Title",
        stableId: "app:10",
        appId: 10,
        dismissedAt: 100,
      },
      "promo-2": {
        title: "Older Title",
        stableId: "app:20",
        appId: 20,
        dismissedAt: 50,
      },
    },
    [
      {
        id: "promo-1",
        title: "Current Title",
        stableId: "app:10",
        appId: 10,
        url: "https://store.steampowered.com/app/10/",
        promoType: "free-to-keep",
        contentType: "game",
      },
    ],
    [],
  );

  assert.deepEqual(
    ignored.map((entry) => entry.id),
    ["promo-1", "promo-2"],
  );
  assert.equal(ignored[0].title, "Current Title");
  assert.equal(ignored[1].url, "https://store.steampowered.com/app/20/");
});

test("buildIgnoredPromotionEntries reuses current entries even when ignored id came from another source", () => {
  const ignored = buildIgnoredPromotionEntries(
    {
      "app:3534240|free-to-keep|steam-store-featured": {
        title: "Legacy Title",
        stableId: "app:3534240",
        appId: 3534240,
        promoType: "free-to-keep",
        dismissedAt: 100,
      },
    },
    [
      {
        id: "app:3534240|free-to-keep|steam-store-search",
        title: "Uncanny Tales: cold road",
        stableId: "app:3534240",
        appId: 3534240,
        url: "https://store.steampowered.com/app/3534240/",
        promoType: "free-to-keep",
        contentType: "game",
      },
    ],
    [],
  );

  assert.equal(ignored.length, 1);
  assert.equal(ignored[0].id, "app:3534240|free-to-keep|steam-store-featured");
  assert.equal(ignored[0].title, "Uncanny Tales: cold road");
});

test("buildHistoryViewEntries keeps ignored promotions visible in history", () => {
  const historyEntries = buildHistoryViewEntries(
    [
      {
        id: "active-1",
        title: "Active Title",
        status: "active",
        notificationStatus: "pending",
        firstSeenAt: 100,
        lastSeenAt: 200,
        lastStateChangeAt: 200,
      },
    ],
    [
      {
        id: "ignored-1",
        title: "Ignored Title",
        stableId: "app:3534240",
        url: "https://store.steampowered.com/app/3534240/",
        promoType: "free-to-keep",
        contentType: "game",
        dismissedAt: 300,
      },
    ],
  );

  assert.deepEqual(
    historyEntries.map((entry) => entry.id),
    ["ignored-1", "active-1"],
  );
  assert.equal(historyEntries[0].status, "dismissed");
  assert.equal(historyEntries[0].notificationStatus, "dismissed");
});

test("sanitizePromotionEntry preserves normalized review summary fields", () => {
  assert.deepEqual(
    sanitizePromotionEntry({
      id: "promo-1",
      basePriceFormatted: "  $19.99  ",
      review_score: 8,
      review_score_desc: "Very Positive",
      total_positive: 42320,
      total_negative: 7033,
      total_reviews: 49353,
    }),
    {
      store: "steam",
      claimUrl: "https://store.steampowered.com/",
      campaignId: "",
      genres: [],
      platforms: [],
      stale: false,
      missingCount: 0,
      confirmedEnded: false,
      region: "US",
      id: "promo-1",
      fingerprint: "",
      stableId: "",
      appId: 0,
      packageId: 0,
      title: "",
      promoType: "free-to-keep",
      rawTypeLabel: "",
      contentType: "unknown",
      basePriceFormatted: "$19.99",
      url: "https://store.steampowered.com/",
      headerImage: "",
      capsuleImage: "",
      screenshotThumbnail: "",
      screenshotFull: "",
      reviewScore: 8,
      reviewScoreDesc: "Very Positive",
      reviewPositive: 42320,
      reviewNegative: 7033,
      reviewTotal: 49353,
      reviewPercent: 86,
      sourceId: "",
      sourceFingerprint: "",
      startsAt: 0,
      endsAt: 0,
      firstSeenAt: 0,
      lastSeenAt: 0,
      lastCheckedAt: 0,
      lastNotifiedAt: 0,
      unread: false,
      status: "active",
      notificationStatus: "pending",
      lastStateChangeAt: 0,
    },
  );
});
