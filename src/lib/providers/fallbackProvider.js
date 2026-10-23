import { PROMO_TYPES, SOURCE_IDS } from "../constants.js";
import {
  buildSteamUrlFromStableId,
  createHash,
  fetchJsonWithTimeout,
} from "../utils.js";

const FEATURED_URL =
  "https://store.steampowered.com/api/featuredcategories/?cc=us&l=english";
const USD_CENTS_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatUsdCents(value) {
  const cents = Number(value);
  return Number.isFinite(cents) && cents > 0
    ? USD_CENTS_FORMATTER.format(cents / 100)
    : "";
}

export const fallbackProvider = {
  id: SOURCE_IDS.STORE_FEATURED,
  async fetchPromotions(settings = {}) {
    const data = await fetchJsonWithTimeout(
      FEATURED_URL.replace(
        "cc=us",
        `cc=${(settings.region || "US").toLowerCase()}`,
      ),
      { credentials: "omit" },
    );
    if (!Array.isArray(data?.specials?.items))
      throw new Error("Invalid Steam featured response");
    const items = Array.isArray(data?.specials?.items)
      ? data.specials.items
      : [];
    const promotions = items
      .filter(
        (item) =>
          Number(item?.final_price) === 0 &&
          Number(item?.original_price) > 0 &&
          Number(item?.id) > 0,
      )
      .map((item) => {
        const stableId = `app:${item.id}`;
        const discountExpiration = Number(item.discount_expiration) || 0;
        return {
          stableId,
          appId: Number(item.id),
          packageId: 0,
          title: String(item.name || "").trim(),
          url: buildSteamUrlFromStableId(stableId),
          promoType: PROMO_TYPES.FREE_TO_KEEP,
          rawTypeLabel: "Featured special",
          sourceId: SOURCE_IDS.STORE_FEATURED,
          sourceFingerprint: createHash(
            `${item.id}|${item.name}|${item.original_price}|${item.final_price}|${discountExpiration}`,
          ),
          basePriceFormatted:
            (settings.region || "US") === "US"
              ? formatUsdCents(item.original_price)
              : "",
          endsAt: discountExpiration > 0 ? discountExpiration * 1000 : 0,
        };
      });

    return {
      promotions,
      warnings: [],
      complete: false,
      success: true,
    };
  },
};
