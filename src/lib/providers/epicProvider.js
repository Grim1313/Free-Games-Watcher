import { fetchJsonWithTimeout } from "../utils.js";
import { storeUrl, storeAsset, validStableId } from "../stores.js";
import { epicTagMetadata } from "./epicTags.js";

export const EPIC_SOURCE = "epic-promotions";
export const EPIC_CATALOG_SOURCE = "epic-catalog";
export const EGDATA_SOURCE = "epic-egdata";
const CATALOG_PAGE_SIZE = 40;
const MAX_CATALOG_PAGES = 5;
// searchStoreQuery used by Epic's Browse page, observed 27 October 2026.
const CATALOG_QUERY_HASH = "7d58e12d9dd8cb14c84a3ff18d360bf9f0caa96bf218f2c5fda68ba88d68a437";
const unique = (items) => [...new Map(items.map((p) => [p.stableId, p])).values()];
const rows = (value, name) => {
  if (!Array.isArray(value)) throw new Error(`Invalid Epic ${name}`);
  return value;
};
function catalogElements(data) {
  if (data?.errors?.length) throw new Error("Epic API errors");
  return rows(data?.data?.Catalog?.searchStore?.elements, "catalog");
}
function epicOffer(item, region, sourceId) {
  const stableId = `epic:${item.namespace}:${item.id}`;
  if (!validStableId(stableId) || typeof item.title !== "string" || !item.title)
    throw new Error("Invalid Epic identity");
  // An offer-specific mapping must win over the namespace's base-game page (DLC).
  const slug = item.offerMappings?.find((m) => ["productHome", "offer"].includes(m.pageType))?.pageSlug
    || item.catalogNs?.mappings?.find((m) => m.pageType === "productHome")?.pageSlug || item.productSlug;
  const validSlug = typeof slug === "string" && /^[a-zA-Z0-9_/-]+$/.test(slug) && !slug.split("/").includes("..");
  const categories = new Set((item.categories || []).map((c) => c.path));
  const contentType = { BASE_GAME: "game", DLC: "dlc", BUNDLE: "package", DEMO: "demo", EDITION: "game" }[item.offerType]
    || (categories.has("games/demo") ? "demo" : categories.has("addons") ? "dlc"
      : categories.has("bundles/games") ? "package" : categories.has("games/edition") ? "game" : "unknown");
  return { validSlug, promotion: {
    store: "epic", stableId, region, title: item.title.slice(0, 300),
    url: storeUrl({ stableId, url: validSlug ? `https://store.epicgames.com/en-US/p/${slug}` : "" }),
    promoType: "free-to-keep", sourceId, isLikelyFreeToKeep: true, contentType,
    basePriceFormatted: item.price?.totalPrice?.fmtPrice?.originalPrice || "",
    headerImage: storeAsset(item.keyImages?.find((i) => i.type === "OfferImageWide")?.url
      || item.keyImages?.find((i) => i.type === "Thumbnail")?.url, stableId),
    ...epicTagMetadata(item.tags), reviewTotal: 0,
  } };
}
export function parseEpicFeed(data, region, now = Date.now()) {
  const elements = catalogElements(data);
  const promotions = [], upcoming = [], warnings = [], confirmedEnded = new Set();
  for (const item of elements) {
    const { promotion: base, validSlug } = epicOffer(item, region, EPIC_SOURCE);
    const { stableId } = base;
    const price = item.price?.totalPrice;
    const original = price?.originalPrice, final = price?.discountPrice;
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
  for (const p of promotions) confirmedEnded.delete(p.stableId);
  return { promotions: unique(promotions), upcoming: unique(upcoming), warnings, confirmedEnded,
    complete: warnings.length === 0, coverageLimited: true, catalogCount: elements.length };
}

export function parseEpicCatalog(data, region, now = Date.now()) {
  const elements = catalogElements(data);
  const total = data.data.Catalog.searchStore.paging?.total;
  if (!Number.isSafeInteger(total) || total < elements.length) throw new Error("Invalid Epic catalog paging");
  const promotions = [], warnings = [], confirmedEnded = new Set();
  for (const item of elements) {
    const price = item.price?.totalPrice;
    if (!Number.isSafeInteger(price?.discountPrice) || price.discountPrice < 0
      || !Number.isSafeInteger(price?.originalPrice) || price.originalPrice < 0) {
      warnings.push(`Epic ${item.id}: unknown catalog price`);
      continue;
    }
    if (price.discountPrice !== 0 || price.originalPrice <= 0 || item.isCodeRedemptionOnly || item.prePurchase) continue;
    // Do not count personal vouchers or a permanently free product as a giveaway.
    if (price.discount !== price.originalPrice || price.voucherDiscount > 0) continue;
    try {
      const { promotion, validSlug } = epicOffer(item, region, EPIC_CATALOG_SOURCE);
      if (!validSlug) throw new Error("missing product link");
      const rules = rows(item.price.lineOffers, "price lines").flatMap((line) => rows(line.appliedRules, "discount rules"));
      const deadlines = rules.filter((rule) => rule.discountSetting?.discountType === "PERCENTAGE")
        .map((rule) => Date.parse(rule.endDate));
      if (!deadlines.length || deadlines.some((end) => !Number.isFinite(end))) throw new Error("missing discount deadline");
      // The price is current; appliedRules supplies only an end, not the start of the sale.
      const endsAt = Math.min(...deadlines);
      if (endsAt <= now) { confirmedEnded.add(promotion.stableId); continue; }
      promotions.push({ ...promotion, startsAt: 0, endsAt });
    } catch (error) { warnings.push(`Epic ${item.id}: ${error.message}`); }
  }
  return { promotions: unique(promotions), upcoming: [], warnings, confirmedEnded, total,
    complete: warnings.length === 0, coverageLimited: true, catalogCount: elements.length };
}

export function epicCatalogUrl(region, start = 0) {
  const url = new URL("https://store.epicgames.com/graphql");
  url.searchParams.set("operationName", "searchStoreQuery");
  url.searchParams.set("variables", JSON.stringify({ allowCountries: region, country: region, locale: "en-US",
    category: "games/edition/base|bundles/games|games/edition|addons|games/demo", count: CATALOG_PAGE_SIZE,
    start, onSale: true, priceRange: "[0,0]", effectiveDate: `[,${new Date().toISOString()}]`,
    sortBy: "currentPrice", sortDir: "ASC", withPrice: true }));
  url.searchParams.set("extensions", JSON.stringify({ persistedQuery: { version: 1, sha256Hash: CATALOG_QUERY_HASH } }));
  return url.href;
}

export async function fetchEpicCatalog(region) {
  const result = { promotions: [], upcoming: [], warnings: [], confirmedEnded: new Set(),
    hadSuccess: false, complete: false, coverageLimited: true, catalogCount: 0 };
  const seen = new Set();
  for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
    try {
      const data = await fetchJsonWithTimeout(epicCatalogUrl(region, result.catalogCount), { credentials: "omit" });
      const parsed = parseEpicCatalog(data, region);
      result.hadSuccess = true;
      result.promotions.push(...parsed.promotions);
      result.warnings.push(...parsed.warnings);
      for (const id of parsed.confirmedEnded) result.confirmedEnded.add(id);
      const elements = catalogElements(data);
      if (elements.some((item) => seen.has(`${item.namespace}:${item.id}`))) throw new Error("repeated catalog page");
      for (const item of elements) seen.add(`${item.namespace}:${item.id}`);
      result.catalogCount += elements.length;
      if (result.catalogCount >= parsed.total) {
        result.complete = result.warnings.length === 0;
        break;
      }
      if (!elements.length) throw new Error("empty catalog page before reported total");
      if (page === MAX_CATALOG_PAGES - 1) result.warnings.push("Epic catalog page budget reached");
    } catch (error) { result.warnings.push(`Epic catalog: ${error.message}`); break; }
  }
  result.promotions = unique(result.promotions);
  return result;
}

