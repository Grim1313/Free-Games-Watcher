import { fetchJsonWithTimeout } from "../utils.js";
import { storeUrl, storeAsset, validStableId } from "../stores.js";

export const EPIC_SOURCE = "epic-promotions";
const rows = (value, name) => {
  if (!Array.isArray(value)) throw new Error(`Invalid Epic ${name}`);
  return value;
};
export function parseEpicFeed(data, region, now = Date.now()) {
  if (data?.errors?.length) throw new Error("Epic API errors");
  const elements = rows(data?.data?.Catalog?.searchStore?.elements, "catalog");
  const promotions = [], upcoming = [], warnings = [], confirmedEnded = new Set();
  for (const item of elements) {
    const stableId = `epic:${item.namespace}:${item.id}`;
    if (!validStableId(stableId) || typeof item.title !== "string" || !item.title)
      throw new Error("Invalid Epic identity");
    const price = item.price?.totalPrice;
    const original = price?.originalPrice, final = price?.discountPrice;
    const slug = item.catalogNs?.mappings?.find((m) => m.pageType === "productHome")?.pageSlug
      || item.offerMappings?.find((m) => m.pageType === "productHome")?.pageSlug || item.productSlug;
    const validSlug = typeof slug === "string" && /^[a-zA-Z0-9_/-]+$/.test(slug) && !slug.split("/").includes("..");
    const base = {
      store: "epic", stableId, region, title: item.title.slice(0, 300),
      url: storeUrl({ stableId, url: validSlug ? `https://store.epicgames.com/en-US/p/${slug}` : "" }),
      promoType: "free-to-keep", sourceId: EPIC_SOURCE, isLikelyFreeToKeep: true,
      contentType: { BASE_GAME: "game", DLC: "dlc", BUNDLE: "package", DEMO: "demo", EDITION: "game" }[item.offerType] || "unknown",
      basePriceFormatted: price?.fmtPrice?.originalPrice || "",
      headerImage: storeAsset(item.keyImages?.find((i) => i.type === "OfferImageWide")?.url
        || item.keyImages?.find((i) => i.type === "Thumbnail")?.url, stableId),
      genres: [], platforms: [], reviewTotal: 0,
    };
    for (const [key, future] of [["promotionalOffers", false], ["upcomingPromotionalOffers", true]]) {
      for (const group of rows(item.promotions?.[key] ?? [], "promotion groups")) {
        for (const offer of rows(group.promotionalOffers, "promotion windows")) {
          const startsAt = Date.parse(offer.startDate), endsAt = Date.parse(offer.endDate);
          if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt)
            throw new Error("Invalid Epic dates");
          if (offer.discountSetting?.discountType !== "PERCENTAGE" || offer.discountSetting.discountPercentage !== 0) continue;
          if (!(typeof original === "number" && original > 0)) {
            warnings.push(`Epic ${item.id}: unknown/non-paid original price`);
            continue;
          }
          if (endsAt <= now) { confirmedEnded.add(stableId); continue; }
          const promotion = { ...base, startsAt, endsAt };
          if (future && startsAt > now) {
            if (validSlug) upcoming.push(promotion);
            else warnings.push(`Epic ${item.id}: upcoming window without product link`);
          }
          else if (!future && startsAt <= now) {
            if (final === 0 && validSlug) promotions.push(promotion);
            else warnings.push(`Epic ${item.id}: free window without confirmed price/link`);
          }
        }
      }
    }
  }
  // Multiple windows/editions must not duplicate one current store offer.
  const unique = (items) => [...new Map(items.map((p) => [p.stableId, p])).values()];
  for (const p of promotions) confirmedEnded.delete(p.stableId);
  return { promotions: unique(promotions), upcoming: unique(upcoming), warnings, confirmedEnded,
    complete: warnings.length === 0, coverageLimited: true, catalogCount: elements.length };
}
export async function fetchEpicPromotions(settings) {
  const region = settings.region || "US";
  const data = await fetchJsonWithTimeout(
    `https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${region}&allowCountries=${region}`,
    { credentials: "omit" },
  );
  return parseEpicFeed(data, region);
}
