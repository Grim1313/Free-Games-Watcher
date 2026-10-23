import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSteamHeaderImageUrl,
  formatPromotionDeadlineStatus,
  formatSteamReviewNotificationSummary,
  formatSteamReviewTooltip,
  getPromotionImageUrl,
  getPromotionCoverUrls,
  sanitizeSteamAssetUrl,
  sanitizeSteamReviewSummary,
} from "../src/lib/utils.js";

test("sanitizeSteamAssetUrl allows Steam-hosted https artwork only", () => {
  assert.equal(
    sanitizeSteamAssetUrl(
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg",
    ),
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg",
  );
  assert.equal(
    sanitizeSteamAssetUrl(
      "http://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg",
    ),
    "",
  );
  assert.equal(sanitizeSteamAssetUrl("https://example.com/header.jpg"), "");
});

test("getPromotionImageUrl prefers screenshots and falls back to cover art", () => {
  const promotion = {
    appId: 599140,
    screenshotThumbnail:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/shot_600.jpg",
    screenshotFull:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/shot_1920.jpg",
    headerImage:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg",
    capsuleImage:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/capsule.jpg",
  };

  assert.equal(getPromotionImageUrl(promotion), promotion.screenshotThumbnail);
  assert.equal(
    getPromotionImageUrl(promotion, { fullSize: true }),
    promotion.screenshotFull,
  );
  assert.equal(
    getPromotionImageUrl({
      appId: 599140,
      screenshotThumbnail: "",
      screenshotFull: "",
      headerImage: promotion.headerImage,
      capsuleImage: promotion.capsuleImage,
    }),
    promotion.headerImage,
  );
  assert.equal(
    getPromotionImageUrl({
      appId: 599140,
      screenshotThumbnail: "",
      screenshotFull: "",
      headerImage: "",
      capsuleImage: "",
    }),
    buildSteamHeaderImageUrl(599140),
  );
});

test("UI cover candidates prefer supplied header/capsule and never gallery screenshots", () => {
  const header = "https://shared.akamai.steamstatic.com/header.jpg";
  const capsule = "https://shared.akamai.steamstatic.com/capsule.jpg";
  assert.deepEqual(
    getPromotionCoverUrls({
      appId: 599140,
      headerImage: header,
      capsuleImage: capsule,
      screenshotThumbnail: header + "?shot",
    }),
    [header, capsule],
  );
  assert.deepEqual(
    getPromotionCoverUrls({ headerImage: header, capsuleImage: header }),
    [header],
  );
  assert.deepEqual(
    getPromotionCoverUrls({
      headerImage: "https://example.com/header.jpg",
      capsuleImage: capsule,
    }),
    [capsule],
  );
  assert.deepEqual(
    getPromotionCoverUrls({
      screenshotThumbnail: header,
      screenshotFull: capsule,
    }),
    [],
  );
});

test("UI cover candidates can recover a legacy header for records without artwork", () => {
  assert.deepEqual(getPromotionCoverUrls({ stableId: "app:599140" }), [
    buildSteamHeaderImageUrl(599140),
  ]);
  assert.deepEqual(getPromotionCoverUrls({ appId: 599140 }), [
    buildSteamHeaderImageUrl(599140),
  ]);
  assert.deepEqual(getPromotionCoverUrls(null), []);
  assert.deepEqual(getPromotionCoverUrls({ stableId: "sub:123" }), []);
});

test("sanitizeSteamReviewSummary normalizes counts and computes positive percent", () => {
  assert.deepEqual(
    sanitizeSteamReviewSummary({
      review_score: 8,
      review_score_desc: "Very Positive",
      total_positive: 42320,
      total_negative: 7033,
      total_reviews: 49353,
    }),
    {
      reviewScore: 8,
      reviewScoreDesc: "Very Positive",
      reviewPositive: 42320,
      reviewNegative: 7033,
      reviewTotal: 49353,
      reviewPercent: 86,
    },
  );
});

test("formatSteamReviewTooltip builds a compact readable summary", () => {
  const tooltip = formatSteamReviewTooltip({
    reviewScoreDesc: "Very Positive",
    reviewPositive: 42320,
    reviewNegative: 7033,
    reviewTotal: 49353,
  });

  assert.match(
    tooltip,
    /^Very Positive · 86% positive · 49(?:,| |\u00A0)?353 Steam reviews$/,
  );
});

test("formatSteamReviewNotificationSummary builds a short notification line", () => {
  assert.equal(
    formatSteamReviewNotificationSummary({
      reviewScoreDesc: "Very Positive",
      reviewPositive: 42320,
      reviewNegative: 7033,
      reviewTotal: 49353,
    }),
    "Very Positive · 86% positive · 49.4K reviews",
  );
});

test("formatPromotionDeadlineStatus remains visible when Steam end time is unavailable", () => {
  assert.equal(formatPromotionDeadlineStatus(0, 0), "End time unavailable");
  assert.match(
    formatPromotionDeadlineStatus(0, new Date(2026, 0, 1, 10, 0).getTime()),
    /^End time unavailable · Last checked .+/,
  );
});
