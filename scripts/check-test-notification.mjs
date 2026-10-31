// Isolated button regression check. --native opens a clean headed profile for OS inspection.
// Native mode accepts "send" / "status" / "close" and clears only its own test notifications.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const native = process.argv.includes("--native");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const out = resolve("dist/test-notification-check");
await mkdir(out, { recursive: true });
const extension = await mkdtemp(join(out, "extension-"));
for (const name of ["manifest.json", "src", "resources", "_locales"])
  await cp(resolve(name), join(extension, name), { recursive: true });
await writeFile(join(extension, "src/test-bootstrap.js"), `
globalThis.notificationTest = { mode: 'success', calls: [] };
const create = chrome.notifications.create.bind(chrome.notifications);
const permission = chrome.notifications.getPermissionLevel.bind(chrome.notifications);
chrome.notifications.getPermissionLevel = async () => notificationTest.mode === 'denied' ? 'denied' : ${native ? "permission()" : "'granted'"};
chrome.notifications.create = async (id, options) => {
  const start = performance.now();
  const record = { id, options };
  notificationTest.calls.push(record);
  if (notificationTest.mode === 'hold') await new Promise(resolve => { notificationTest.release = resolve; });
  if (notificationTest.mode === 'fail') throw new Error('notification-test-failure');
  const result = ${native ? "await create(id, options)" : "id"};
  record.elapsedMs = Math.round(performance.now() - start);
  return result;
};
export const testSeedReady = chrome.storage.local.set({ settings: {
  enabledStores: [], notificationsEnabled: false, language: 'ru', region: 'US'
} });
`);
const workerFile = join(extension, "src/service-worker.js");
await writeFile(workerFile, 'import { testSeedReady } from "./test-bootstrap.js";\n'
  + (await readFile(workerFile, "utf8")).replace("const ready = bootstrap();", "const ready = testSeedReady.then(bootstrap);"));
const context = await chromium.launchPersistentContext(await mkdtemp(join(out, "profile-")), {
  channel: "chromium", headless: !native, viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
let worker;
const errors = [], externalRequests = [];
try {
  // The test must work offline, including its bundled fictional artwork.
  await context.route("https://**/*", (route) => { externalRequests.push(route.request().url()); return route.abort(); });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL("ui/options.html#notifications", worker.url()).href);
  const button = page.locator("#test-notification");
  await page.waitForFunction(() => document.documentElement.lang === "ru");
  const state = () => worker.evaluate(async () => ({ calls: notificationTest.calls, active: await chrome.notifications.getAll() }));
  if (native) {
    console.log(JSON.stringify({ ready: true, url: page.url(), permission: await worker.evaluate(() => chrome.notifications.getPermissionLevel()) }));
    const input = createInterface({ input: process.stdin });
    for await (const line of input) {
      if (line.trim() === "close") break;
      if (line.trim() === "send") {
        await button.click();
        await page.waitForFunction(() => !document.querySelector("#test-notification").disabled);
      }
      console.log(JSON.stringify(await state()));
    }
    input.close();
    process.stdin.pause();
    process.stdin.unref?.();
    await writeFile(join(out, "native-result.json"), JSON.stringify(await state(), null, 2));
  } else {
    const mode = (value) => worker.evaluate((value) => { notificationTest.mode = value; }, value);
    const waitStatus = (text) => page.waitForFunction((text) => document.querySelector("#notification-test-status").textContent.includes(text)
      && !document.querySelector("#test-notification").disabled, text);
    await mode("hold");
    await button.click();
    await page.waitForFunction(() => document.querySelector("#test-notification").disabled);
    assert.match(await page.locator("#notification-test-status").innerText(), /Отправляем/);
    await page.evaluate(() => document.querySelector("#test-notification").click());
    await worker.evaluate(() => notificationTest.release());
    await waitStatus("отправлено браузеру");
    assert.equal((await state()).calls.length, 1);
    await mode("success");
    for (let i = 0; i < 2; i++) { await button.click(); await waitStatus("отправлено браузеру"); }
    const calls = (await state()).calls;
    assert.equal(calls.length, 3);
    assert.equal(new Set(calls.map((c) => c.id)).size, 3);
    assert.ok(calls.every((c) => c.options.type === "image"
      && c.options.imageUrl.endsWith("/src/ui/assets/notification-demo.png")
      && c.options.contextMessage.includes("94%")
      && c.options.message.startsWith("Скидка 100% до ")));
    assert.equal(await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image.naturalWidth === 720 && image.naturalHeight === 360;
    }, calls[0].options.imageUrl), true);
    await mode("denied"); await button.click(); await waitStatus("Браузер запретил");
    assert.equal((await state()).calls.length, 3);
    await mode("fail"); await button.click(); await waitStatus("Не удалось");
    await mode("success"); await button.click(); await waitStatus("отправлено браузеру");
    assert.equal((await state()).calls.length, 6);
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: join(out, `feedback-${colorScheme}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 850 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(out, "feedback-narrow.png"), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    const report = { checks: 12, errors, externalRequests, calls: (await state()).calls };
    await writeFile(join(out, "result.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks, errors, externalRequests }));
  }
} finally {
  if (native && worker) await worker.evaluate(async () => {
    for (const { id } of notificationTest.calls) await chrome.notifications.clear(id);
  }).catch(() => {});
  await context.close();
}
