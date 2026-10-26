import { fetchSteamPromotions } from "./steamProvider.js";
import { fetchEpicPromotions, EPIC_SOURCE } from "./epicProvider.js";
import { fetchGogPromotions, GOG_SOURCE } from "./gogProvider.js";
import { enabledStores, storeOf } from "../stores.js";
import { getMetadataCache } from "./enrichmentProvider.js";
export { verifyMissingPromotions } from "./steamProvider.js";

const PROVIDERS = { steam: fetchSteamPromotions, epic: fetchEpicPromotions, gog: fetchGogPromotions };
const IDS = { steam: "steam-store-search", epic: EPIC_SOURCE, gog: GOG_SOURCE };
export async function fetchPromotionsFromProviders(settings, knownEntries = []) {
  const stores = enabledStores(settings);
  const results = await Promise.allSettled(stores.map((store) => PROVIDERS[store](
    settings, knownEntries.filter((entry) => storeOf(entry) === store),
  )));
  const combined = { promotions: [], upcoming: [], warnings: [], sources: [], providerIds: [],
    confirmedEnded: new Set(), storeResults: {}, metadataCache: await getMetadataCache(),
    hadSuccess: stores.length === 0, complete: true };
  results.forEach((result, i) => {
    const store = stores[i], now = Date.now();
    const value = result.status === "fulfilled" ? result.value : null;
    const ok = Boolean(value && value.hadSuccess !== false);
    const complete = ok && value.complete;
    const error = ok ? "" : result.reason?.message || value?.warnings?.join("; ") || "Source unavailable";
    combined.storeResults[store] = { ok, complete, checkedAt: now, error };
    combined.hadSuccess ||= ok;
    combined.complete &&= Boolean(complete);
    if (!ok) {
      combined.warnings.push(`${store}: ${error}`);
      combined.sources.push({ store, id: IDS[store], ok: false, complete: false, checkedAt: now, error });
      return;
    }
    combined.promotions.push(...value.promotions.map((p) => ({ ...p, store })));
    combined.upcoming.push(...(value.upcoming || []).map((p) => ({ ...p, store })));
    combined.warnings.push(...value.warnings);
    for (const id of value.confirmedEnded || []) combined.confirmedEnded.add(id);
    if (value.metadataCache) combined.metadataCache = value.metadataCache;
    combined.providerIds.push(...(value.providerIds || [IDS[store]]));
    combined.sources.push(...(value.sources || [{ id: IDS[store], ok: true, complete,
      coverageLimited: value.coverageLimited, count: value.promotions.length,
      upcomingCount: value.upcoming?.length || 0, candidateCount: value.candidateCount,
      sectionSchemaLiveVerified: value.sectionSchemaLiveVerified }]).map((s) => ({ ...s, store, checkedAt: now })));
  });
  return combined;
}
