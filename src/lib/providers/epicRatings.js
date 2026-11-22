import { fetchJsonWithTimeout, fetchTextWithTimeout, sanitizeEpicRating, stripHtml } from "../utils.js";

const DAY = 24 * 60 * 60 * 1000;
const MAX_LOOKUPS = 6;

async function fetchPlayerRating(offer) {
  // Use the English product page linked by discovery. Critic reviews have a separate section.
  try {
    const html = await fetchTextWithTimeout(offer.url, { credentials: "omit" }, 4000);
    const match = /Epic Player Ratings Captured from players in the Epic Games ecosystem\. (\d+(?:\.\d+)?)(?= |$)/.exec(stripHtml(html));
    const rating = sanitizeEpicRating(Number(match?.[1]));
    if (rating) return rating;
  } catch { /* The storefront can require a browser challenge. */ }

  const [, namespace, offerId] = offer.stableId.split(":");
  const polls = await fetchJsonWithTimeout(`https://api.egdata.app/offers/${offerId}/polls`, { credentials: "omit" }, 4000);
  if (polls?._id !== namespace) throw new Error("Unmatched Epic player polls");
  // pollResult[].total counts answers to individual questions, not star ratings.
  return sanitizeEpicRating(polls.averageRating);
}

export async function enrichEpicRatings(offers, knownEntries) {
  const now = Date.now();
  const known = new Map();
  for (const entry of knownEntries) {
    if ((entry.epicRatingCheckedAt || 0) >= (known.get(entry.stableId)?.epicRatingCheckedAt || 0))
      known.set(entry.stableId, entry);
  }
  const pending = [];
  const games = new Map();
  for (const offer of offers) {
    if (offer.contentType !== "game") continue; // DLC can share its base game's namespace and page.
    if (!games.has(offer.stableId)) games.set(offer.stableId, []);
    games.get(offer.stableId).push(offer);
  }
  for (const [stableId, entries] of games) {
    const cached = known.get(stableId);
    const rating = sanitizeEpicRating(cached?.epicRating);
    const checkedAt = cached?.epicRatingCheckedAt || 0;
    for (const entry of entries) Object.assign(entry, { epicRating: rating, epicRatingCheckedAt: checkedAt });
    if (checkedAt > now || now - checkedAt >= (rating ? DAY : DAY / 8)) pending.push(entries);
  }
  // Oldest first so large catalog scans can fill the remaining ratings on later checks.
  pending.sort((a, b) => a[0].epicRatingCheckedAt - b[0].epicRatingCheckedAt);
  await Promise.all(pending.slice(0, MAX_LOOKUPS).map(async entries => {
    const rating = await fetchPlayerRating(entries[0]).catch(() => 0) || entries[0].epicRating;
    for (const entry of entries) Object.assign(entry, { epicRating: rating, epicRatingCheckedAt: now });
  }));
}
