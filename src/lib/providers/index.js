import { enrichPromotions, getMetadataCache } from "./enrichmentProvider.js";
import { fallbackProvider } from "./fallbackProvider.js";
import { steamStoreSearchProvider } from "./steamStoreSearchProvider.js";
import { fetchJsonWithTimeout, chunkArray } from "../utils.js";

// Search absence is not proof of expiry: verify the actual purchase options.
export async function verifyMissingPromotions(entries, settings) {
  const confirmedEnded = new Set(),
    recovered = [],
    warnings = [];
  for (const batch of chunkArray(entries.slice(0, 100), 50)) {
    const input = {
      ids: batch.map((e) =>
        e.appId ? { appid: e.appId } : { packageid: e.packageId },
      ),
      context: { country_code: settings.region || "US", language: "english" },
      data_request: { include_purchase_options: true },
    };
    try {
      const data = await fetchJsonWithTimeout(
        `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`,
        { credentials: "omit" },
      );
      if (!Array.isArray(data?.response?.store_items))
        throw new Error("Invalid purchase options response");
      for (const entry of batch) {
        const item = data.response.store_items.find((v) =>
          entry.appId
            ? Number(v.appid || (v.item_type === 0 ? v.id : 0)) === entry.appId
            : v.item_type === 1 && Number(v.id) === entry.packageId,
        );
        if (!item) continue;
        const options = [
          item.best_purchase_option,
          ...(item.purchase_options || []),
        ].filter(Boolean);
        const offer = options.find((v) => v.is_free_to_keep);
        if (offer)
          recovered.push({
            ...entry,
            endsAt: Number(offer.free_to_keep_ends || 0) * 1000,
          });
        else if (options.some((v) => Number(v.final_price_in_cents) > 0))
          confirmedEnded.add(entry.stableId);
      }
    } catch (error) {
      warnings.push(`Purchase verification: ${error.message}`);
    }
  }
  return { confirmedEnded, recovered, warnings };
}
export async function fetchPromotionsFromProviders(
  settings,
  knownEntries = [],
) {
  const warnings = [],
    providerIds = [],
    promotions = [],
    sources = [];
  let hadSuccess = false,
    complete = false;
  try {
    const primary = await steamStoreSearchProvider.fetchPromotions(settings);
    promotions.push(...primary.promotions);
    warnings.push(...primary.warnings);
    providerIds.push(steamStoreSearchProvider.id);
    sources.push({
      id: steamStoreSearchProvider.id,
      ok: true,
      complete: primary.complete,
      pages: primary.pages,
      coverageLimited: primary.coverageLimited,
      count: primary.promotions.length,
    });
    hadSuccess = true;
    complete = primary.complete;
  } catch (error) {
    warnings.push(`Search: ${error.message}`);
    sources.push({
      id: steamStoreSearchProvider.id,
      ok: false,
      error: error.message,
    });
  }
  if (!complete || !promotions.length) {
    try {
      const fallback = await fallbackProvider.fetchPromotions(settings);
      promotions.push(...fallback.promotions);
      providerIds.push(fallbackProvider.id);
      hadSuccess = true;
      sources.push({
        id: fallbackProvider.id,
        ok: true,
        complete: false,
        count: fallback.promotions.length,
      });
    } catch (error) {
      warnings.push(`Featured: ${error.message}`);
      sources.push({
        id: fallbackProvider.id,
        ok: false,
        error: error.message,
      });
    }
  }
  const seen = new Set(promotions.map((p) => p.stableId));
  const missing = knownEntries.filter(
    (e) =>
      e.status === "active" &&
      (e.region || "US") === settings.region &&
      !seen.has(e.stableId),
  );
  const verification = missing.length
    ? await verifyMissingPromotions(missing, settings)
    : { confirmedEnded: new Set(), recovered: [], warnings: [] };
  promotions.push(...verification.recovered);
  warnings.push(...verification.warnings);
  const unique = new Map();
  for (const p of promotions)
    if (!unique.has(p.stableId)) unique.set(p.stableId, p);
  const enriched = await enrichPromotions(
    [...unique.values()],
    await getMetadataCache(),
    settings,
  );
  return {
    ...enriched,
    warnings: [...warnings, ...enriched.warnings],
    providerIds,
    sources,
    hadSuccess,
    complete,
    confirmedEnded: verification.confirmedEnded,
  };
}