async function fetchEpicFeed(region) {
  const data = await fetchJsonWithTimeout(
    `https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${region}&allowCountries=${region}`,
    { credentials: "omit" },
  );
  return parseEpicFeed(data, region);
}

export function parseEgdataCatalog(data, region, now = Date.now()) {
  const offers = rows(data?.offers, "EGData offers");
  if (!Number.isSafeInteger(data.total) || data.total < offers.length || data.meta?.timed_out)
    throw new Error("Invalid/incomplete EGData search");
  const elements = [], warnings = [], starts = new Map();
  for (const item of offers) {
    const categories = rows(item.categories, "EGData categories");
    // The mirror also indexes internal test offers and separate iOS/Android SKUs.
    if (!categories.some((path) => ["games/edition", "games/edition/base", "bundles/games", "addons", "games/demo"].includes(path))
      || !item.tags?.some((tag) => ["9547", "10719"].includes(tag.id))) continue;
    if (!(Date.parse(item.effectiveDate) <= now) || (item.viewableDate && !(Date.parse(item.viewableDate) <= now))) continue;
    const blacklist = rows(item.countriesBlacklist ?? [], "country blacklist");
    const whitelist = rows(item.countriesWhitelist ?? [], "country whitelist");
    if (blacklist.includes(region) || (whitelist.length && !whitelist.includes(region))) continue;
    const record = item.price, price = record?.price;
    if (price?.discountPrice !== 0 || !(price.originalPrice > 0)) continue;
    if (record.offerId !== item.id || record.namespace !== item.namespace || !record.region) {
      warnings.push(`EGData ${item.id}: mismatched price record`);
      continue;
    }
    const rules = rows(record.appliedRules, "EGData discount rules").filter((rule) =>
      rule.promotionStatus === "ACTIVE" && rule.discountSetting?.discountType === "PERCENTAGE"
      && rule.discountSetting.discountPercentage === 0 && rule.promotionSetting?.promotionType === "SIMPLE"
      && rule.namespace === item.namespace && rule.regionIds?.includes(record.region)
      && rule.promotionSetting.discountOffers?.some((offer) => offer.offerId === item.id)
      && Date.parse(rule.startDate) <= now && Date.parse(rule.endDate) > now);
    // Old prices and undated discounts must not revive an expired/permanent offer.
    if (!rules.length) continue;
    let formatted = "";
    try {
      if (!/^[A-Z]{3}$/.test(price.currencyCode)) throw new Error("currency");
      const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currencyCode });
      formatted = formatter.format(price.originalPrice / 10 ** formatter.resolvedOptions().maximumFractionDigits);
    } catch { warnings.push(`EGData ${item.id}: invalid currency`); continue; }
    elements.push({ ...item, categories: categories.map((path) => ({ path })),
      price: { totalPrice: { ...price, fmtPrice: { originalPrice: formatted } }, lineOffers: [{ appliedRules: rules }] } });
    starts.set(`epic:${item.namespace}:${item.id}`, Math.max(...rules.map((rule) => Date.parse(rule.startDate))));
  }
  const parsed = parseEpicCatalog({ data: { Catalog: { searchStore: { elements, paging: { total: data.total } } } } }, region, now);
  parsed.promotions = parsed.promotions.map((p) => ({ ...p, sourceId: EGDATA_SOURCE, startsAt: starts.get(p.stableId) }));
  parsed.warnings.push(...warnings);
  parsed.complete &&= warnings.length === 0;
  parsed.catalogCount = offers.length;
  return parsed;
}

