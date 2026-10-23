import { CONTENT_TYPES } from "../lib/constants.js";

function getPopupContentPriority(entry) {
  return entry?.contentType === CONTENT_TYPES.GAME ? 0 : 1;
}

export function getVisiblePromotions(entries, maxItems = 10) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.status === "active")
    .sort(
      (left, right) =>
        getPopupContentPriority(left) - getPopupContentPriority(right),
    )
    .slice(0, maxItems);
}

export function getPromotionBasePriceLabel(entry = {}) {
  const price =
    typeof entry?.basePriceFormatted === "string"
      ? entry.basePriceFormatted.trim()
      : "";
  const normalizedDigits = price.replace(/[^\d.,]/g, "");
  if (
    !price ||
    /\bfree\b/i.test(price) ||
    /^0(?:[.,]00)?$/.test(normalizedDigits)
  ) {
    return "";
  }
  return `Base price: ${price}`;
}

export function getPopupStatusText(runtimeState = {}) {
  if (runtimeState.checkInProgress) {
    return "Checking now...";
  }
  if (runtimeState.lastCheckOutcome === "error") {
    return "Source error";
  }
  if (runtimeState.lastCheckOutcome === "success") {
    return runtimeState.lastResultCount > 0
      ? `${runtimeState.lastResultCount} promotion(s) tracked`
      : "No new free promotions found";
  }
  return "Idle";
}
