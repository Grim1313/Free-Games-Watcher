// Research tooling only. Not imported by the released extension.
import { parseSearchRows, validateSearchResponse } from "../../src/lib/providers/steamStoreSearchProvider.js";

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected an array`);
  return value;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function httpsUrl(value, allowed) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      ? url.href : null;
  } catch { return null; }
}

export function extractEpic(data, region, now = Date.now()) {
  if (data.errors?.length) throw new Error("Epic returned API errors");
  const items = requireArray(data?.data?.Catalog?.searchStore?.elements, "Epic catalog");
  const current = [], upcoming = [], rejected = [], warnings = [];
  for (const item of items) {
    if (!item.id || !item.namespace || !item.title) throw new Error("Epic item missing identity/title");
    const price = item.price?.totalPrice;
    const original = finiteNumber(price?.originalPrice);
    const final = finiteNumber(price?.discountPrice);
    const slug = item.catalogNs?.mappings?.find((v) => v.pageType === "productHome")?.pageSlug
      || item.offerMappings?.find((v) => v.pageType === "productHome")?.pageSlug
      || item.productSlug || item.urlSlug;
    const url = typeof slug === "string" && /^[a-zA-Z0-9_/-]+$/.test(slug) && !slug.split("/").includes("..")
      ? `https://store.epicgames.com/en-US/p/${slug}` : null;
    const base = {
      store: "epic", region, productId: `${item.namespace}:${item.id}`,
      title: item.title, url, contentType: item.offerType || "unknown",
      originalPrice: original, currentPrice: final, currency: price?.currencyCode || null,
      priceDecimals: price?.currencyInfo?.decimals ?? null,
      image: httpsUrl(item.keyImages?.find((v) => v.type === "OfferImageWide")?.url
        || item.keyImages?.find((v) => v.type === "Thumbnail")?.url, ["epicgames.com", "unrealengine.com"]),
      rating: null, genres: null, platforms: null,
    };
    if (!url) warnings.push(`${item.id}: product URL unavailable`);
    let accepted = false;
    for (const kind of ["promotionalOffers", "upcomingPromotionalOffers"]) {
      const groups = item.promotions?.[kind] ?? [];
      for (const group of requireArray(groups, `Epic ${kind}`)) {
        for (const offer of requireArray(group.promotionalOffers, "Epic promotion windows")) {
          const starts = Date.parse(offer.startDate), ends = Date.parse(offer.endDate);
          if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts)
            throw new Error(`Epic invalid promotion dates for ${item.id}`);
          // Observed API semantics: zero is the remaining price percentage, not 100% off.
          if (offer.discountSetting?.discountType !== "PERCENTAGE"
            || offer.discountSetting.discountPercentage !== 0 || !(original > 0)) continue;
          const entry = { ...base, startsAt: offer.startDate, endsAt: offer.endDate };
          if (starts <= now && now < ends && kind === "promotionalOffers") {
            if (final === 0) { current.push(entry); accepted = true; }
            else warnings.push(`${item.id}: active free window conflicts with current price`);
          } else if (starts > now && kind === "upcomingPromotionalOffers") {
            upcoming.push(entry); accepted = true;
          }
        }
      }
    }
    if (!accepted) rejected.push({ title: item.title, reason: "No confirmed current/upcoming paid-to-free window" });
  }
  return { catalogItems: items.length, current, upcoming, rejected, warnings,
    coverage: "Epic promotion feed only; not the entire store. Regional listing is not proof of claimability." };
}

export function extractGogCatalog(data, region) {
  const products = requireArray(data?.products, "GOG catalog");
  if (!Number.isInteger(data.productCount) || data.productCount < 0) throw new Error("Invalid GOG productCount");
  const items = products.map((p) => {
    if (!p.id || !p.title) throw new Error("GOG item missing identity/title");
    const original = finiteNumber(p.price?.baseMoney?.amount), final = finiteNumber(p.price?.finalMoney?.amount);
    return {
      store: "gog", region, productId: String(p.id), title: p.title,
      url: httpsUrl(p.storeLink, ["gog.com"]),
      image: httpsUrl(p.coverHorizontal, ["gog-statics.com", "gog.com"]),
      contentType: p.productType || "unknown",
      demoTag: (p.tags || []).some((t) => t.slug === "demo"),
      originalPrice: original, currentPrice: final,
      currency: p.price?.finalMoney?.currency || null,
      platforms: p.operatingSystems || [], genres: (p.genres || []).map((g) => g.name),
      ratingRaw: p.reviewsRating ?? null, reviewCount: p.reviewsCount ?? null,
      startsAt: null, endsAt: null,
      classification: final === null || original === null ? "unknown-price"
        : final > 0 ? "paid" : original > 0 ? "zero-price-discount-needs-terms"
          : "zero-base-price-not-confirmed-giveaway",
    };
  });
  return { total: data.productCount, returned: items.length, reportedPages: data.pages,
    coverageLimited: items.length < data.productCount, items,
    warnings: ["Catalog prices alone do not establish a timed free-to-keep giveaway or its deadline.",
      "productType=game may include demos; review scale has not been normalized."] };
}

