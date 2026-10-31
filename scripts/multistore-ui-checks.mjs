import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkMultistore({ worker, page, options, history, out }) {
  let checks = 0;
  const snapshot = await worker.evaluate(() => chrome.storage.local.get(null));
  const alarms = await worker.evaluate(() => chrome.alarms.getAll());
  try {
    await options.locator('[data-section="general"]').click();
    await options.locator("#language").selectOption("en");
    await options.locator("#store-steam").uncheck();
    await options.locator("#store-epic").check();
    await options.locator("#store-gog").check();
    await options.locator("#save-settings").click();
    await options.waitForFunction(() => document.documentElement.lang === "en");
    await page.locator("#check-now").click();
    await page.waitForFunction(() => document.querySelectorAll(".promotion-item").length === 2);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("settings")).settings.enabledStores), ["epic", "gog"]);
    assert.equal(await page.locator('.store-tag[title="Epic Games Store"]').filter({ hasText: "Epic" }).count(), 1);
    assert.equal(await page.locator(".store-tag").filter({ hasText: "GOG" }).count(), 1);
    assert.equal(await page.locator('a.primary-button[href="https://www.gog.com/en/"]').count(), 1);
    assert.equal(await page.locator('a.promotion-title[href="https://www.gog.com/en/game/test_game"]').count(), 1);
    checks += 5;
    await page.locator("#upcoming-section summary").click();
    assert.equal(await page.locator("#upcoming-list li").count(), 1);
    assert.equal(await page.locator("#upcoming-list button").count(), 0);
    await page.locator("#upcoming-section summary").click();
    checks += 2;
    for (const lang of ["en", "ru"]) {
      await options.locator("#language").selectOption(lang);
      await options.locator("#save-settings").click();
      await page.waitForFunction((language) => document.documentElement.lang === language, lang);
      for (const theme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.screenshot({ path: join(out, `multistore-popup-${lang}-${theme}.png`), fullPage: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        assert.equal(overflow, false);
        checks++;
      }
    }
    await options.locator("#language").selectOption("en");
    await options.locator("#save-settings").click();
    await page.waitForFunction(() => document.documentElement.lang === "en");
    await page.locator("#store-filter").selectOption("epic");
    await page.waitForFunction(() => document.querySelectorAll(".promotion-item").length === 1);
    await page.locator(".promotion-item").getByRole("button", { name: "Already claimed", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".promotion-item").length === 0);
    await page.locator("#store-filter").selectOption("gog");
    await page.waitForFunction(() => document.querySelectorAll(".promotion-item").length === 1);
    checks++;
    await history.reload();
    await history.locator("#status-filter").selectOption("claimed");
    await history.locator("#store-filter").selectOption("epic");
    await history.waitForFunction(() => document.querySelectorAll("#history-body tr").length === 1);
    await history.getByRole("button", { name: "Restore", exact: true }).click();
    await history.waitForFunction(() => document.querySelectorAll("#history-body tr").length === 0);
    checks++;
    await options.locator("#store-steam").check();
    await options.locator("#save-settings").click();
    await page.locator("#store-filter").selectOption("all");
    await page.locator("#check-now").click();
    await page.waitForFunction(() => document.querySelector("#show-all").textContent === "Show all 14");
    checks++;
    await worker.evaluate(() => { globalThis.failEpic = true; });
    await page.locator("#check-now").click();
    await page.waitForFunction(() => document.querySelector(".status-panel").dataset.state === "partial");
    const data = await worker.evaluate(() => chrome.storage.local.get(["latestPromotions", "diagnostics"]));
    assert.equal(data.latestPromotions.find((p) => p.store === "epic").stale, true);
    assert.equal(data.diagnostics.storeResults.gog.ok, true);
    checks += 2;
    await worker.evaluate(() => { globalThis.failEpic = false; });
    await page.locator("#check-now").click();
    await page.waitForFunction(() => document.querySelector(".status-panel").dataset.state === "success");
    await options.locator('[data-section="diagnostics"]').click();
    await options.waitForFunction(() => document.querySelector("#source-status").textContent.includes("GOG"));
    await options.screenshot({ path: join(out, "multistore-diagnostics.png"), fullPage: true });
    await options.locator('[data-section="general"]').click();
    await options.screenshot({ path: join(out, "multistore-settings.png"), fullPage: true });
    await history.locator("#store-filter").selectOption("all");
    await history.locator("#status-filter").selectOption("all");
    await history.locator("#search").fill("Test game");
    await history.waitForFunction(() => document.querySelectorAll("#history-body tr").length === 2);
    await history.setViewportSize({ width: 390, height: 800 });
    await history.screenshot({ path: join(out, "multistore-history-narrow.png"), fullPage: true });
    assert.equal(await history.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks++;
    // Save actual form controls and verify both popup counts and rendered cards.
    // Fixture Steam games support Windows/Linux; GOG supports Windows; Epic metadata is unknown.
    await options.locator('[data-section="filters"]').click();
    for (const [genre, platforms, count, gogCount] of [
      ["Action", ["windows"], 13, null], ["Action", ["linux"], 12, 0],
      ["Action", ["mac"], 0, 0], ["RPG", ["windows"], 0, 0], ["", [], 14, null],
    ]) {
      await options.locator("#genres").fill(genre);
      for (const platform of ["windows", "mac", "linux"])
        await options.locator(`#platform-${platform}`).setChecked(platforms.includes(platform));
      await options.locator("#save-settings").click();
      await page.waitForFunction(async (count) => {
        const data = await chrome.runtime.sendMessage({ type: "GET_POPUP_DATA" });
        return data.visiblePromotions.length === count && data.runtimeState.activeFreeToKeepCount === count;
      }, count);
      await page.waitForFunction((count) => document.querySelectorAll(".promotion-item").length === Math.min(10, count), count);
      if (gogCount !== null)
        assert.equal(await page.locator(".store-tag").filter({ hasText: "GOG" }).count(), gogCount);
      checks++;
    }
    await options.locator('[data-section="general"]').click();
    for (const store of ["steam", "epic", "gog"]) await options.locator(`#store-${store}`).uncheck();
    await options.locator("#save-settings").click();
    await page.waitForFunction(() => document.querySelector(".status-panel").dataset.state === "paused");
    assert.equal(await page.locator("#check-now").isDisabled(), true);
    assert.equal(await worker.evaluate(async () => (await chrome.alarms.getAll()).length), 0);
    checks += 2;
  } finally {
    await worker.evaluate(async (previous) => {
      await chrome.alarms.clearAll();
      for (const alarm of previous) await chrome.alarms.create(alarm.name, { when: alarm.scheduledTime });
    }, alarms);
    await worker.evaluate((data) => { globalThis.failEpic = false; return chrome.storage.local.set(data); }, snapshot);
    await options.reload();
    await options.locator("#save-settings").waitFor();
    await page.locator("#store-filter").selectOption("all");
    await history.setViewportSize({ width: 1200, height: 800 });
  }
  return checks;
}