export async function fetchEgdataCatalog(region) {
  const result = { promotions: [], upcoming: [], warnings: [], confirmedEnded: new Set(),
    hadSuccess: false, complete: false, coverageLimited: true, catalogCount: 0 };
  const seen = new Set();
  for (let page = 1; page <= MAX_CATALOG_PAGES; page++) {
    try {
      const data = await fetchJsonWithTimeout(`https://api.egdata.app/search/v2/search?country=${region}&locale=en-US`, {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onSale: true, sortBy: "price", sortDir: "asc", page, limit: CATALOG_PAGE_SIZE }),
      });
      const parsed = parseEgdataCatalog(data, region);
      if (data.page !== page || data.limit !== CATALOG_PAGE_SIZE) throw new Error("Invalid EGData page");
      result.hadSuccess = true;
      result.promotions.push(...parsed.promotions);
      result.warnings.push(...parsed.warnings);
      if (data.offers.some((item) => seen.has(`${item.namespace}:${item.id}`))) throw new Error("repeated EGData page");
      for (const item of data.offers) seen.add(`${item.namespace}:${item.id}`);
      result.catalogCount += data.offers.length;
      // Search is sorted by the selected region's final price. Stop after the zero-price segment.
      if (result.catalogCount >= data.total || data.offers.some((item) => item.price?.price?.discountPrice > 0)) {
        result.complete = result.warnings.length === 0;
        break;
      }
      if (!data.offers.length) throw new Error("empty EGData page before reported total");
      if (page === MAX_CATALOG_PAGES) result.warnings.push("EGData catalog page budget reached");
    } catch (error) { result.warnings.push(`EGData catalog: ${error.message}`); break; }
  }
  result.promotions = unique(result.promotions);
  return result;
}

export async function fetchEpicPromotions(settings) {
  const region = settings.region || "US";
  const results = await Promise.allSettled([fetchEpicFeed(region), fetchEpicCatalog(region)]);
  if (results[1].status !== "fulfilled" || !results[1].value.complete)
    results.push(...await Promise.allSettled([fetchEgdataCatalog(region)]));
  const combined = { promotions: [], upcoming: [], warnings: [], confirmedEnded: new Set(),
    sources: [], providerIds: [], hadSuccess: false, complete: true, coverageLimited: true };
  results.forEach((result, i) => {
    const id = [EPIC_SOURCE, EPIC_CATALOG_SOURCE, EGDATA_SOURCE][i];
    const value = result.status === "fulfilled" ? result.value : null;
    const ok = Boolean(value && value.hadSuccess !== false);
    combined.hadSuccess ||= ok;
    const warnings = value?.warnings || [result.reason?.message || "Source unavailable"];
    combined.warnings.push(...warnings);
    combined.sources.push({ id, ok, complete: Boolean(ok && value.complete), coverageLimited: true,
      count: value?.promotions.length || 0, candidateCount: value?.catalogCount || 0,
      upcomingCount: value?.upcoming.length || 0, error: ok ? "" : warnings.join("; ") });
    if (!ok) return;
    combined.providerIds.push(id);
    combined.promotions.push(...value.promotions);
    combined.upcoming.push(...value.upcoming);
    for (const ended of value.confirmedEnded) combined.confirmedEnded.add(ended);
  });
  const successful = (i) => results[i]?.status === "fulfilled" && results[i].value.complete;
  combined.complete = Boolean(successful(0) && (successful(1) || successful(2)));
  // Prefer the weekly feed's explicit start time when the catalog repeats the same offer.
  combined.promotions = unique(combined.promotions.reverse());
  combined.upcoming = unique(combined.upcoming);
  for (const p of combined.promotions) combined.confirmedEnded.delete(p.stableId);
  return combined;
}
