import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { launchFirefox, BASE_URL, ADDON_ID, evaluate, send, waitFor } from "./firefox-harness.mjs";

// Install the exact deliverable without injected fixtures or notification mocks.
const { version } = JSON.parse(await readFile("manifest.json", "utf8"));
const out = resolve(process.env.FIREFOX_REPORT_DIR || "dist/firefox-package");
const archive = resolve(`dist/Free-Games-Watcher-Firefox-${version}.zip`);
const driver = await launchFirefox({ out, extension: archive });
try {
  await driver.get(BASE_URL + "src/ui/options.html");
  const initial = await send(driver, "GET_OPTIONS_DATA");
  assert.deepEqual(initial.settings.enabledStores, ["steam", "epic", "gog"]);
  await waitFor(driver, () => ["steam", "epic", "gog"].every(store => document.getElementById(`store-${store}`)?.checked));
  await send(driver, "SAVE_SETTINGS", { settings: { notificationsEnabled: false, enabledStores: [], language: "ru" } });
  const manifest = await evaluate(driver, () => browser.runtime.getManifest());
  assert.equal(manifest.version, version);
  assert.equal(manifest.browser_specific_settings.gecko.id, ADDON_ID);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.background.scripts.length, 1);
  assert.equal(manifest.background.scripts[0], BASE_URL + "src/service-worker.js");
  const pages = [];
  for (const page of ["options", "popup", "history"]) {
    await driver.get(`${BASE_URL}src/ui/${page}.html`);
    await waitFor(driver, () => document.querySelector("#app-version")?.textContent || document.querySelector("#history-count")?.textContent);
    const state = await evaluate(driver, () => ({ title: document.title, text: document.body.textContent, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(state.text.includes("Free Games Watcher"));
    assert.ok(state.scrollWidth <= state.width);
    await writeFile(join(out, `${page}.png`), await driver.takeScreenshot(), "base64");
    pages.push({ page, title: state.title });
  }
  const data = await send(driver, "GET_OPTIONS_DATA");
  assert.deepEqual(data.settings.enabledStores, []);
  assert.equal(data.missingHostPermissions.length, 0);
  const report = { archive, version, browser: (await driver.getCapabilities()).get("browserVersion"), pages, fixtureInjection: false };
  await writeFile(join(out, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await driver.quit().catch(() => {});
}
