import { PROMO_TYPES, SOURCE_IDS } from "../constants.js";
import {
  buildSteamUrlFromStableId,
  createHash,
  decodeHtmlEntities,
  fetchJsonWithTimeout,
  normalizeWhitespace,
  stripHtml,
} from "../utils.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 6;
function buildSearchUrl(start, region, specials) {
  return `https://store.steampowered.com/search/results/?query&start=${start}&count=${PAGE_SIZE}&dynamic_data=&sort_by=${specials ? "_ASC" : "Price_ASC"}&maxprice=free&${specials ? "specials=1" : "category1=998"}&cc=${region.toLowerCase()}&l=english&ndl=1&infinite=1`;
}
export function validateSearchResponse(data) {
  if (
    !data ||
    typeof data.results_html !== "string" ||
    !(
      typeof data.total_count === "number" ||
      (typeof data.total_count === "string" && /^\d+$/.test(data.total_count))
    ) ||
    !Number.isFinite(Number(data.total_count)) ||
    Number(data.total_count) < 0 ||
    (data.success !== undefined && data.success !== true && data.success !== 1)
  )
    throw new Error("Invalid Steam search response");
  if (
    Number(data.total_count) > 0 &&
    !/search_result_row/.test(data.results_html)
  )
    throw new Error("Steam search markup not recognized");
  return data;
}
async function fetchSearch(region, specials) {
  const promotions = [];
  const warnings = [];
  let complete = true,
    coverageLimited = false;
  let pages = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let data;
    try {
      data = validateSearchResponse(
        await fetchJsonWithTimeout(
          buildSearchUrl(page * PAGE_SIZE, region, specials),
          { credentials: "omit" },
        ),
      );
    } catch (error) {
      if (!pages) throw error;
      warnings.push(String(error.message));
      complete = false;
      break;
    }
    pages++;
    promotions.push(
      ...parseSearchRows(data.results_html, {
        allowFreeLabel: specials,
        rawTypeLabel: specials ? "Store special" : "Store free price",
      }),
    );
    if ((page + 1) * PAGE_SIZE >= Number(data.total_count)) break;
    if (page === MAX_PAGES - 1) {
      coverageLimited = true;
      warnings.push(
        "Search page budget reached; discovery coverage is limited.",
      );
    }
  }
  return { promotions, warnings, complete, coverageLimited, pages };
}

function getOriginalPriceText(row) {
  const originalPriceMatch =
    /class="discount_original_price[^"]*">([\s\S]*?)<\/div>/i.exec(row);
  return normalizeWhitespace(
    stripHtml(originalPriceMatch ? originalPriceMatch[1] : ""),
  );
}

function isDiscountedToZero(priceText, row) {
  const finalPriceMatch = /data-price-final="(\d+)"/i.exec(row);
  const discountMatch = /data-discount="(\d+)"/i.exec(row);
  const originalPriceText = getOriginalPriceText(row);
  const normalizedFinalPrice = priceText.replace(/[^\d.,]/g, "");
  const normalizedOriginalPrice = originalPriceText.replace(/[^\d.,]/g, "");
  const hasZeroFinalPrice =
    (finalPriceMatch ? Number(finalPriceMatch[1]) : NaN) === 0 ||
    /^0(?:[.,]00)?$/.test(normalizedFinalPrice);
  const hasDiscountedOriginalPrice =
    Boolean(normalizedOriginalPrice) &&
    !/^0(?:[.,]00)?$/.test(normalizedOriginalPrice);
  const hasFullDiscount = (discountMatch ? Number(discountMatch[1]) : 0) >= 100;

  return hasZeroFinalPrice && (hasDiscountedOriginalPrice || hasFullDiscount);
}

function parseDiscountExpiration(row) {
  const match =
    /(?:data-discount[_-](?:end[_-]date|expiration)|discount_expiration)="?(\d{10,13})"?/i.exec(
      row,
    );
  const value = match ? Number(match[1]) : 0;
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value > 1_000_000_000_000 ? value : value * 1000;
}

export function parseSearchRows(html, options = {}) {
  const allowFreeLabel = options.allowFreeLabel !== false;
  const rawTypeLabel = options.rawTypeLabel || "Store special";
  const rows =
    String(html || "").match(
      /<a\b[\s\S]*?class="[^"]*search_result_row[^"]*"[\s\S]*?<\/a>/gi,
    ) || [];
  const promotions = [];

  for (const row of rows) {
    const hrefMatch = /href="([^"]+)"/i.exec(row);
    const titleMatch = /class="title">([\s\S]*?)<\/span>/i.exec(row);
    const priceMatch =
      /class="(?:discount_final_price|search_price)[^"]*">([\s\S]*?)<\/div>/i.exec(
        row,
      );
    const href = hrefMatch ? decodeHtmlEntities(hrefMatch[1]) : "";
    const title = titleMatch
      ? normalizeWhitespace(decodeHtmlEntities(stripHtml(titleMatch[1])))
      : "";
    const priceText = normalizeWhitespace(
      stripHtml(priceMatch ? priceMatch[1] : ""),
    );
    const isFreeLabel = /\bfree\b/i.test(priceText);
    const discountedToZero = isDiscountedToZero(priceText, row);

    if (
      !href ||
      !title ||
      (!discountedToZero && (!allowFreeLabel || !isFreeLabel))
    ) {
      continue;
    }

    const stableIdMatch = /\/(app|sub)\/(\d+)\//i.exec(href);
    if (!stableIdMatch) {
      continue;
    }

    const stableId = `${stableIdMatch[1].toLowerCase()}:${stableIdMatch[2]}`;
    const appId = stableId.startsWith("app:") ? Number(stableIdMatch[2]) : 0;
    const packageId = stableId.startsWith("sub:")
      ? Number(stableIdMatch[2])
      : 0;
    const rowText = stripHtml(row);

    promotions.push({
      stableId,
      appId,
      packageId,
      title,
      url: buildSteamUrlFromStableId(stableId),
      promoType: PROMO_TYPES.FREE_TO_KEEP,
      rawTypeLabel,
      sourceId: SOURCE_IDS.STORE_SEARCH,
      sourceFingerprint: createHash(row),
      basePriceFormatted: getOriginalPriceText(row),
      endsAt: parseDiscountExpiration(row),
      rowText,
    });
  }

  return promotions;
}

export const steamStoreSearchProvider = {
  id: SOURCE_IDS.STORE_SEARCH,
  async fetchPromotions(settings = {}) {
    const results = await Promise.allSettled([
      fetchSearch(settings.region || "US", true),
      fetchSearch(settings.region || "US", false),
    ]);
    const good = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);
    const warnings = results
      .filter((r) => r.status === "rejected")
      .map((r) => String(r.reason?.message || r.reason));
    if (!good.length) throw new Error(warnings.join("; "));
    return {
      promotions: good.flatMap((r) => r.promotions),
      warnings: [...warnings, ...good.flatMap((r) => r.warnings)],
      success: true,
      coverageLimited: good.some((r) => r.coverageLimited),
      complete: good.length === 2 && good.every((r) => r.complete),
      pages: good.reduce((n, r) => n + r.pages, 0),
    };
  },
};
