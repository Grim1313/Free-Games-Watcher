import { steamStoreSearchProvider } from "../src/lib/providers/steamStoreSearchProvider.js";
import { fallbackProvider } from "../src/lib/providers/fallbackProvider.js";
import { enrichPromotions } from "../src/lib/providers/enrichmentProvider.js";
import { writeFile, mkdir } from "node:fs/promises";
const region = (process.argv[2] || "US").toUpperCase();
if (!/^[A-Z]{2}$/.test(region)) throw new Error("Expected a two-letter region");
const started = Date.now();
const primary = await steamStoreSearchProvider.fetchPromotions({ region });
const fallback = await fallbackProvider.fetchPromotions({ region });
const unique = [
  ...new Map(
    [...primary.promotions, ...fallback.promotions].map((p) => [p.stableId, p]),
  ).values(),
];
const enriched = await enrichPromotions(unique.slice(0, 3), {}, { region });
const report = {
  checkedAt: new Date().toISOString(),
  region,
  durationMs: Date.now() - started,
  primary: {
    complete: primary.complete,
    coverageLimited: primary.coverageLimited,
    pages: primary.pages,
    count: primary.promotions.length,
    warnings: primary.warnings,
  },
  fallbackCount: fallback.promotions.length,
  uniqueCount: unique.length,
  samples: enriched.promotions.map((p) => ({
    stableId: p.stableId,
    title: p.title,
    endsAt: p.endsAt,
    contentType: p.contentType,
    genres: p.genres,
    platforms: p.platforms,
    reviewTotal: p.reviewTotal,
  })),
  warnings: enriched.warnings,
};
await mkdir("dist", { recursive: true });
await writeFile(
  `dist/live-check-${region}.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
