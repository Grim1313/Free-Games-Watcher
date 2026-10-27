import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { epicTagMetadata } from "../src/lib/providers/epicTags.js";
import { parseEpicFeed, parseEpicCatalog, parseEgdataCatalog } from "../src/lib/providers/epicProvider.js";
import { applyPromotionFilters } from "../src/lib/filters.js";
import { sanitizeSettings } from "../src/lib/settings.js";
import { epicFeed } from "./multistore-fixtures.mjs";

const mafia = JSON.parse(await readFile(new URL("./fixtures/egdata-mafia-hotel.json", import.meta.url), "utf8"));
const catalogMafia = JSON.parse(await readFile(new URL("./fixtures/epic-mafia-hotel.json", import.meta.url), "utf8"));
const now = Date.parse("2026-10-27T12:00:00Z");

test("Epic tags distinguish genres/platforms from features, events and unrecognized values", () => {
  const metadata = epicTagMetadata([
    { id: "1216" }, { id: "1216" }, { id: "9547" }, { id: "10719" }, { id: "10719" },
    { id: "29088" }, { id: "19847" }, { id: "1370" }, { id: "39070" }, { id: "39071" },
    { id: "unknown", name: "Linux" }, { id: "toString" }, null, {}, "1218", { id: [] },
  ]);
  assert.deepEqual(metadata, { genres: ["Action"], platforms: ["windows", "mac"] });
  for (const tags of [undefined, null, {}, "1216", []])
    assert.deepEqual(epicTagMetadata(tags), { genres: [], platforms: [] });
});

test("weekly Epic metadata matches Sker Ritual and Home product pages", () => {
  const feed = epicFeed(now);
  const [current, upcoming] = feed.data.Catalog.searchStore.elements;
  // IDs observed in the public weekly feed on 27 October 2026.
  current.tags = ["1216", "29088", "1218", "19847", "1210", "1370", "9547"].map((id) => ({ id }));
  upcoming.tags = ["1218", "19847", "1370", "9547", "1117", "9549", "1263"].map((id) => ({ id }));
  const result = parseEpicFeed(feed, "US", now);
  assert.deepEqual(result.promotions[0].genres, ["Action", "Horror", "Shooter"]);
  assert.deepEqual(result.upcoming[0].genres, ["Horror", "Adventure", "Indie"]);
  assert.deepEqual(result.promotions[0].platforms, ["windows"]);
  assert.deepEqual(result.upcoming[0].platforms, ["windows"]);
});

test("Mafia Hotel catalog and EGData tags enable matching genre/platform filters", () => {
  const mirror = parseEgdataCatalog({ offers: [mafia], total: 1 }, "US", now).promotions[0];
  // Apply the real offer's tag IDs in Epic's id-only catalog schema.
  const item = { ...catalogMafia, tags: mafia.tags.map(({ id }) => ({ id })) };
  const direct = parseEpicCatalog({ data: { Catalog: { searchStore: {
    elements: [item], paging: { total: 1 },
  } } } }, "US", now).promotions[0];
  for (const offer of [mirror, direct]) {
    assert.deepEqual([...offer.genres].sort(), ["Action", "Casual", "Comedy"]);
    assert.deepEqual(offer.platforms, ["windows"]);
    for (const [genres, platforms, expected] of [
      [["action"], ["windows"], true], [["comedy"], [], true],
      [["rpg"], ["windows"], false], [[], ["linux"], false], [[], ["mac"], false],
    ]) {
      const settings = sanitizeSettings({ enabledStores: ["epic"], filters: { genres, platforms } });
      assert.equal(applyPromotionFilters([offer], settings).accepted.length, expected ? 1 : 0);
    }
  }
});