export function extractGogSections(data) {
  const sections = requireArray(data?.sections, "GOG sections");
  if (!data.config?.pageId) throw new Error("Invalid GOG page config");
  return {
    sectionCount: sections.length,
    giveawaySections: sections.filter((s) => /giveaway/i.test(s.sectionType || "")),
    sectionTypes: [...new Set(sections.map((s) => s.sectionType))],
    coverage: "Homepage section configuration only; no giveaway section does not prove store-wide absence.",
  };
}

export function buildPlan(regions = ["US", "RU"]) {
  if (!regions.length || regions.some((r) => !/^[A-Z]{2}$/.test(r))) throw new Error("Expected two-letter uppercase regions");
  const plan = [];
  for (const region of [...new Set(regions)]) {
    const gog = `countryCode=${region}&locale=en-US&currencyCode=USD`;
    plan.push(
      { id: `steam-search-${region}`, kind: "steam-search", region,
        url: `https://store.steampowered.com/search/results/?query&start=0&count=100&dynamic_data=&sort_by=_ASC&maxprice=free&specials=1&cc=${region.toLowerCase()}&l=english&ndl=1&infinite=1` },
      { id: `epic-${region}`, kind: "epic", region,
        url: `https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${region}&allowCountries=${region}` },
      { id: `gog-sections-${region}`, kind: "gog-sections", region,
        url: `https://sections.gog.com/v1/pages/2f?${gog}` },
      { id: `gog-discounted-free-${region}`, kind: "gog-catalog", region,
        url: `https://catalog.gog.com/v1/catalog?limit=48&page=1&order=desc:trending&price=between:0,0&discounted=eq:true&${gog}` },
    );
  }
  plan.push(
    { id: "gog-free-sample-US", kind: "gog-catalog", region: "US",
      url: "https://catalog.gog.com/v1/catalog?limit=5&page=1&order=desc:trending&price=between:0,0&countryCode=US&locale=en-US&currencyCode=USD" },
    { id: "gog-account-status", kind: "account-status", url: "https://www.gog.com/giveaway/status", expectedStatus: 401 },
  );
  return plan;
}

export async function probeSource(spec, now = Date.now()) {
  const started = Date.now();
  const result = { ...spec, checkedAt: new Date(now).toISOString(), credentials: "omit" };
  let raw = "";
  try {
    const response = await fetch(spec.url, { credentials: "omit", signal: AbortSignal.timeout(25000), redirect: "error" });
    raw = await response.text();
    Object.assign(result, { status: response.status, bytes: new TextEncoder().encode(raw).length,
      contentType: response.headers.get("content-type"), serverDate: response.headers.get("date") });
    if (response.status === spec.expectedStatus) {
      result.outcome = "expected-auth-required";
      result.note = "Account-specific endpoint; excluded from anonymous discovery.";
    } else if (!response.ok) {
      result.outcome = "http-error";
    } else {
      const data = JSON.parse(raw);
      if (spec.kind === "epic") result.extracted = extractEpic(data, spec.region, now);
      else if (spec.kind === "gog-catalog") result.extracted = extractGogCatalog(data, spec.region);
      else if (spec.kind === "gog-sections") result.extracted = extractGogSections(data);
      else if (spec.kind === "steam-search") {
        validateSearchResponse(data);
        result.extracted = { total: Number(data.total_count), pagesFetched: 1,
          coverageLimited: Number(data.total_count) > 100,
          candidates: parseSearchRows(data.results_html),
          note: "Search candidates require metadata/purchase verification; run check-live.mjs for the existing full provider." };
      } else throw new Error("Unexpected response from account-specific endpoint");
      result.outcome = "ok";
    }
  } catch (error) {
    result.outcome = result.status ? "parse-or-validation-error" : "network-error";
    result.error = { message: error.message, cause: error.cause?.message || null, code: error.cause?.code || null };
  }
  result.durationMs = Date.now() - started;
  return { result, raw };
}
