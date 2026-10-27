import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { environment, response, row } from "./helpers.mjs";
import { gogPage } from "./multistore-fixtures.mjs";
import { runPromotionCheck, visibleEntries } from "../src/lib/promotions.js";
import { sanitizeSettings } from "../src/lib/settings.js";

// Real Steam/GOG metadata from 27 October 2026, with simulated giveaway terms.
// No live giveaway is implied by these test records.
const fixture = JSON.parse(await readFile(new URL("./fixtures/steam-gog-filter-metadata.json", import.meta.url), "utf8"));
const ids = ["app:620", "app:292030", "gog:1453375253", "gog:1640424747"];
function sources(calls) {
  return async (url) => {
    calls.push(url);
    const endsAt = Date.now() + 86400000;
    if (url.includes("/search/results/")) return response({ total_count: 2,
      results_html: fixture.steam.map(({ id, data }) => row(id, data.name)).join("") });
    if (url.includes("/api/appdetails")) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("l"), "english");
      assert.ok(parsed.searchParams.get("filters").includes("genres"));
      assert.ok(parsed.searchParams.get("filters").includes("platforms"));
      const { id, data } = fixture.steam.find((p) => String(p.id) === parsed.searchParams.get("appids"));
      return response({ [id]: { success: true, data } });
    }
    if (url.includes("/appreviews/")) return response({ success: 1,
      query_summary: { total_reviews: 100, total_positive: 90, total_negative: 10 } });
    if (url.includes("IStoreBrowseService")) return response({ response: { store_items: fixture.steam.map(({ id }) => ({
      appid: id, best_purchase_option: { is_free_to_keep: true, free_to_keep_ends: Math.floor(endsAt / 1000) },
    })) } });
    if (url.includes("featuredcategories")) return response({ specials: { items: [] } });
    if (url.includes("/app/")) return response("<html>No date</html>");
    if (url.includes("catalog.gog.com")) return response({ productCount: 0, products: [] });
    if (url.includes("sections.gog.com")) {
      if (url.includes("/sections/")) {
        const product = fixture.gog.find((p) => new URL(url).pathname.endsWith(p.id));
        return response({ properties: { product, endDate: new Date(endsAt).toISOString() } });
      }
      const page = gogPage();
      page.sections = fixture.gog.map((p) => ({ ...page.sections[0], sectionId: p.id }));
      return response(page);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}
const settings = (filters = {}) => sanitizeSettings({ enabledStores: ["steam", "gog"], filters });
const sortedIds = (entries) => entries.map((p) => p.stableId).sort();

test("real Steam/GOG metadata survives discovery, storage, cache and combined filters", async (t) => {
  const env = environment(t, { settings: settings() }), calls = [];
  globalThis.fetch = sources(calls);
  assert.equal((await runPromotionCheck()).ok, true);
  assert.equal(env.data.latestPromotions.length, 4);
  const entries = env.data.latestPromotions;
  assert.deepEqual(entries.find((p) => p.stableId === ids[0]).platforms.sort(), ["linux", "windows"]);
  assert.deepEqual(entries.find((p) => p.stableId === ids[2]).platforms.sort(), ["linux", "mac", "windows"]);
  assert.deepEqual(entries.find((p) => p.stableId === ids[1]).platforms, ["windows"]);
  assert.deepEqual(entries.find((p) => p.stableId === ids[3]).platforms, ["windows"]);
  const cases = [
    [{}, ids],
    [{ genres: ["Action"] }, [ids[0]]],
    [{ genres: ["RPG"] }, [ids[1], ids[2], ids[3]]],
    [{ genres: [" Role-playing "] }, [ids[1], ids[2], ids[3]]],
    [{ genres: ["Simulation"] }, [ids[2]]],
    [{ genres: ["Adventure", "Simulation"] }, [ids[0], ids[2], ids[3]]],
    [{ genres: ["Puzzle"] }, []], // Steam user tags are distinct from official genres.
    [{ platforms: ["windows"] }, ids],
    [{ platforms: ["mac"] }, [ids[2]]],
    [{ platforms: ["linux"] }, [ids[0], ids[2]]],
    [{ platforms: ["mac", "windows"] }, ids],
    [{ genres: ["RPG"], platforms: ["mac"] }, [ids[2]]],
    [{ genres: ["Action"], platforms: ["linux"] }, [ids[0]]],
    [{ genres: ["Strategy"], platforms: ["windows"] }, []],
  ];
  for (const [filters, expected] of cases)
    assert.deepEqual(sortedIds(visibleEntries(entries, settings(filters), {})), [...expected].sort(), JSON.stringify(filters));
  const unknown = entries.map((p) => ({ ...p, genres: [], platforms: [] }));
  assert.equal(visibleEntries(unknown, settings(), {}).length, 4);
  assert.equal(visibleEntries(unknown, settings({ genres: ["Action"] }), {}).length, 0);
  assert.equal(visibleEntries(unknown, settings({ platforms: ["windows"] }), {}).length, 0);
  const before = calls.filter((url) => url.includes("/api/appdetails")).length;
  await runPromotionCheck();
  assert.equal(calls.filter((url) => url.includes("/api/appdetails")).length, before);
  assert.deepEqual(sortedIds(visibleEntries(env.data.latestPromotions, settings({ genres: ["RPG"], platforms: ["linux"] }), {})), [ids[2]]);
});

test("genre/platform filters gate notifications and counts for Steam and GOG", async (t) => {
  for (const [filters, expected] of [
    [{ genres: ["RPG"], platforms: ["mac"] }, [ids[2]]],
    [{ genres: ["Action"], platforms: ["linux"] }, [ids[0]]],
    [{ genres: ["RPG"], platforms: ["windows"] }, [ids[1], ids[2], ids[3]]],
    [{ genres: ["Racing"] }, []],
  ]) await t.test(JSON.stringify(filters), async (t) => {
    const env = environment(t, { settings: settings(filters) });
    globalThis.fetch = sources([]);
    assert.equal((await runPromotionCheck()).ok, true);
    assert.equal(env.data.latestPromotions.length, 4);
    assert.equal(env.data.runtimeState.activeFreeToKeepCount, expected.length);
    assert.equal(env.notifications.length, expected.length);
    assert.deepEqual(sortedIds(visibleEntries(env.data.latestPromotions, env.data.settings, {})), [...expected].sort());
    for (const id of expected) {
      const title = env.data.latestPromotions.find((p) => p.stableId === id).title;
      assert.ok(env.notifications.some((n) => JSON.stringify(n.options).includes(title)));
    }
  });
});
