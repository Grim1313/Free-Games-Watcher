import test from "node:test";
import assert from "node:assert/strict";

import {
  getPopupStatusText,
  getPromotionBasePriceLabel,
  getVisiblePromotions,
} from "../src/ui/popup-state.js";

test("getVisiblePromotions keeps only active entries for the popup", () => {
  const visible = getVisiblePromotions([
    { id: "expired-1", status: "expired" },
    { id: "active-1", status: "active" },
    { id: "dismissed-1", status: "dismissed" },
    { id: "active-2", status: "active" },
  ]);

  assert.deepEqual(
    visible.map((entry) => entry.id),
    ["active-1", "active-2"],
  );
});

test("getVisiblePromotions shows games before other content types", () => {
  const visible = getVisiblePromotions(
    [
      { id: "dlc-1", status: "active", contentType: "dlc" },
      { id: "package-1", status: "active", contentType: "package" },
      { id: "game-1", status: "active", contentType: "game" },
      { id: "game-2", status: "active", contentType: "game" },
      { id: "demo-1", status: "active", contentType: "demo" },
    ],
    3,
  );

  assert.deepEqual(
    visible.map((entry) => entry.id),
    ["game-1", "game-2", "dlc-1"],
  );
});

test("getPopupStatusText reports when no new free promotions were found", () => {
  assert.equal(
    getPopupStatusText({ lastCheckOutcome: "success", lastResultCount: 0 }),
    "No new free promotions found",
  );
});

test("getPromotionBasePriceLabel marks stored price as the base price", () => {
  assert.equal(
    getPromotionBasePriceLabel({ basePriceFormatted: "$19.99" }),
    "Base price: $19.99",
  );
  assert.equal(getPromotionBasePriceLabel({ basePriceFormatted: "$0.00" }), "");
  assert.equal(getPromotionBasePriceLabel({ basePriceFormatted: "Free" }), "");
});
