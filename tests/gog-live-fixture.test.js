import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseGogGiveaway, fetchGogPromotions } from "../src/lib/providers/gogProvider.js";
import { environment, response } from "./helpers.mjs";
import { sanitizeSettings } from "../src/lib/settings.js";
import { runPromotionCheck } from "../src/lib/promotions.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/gog-a-new-beginning.json", import.meta.url), "utf8"));
const now = Date.parse("2026-10-31T12:00:00Z");
const end = Date.parse("2026-11-02T14:00:59Z");

test("real GOG giveaway terms override the nonzero catalog purchase price", () => {
  const { promotion, state } = parseGogGiveaway(fixture.section, "US", now);
  assert.equal(state, "active");
  assert.equal(promotion.stableId, "gog:1207659150");
  assert.equal(promotion.title, "A New Beginning: Final Cut");
  assert.equal(promotion.url, "https://www.gog.com/en/game/a_new_beginning");
  assert.equal(promotion.claimUrl, "https://www.gog.com/en/");
  assert.equal(promotion.endsAt, end);
  assert.equal(promotion.startsAt, 0);
  assert.equal(promotion.basePriceFormatted, "$9.99");
  assert.deepEqual(promotion.platforms, ["windows", "mac"]);
  assert.deepEqual(promotion.genres, []); // The live section has tags, not genre metadata.
  assert.ok(promotion.headerImage.startsWith("https://images.gog-statics.com/"));
  assert.equal(fixture.section.properties.product.price.finalMoney.amount, "0.99");
});

test("real GOG deadline expires exactly at the advertised instant", () => {
  assert.equal(parseGogGiveaway(fixture.section, "US", end - 1).state, "active");
  assert.equal(parseGogGiveaway(fixture.section, "US", end).state, "expired");
  const invalid = structuredClone(fixture.section);
  delete invalid.properties.endDate;
  assert.throws(() => parseGogGiveaway(invalid, "US", now), /Invalid GOG/);
});

test("real GOG response reaches storage and notifies once through anonymous discovery", async (t) => {
  const env = environment(t, { settings: sanitizeSettings({ enabledStores: ["gog"] }) });
  t.mock.method(Date, "now", () => now);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, "omit");
    calls.push(String(url));
    if (url.startsWith("https://catalog.gog.com/v1/catalog?")) return response(fixture.catalog);
    if (url.includes(`/sections/${fixture.page.sections[0].sectionId}?`)) return response(fixture.section);
    if (url.startsWith("https://sections.gog.com/v1/pages/2f?")) return response(fixture.page);
    // Notification artwork may fail without affecting a confirmed giveaway.
    if (url.startsWith("https://images.gog-statics.com/")) throw new Error("No artwork in unit test");
    throw new Error(`Unexpected GOG endpoint: ${url}`);
  };
  const discovery = await fetchGogPromotions({ region: "US" });
  assert.equal(discovery.complete, true);
  assert.equal(discovery.sectionSchemaLiveVerified, true);
  assert.deepEqual(discovery.warnings, []);
  assert.equal(discovery.promotions.length, 1);
  assert.equal((await runPromotionCheck()).ok, true);
  assert.equal(env.data.runtimeState.lastCheckOutcome, "success");
  assert.equal(env.data.latestPromotions[0].claimUrl, "https://www.gog.com/en/");
  assert.equal(env.data.history[0].stableId, "gog:1207659150");
  assert.equal(env.notifications.length, 1);
  await runPromotionCheck();
  assert.equal(env.notifications.length, 1);
  assert.ok(calls.every(url => !url.includes("/giveaway/status") && !url.includes("/giveaway/claim")));
});
