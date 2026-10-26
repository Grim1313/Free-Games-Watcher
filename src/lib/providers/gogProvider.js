import { fetchJsonWithTimeout } from "../utils.js";
import { storeUrl, storeAsset, validStableId } from "../stores.js";

export const GOG_SOURCE = "gog-giveaways";
const MAX_SECTIONS = 3;

// Field names are from GOG's public GIVEAWAY_SECTION component (26 Oct 2026).
// A catalog item with zero price alone is deliberately NOT a confirmed giveaway.
export function parseGogGiveaway(data, region, now = Date.now()) {
  const properties = data?.properties, product = properties?.product;
  const stableId = `gog:${product?.id}`;
  const endsAt = Date.parse(properties?.endDate);
  const startsAt = properties?.startDate ? Date.parse(properties.startDate) : 0;
  if (!validStableId(stableId) || typeof product?.title !== "string" || !product.title
    || !Number.isFinite(endsAt) || !Number.isFinite(startsAt) || (startsAt && endsAt <= startsAt)
    || typeof product.slug !== "string" || !/^[a-zA-Z0-9_-]+$/.test(product.slug))
    throw new Error("Invalid GOG giveaway section");
  const promotion = {
    store: "gog", stableId, region, title: product.title.slice(0, 300),
    url: storeUrl({ stableId, url: `https://www.gog.com/en/game/${product.slug}` }),
    claimUrl: "https://www.gog.com/en/", // GOG hosts the claim action on its homepage.
    promoType: "free-to-keep", sourceId: GOG_SOURCE, isLikelyFreeToKeep: true,
    contentType: (product.tags || []).some((t) => t.slug === "demo") ? "demo"
      : { game: "game", dlc: "dlc", pack: "package" }[product.productType] || "unknown",
    startsAt, endsAt,
    basePriceFormatted: Number(product.price?.baseMoney?.amount) > 0 ? product.price?.base || "" : "",
    headerImage: storeAsset(product.coverHorizontal, stableId),
    genres: (product.genres || []).map((g) => g.name).filter((g) => typeof g === "string"),
    platforms: (product.operatingSystems || []).map((p) => p === "osx" ? "mac" : p),
    reviewTotal: 0, // GOG stars are not a Steam positive-review percentage.
  };
  return { promotion, state: endsAt <= now ? "expired" : startsAt > now ? "upcoming" : "active" };
}

export async function fetchGogPromotions(settings) {
  const region = settings.region || "US";
  const query = `countryCode=${region}&locale=en-US&currencyCode=USD`;
  const [page, catalog] = await Promise.allSettled([
    fetchJsonWithTimeout(`https://sections.gog.com/v1/pages/2f?${query}`, { credentials: "omit" }),
    fetchJsonWithTimeout(`https://catalog.gog.com/v1/catalog?limit=48&page=1&order=desc:trending&price=between:0,0&discounted=eq:true&${query}`, { credentials: "omit" }),
  ]);
  const promotions = [], upcoming = [], warnings = [], confirmedEnded = new Set();
  let validPage = false, validCatalog = false, candidateCount = 0;
  if (catalog.status === "fulfilled" && Array.isArray(catalog.value?.products)
    && Number.isInteger(catalog.value.productCount) && catalog.value.productCount >= 0) {
    validCatalog = true;
    candidateCount = catalog.value.productCount;
  } else warnings.push(`GOG catalog: ${catalog.reason?.message || "invalid response"}`);
  if (page.status === "fulfilled" && Array.isArray(page.value?.sections) && page.value.config?.pageId) {
    validPage = true;
    const all = page.value.sections.filter((s) => s.sectionType === "GIVEAWAY_SECTION");
    if (all.length > MAX_SECTIONS) warnings.push("GOG giveaway section budget reached");
    for (const section of all.slice(0, MAX_SECTIONS)) {
      // Conditional/personal offers are not anonymous offers for all users.
      if (section.visibilityControl !== "ALL" || section.isPersonalized) {
        warnings.push("GOG conditional giveaway omitted");
        continue;
      }
      if (!/^[a-zA-Z0-9-]+$/.test(section.sectionId || "")) {
        warnings.push("GOG invalid section identifier");
        continue;
      }
      try {
        const raw = await fetchJsonWithTimeout(
          `https://sections.gog.com/v1/pages/2f/sections/${section.sectionId}?${query}`, { credentials: "omit" });
        const parsed = parseGogGiveaway(raw, region);
        if (parsed.state === "expired") confirmedEnded.add(parsed.promotion.stableId);
        else if (parsed.state === "upcoming") upcoming.push(parsed.promotion);
        else promotions.push(parsed.promotion);
      } catch (error) { warnings.push(`GOG section: ${error.message}`); }
    }
  } else warnings.push(`GOG sections: ${page.reason?.message || "invalid response"}`);
  if (!validPage && !validCatalog) throw new Error(warnings.join("; "));
  if (candidateCount) warnings.push(`GOG: ${candidateCount} zero-price discounted catalog entries need giveaway terms verification`);
  return { promotions, upcoming, confirmedEnded, warnings, complete: warnings.length === 0,
    coverageLimited: true, candidateCount, sectionSchemaLiveVerified: false };
}
