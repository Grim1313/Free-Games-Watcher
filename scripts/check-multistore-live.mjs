// Manual end-to-end live check. Uses a fresh profile and disables OS notifications.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const out = resolve("dist/multistore-live");
await mkdir(out, { recursive: true });
const extension = await mkdtemp(join(out, "extension-"));
for (const name of ["manifest.json", "src", "resources", "_locales"])
  await cp(resolve(name), join(extension, name), { recursive: true });
await writeFile(join(extension, "src/test-bootstrap.js"), `
export const testSeedReady = (async () => {
  if (!(await chrome.storage.local.get("liveSeeded")).liveSeeded) {
    await chrome.storage.local.set({ liveSeeded: true, settings: {
      region: "US", language: "ru", enabledStores: ["steam", "epic", "gog"], notificationsEnabled: false
    }});
  }
})();
`);
const workerFile = join(extension, "src/service-worker.js");
await writeFile(workerFile, 'import { testSeedReady } from "./test-bootstrap.js";\n'
  + (await readFile(workerFile, "utf8")).replace("const ready = bootstrap();", "const ready = testSeedReady.then(bootstrap);"));
const context = await chromium.launchPersistentContext(await mkdtemp(join(out, "profile-")), {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const errors = [], reports = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 410, height: 600 });
  await page.goto(new URL("ui/popup.html", worker.url()).href);
  const send = (type, payload = {}) => page.evaluate(({ type, payload }) =>
    chrome.runtime.sendMessage({ type, ...payload }), { type, payload });
  for (const region of ["US", "RU"]) {
    assert.equal((await send("SAVE_SETTINGS", { settings: { region } })).ok, true);
    const checked = await send("CHECK_NOW");
    assert.equal(checked.ok, true, JSON.stringify(checked));
    const data = await send("GET_POPUP_DATA");
    for (const store of ["steam", "epic", "gog"])
      assert.equal(data.diagnostics.storeResults[store].ok, true, `${region}: ${store}`);
    reports.push({ checkedAt: new Date().toISOString(), region, diagnostics: data.diagnostics,
      active: data.latestPromotions, visible: data.visiblePromotions, upcoming: data.upcomingPromotions });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.lang === "ru");
    await page.waitForFunction(() => [...document.images].every((image) => image.complete));
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: join(out, `popup-${region}-${colorScheme}.png`), fullPage: true });
    }
    console.log(JSON.stringify({ region, stores: Object.keys(data.diagnostics.storeResults),
      current: data.visiblePromotions.map((p) => ({ store: p.store, title: p.title, endsAt: new Date(p.endsAt).toISOString() })),
      upcoming: data.upcomingPromotions.map((p) => p.title), outcome: data.runtimeState.lastCheckOutcome }));
  }
  assert.deepEqual(errors, []);
  const report = { version: JSON.parse(await readFile("manifest.json", "utf8")).version,
    environment: "Live APIs through the production Manifest V3 worker; clean profile; notifications disabled",
    userAgent: await page.evaluate(() => navigator.userAgent), errors, reports };
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Report: ${join(out, "report.json")}`);
} finally { await context.close(); }
