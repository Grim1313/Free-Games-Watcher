export const STORE_IDS = Object.freeze(["steam", "epic", "gog"]);
export const STORE_NAMES = Object.freeze({ steam: "Steam", epic: "Epic Games Store", gog: "GOG" });
const HOMES = { steam: "https://store.steampowered.com/", epic: "https://store.epicgames.com/", gog: "https://www.gog.com/" };
const ASSETS = {
  steam: ["steamstatic.com", "store.steampowered.com"],
  epic: ["epicgames.com", "unrealengine.com"],
  gog: ["gog-statics.com", "images.gog.com"],
};
// Legacy Steam IDs intentionally stay unchanged, including campaign/delivery keys.
export function storeOf(entry) {
  const id = typeof entry === "string" ? entry : entry?.stableId || "";
  return id.startsWith("epic:") ? "epic" : id.startsWith("gog:") ? "gog" : "steam";
}
export function validStableId(id) {
  return typeof id === "string" && (/^(app|sub):[1-9]\d*$/.test(id)
    || /^gog:[1-9]\d*$/.test(id)
    || /^epic:[a-zA-Z0-9_-]{1,100}:[a-zA-Z0-9_-]{1,100}$/.test(id));
}
export function enabledStores(settings) {
  return Array.isArray(settings?.enabledStores)
    ? STORE_IDS.filter((s) => settings.enabledStores.includes(s)) : ["steam"];
}
export function scanKey(settings) {
  return `${settings.region}|${settings.trackFreeToKeep}|${enabledStores(settings).join(",")}`;
}
export function storeHome(entry) { return HOMES[storeOf(entry)]; }
export function storeUrl(entry) {
  const source = typeof entry === "string" ? { stableId: entry } : entry || {};
  const store = storeOf(source);
  try {
    const url = new URL(source.url);
    if (url.protocol === "https:" && !url.username && !url.password
      && url.hostname === new URL(HOMES[store]).hostname) return url.href;
  } catch { /* Use a safe store-specific fallback. */ }
  const steam = /^(app|sub):(\d+)$/.exec(source.stableId || "");
  return steam ? `${HOMES.steam}${steam[1]}/${steam[2]}/` : HOMES[store];
}
export function safeStoreUrl(value) {
  for (const store of STORE_IDS) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password
        && url.hostname === new URL(HOMES[store]).hostname) return url.href;
    } catch { return ""; }
  }
  return "";
}
export function storeAsset(value, entry) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && ASSETS[storeOf(entry)].some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
      ? url.href : "";
  } catch { return ""; }
}
