import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { firefoxManifest } from "../scripts/firefox-manifest.mjs";
import { extensionApi, isFirefox, missingHostPermissions } from "../src/lib/browser-api.js";
import { firefoxNotificationOptions, createPromotionNotifications, sendTestNotification, openNotificationTarget } from "../src/lib/notifications.js";
import { environment, entry } from "./helpers.mjs";

test("Firefox manifest keeps product, scope and permissions but uses a module event page and stable identity", async () => {
  const base = JSON.parse(await readFile("manifest.json", "utf8"));
  const original = structuredClone(base);
  const manifest = firefoxManifest(base);
  assert.deepEqual(base, original);
  assert.equal(manifest.version, base.version);
  assert.deepEqual(manifest.permissions, base.permissions);
  assert.deepEqual(manifest.host_permissions, base.host_permissions);
  assert.deepEqual(manifest.background, { scripts: ["src/service-worker.js"], type: "module" });
  assert.equal(manifest.minimum_chrome_version, undefined);
  assert.equal(manifest.browser_specific_settings.gecko.id, "free-games-watcher@grim1313");
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ["locationInfo", "websiteContent"]);
});

function firefoxEnvironment(t) {
  const env = environment(t);
  const previous = globalThis.browser;
  globalThis.browser = { ...globalThis.chrome,
    runtime: { getURL: (path) => `moz-extension://test/${path}` },
  };
  t.after(() => { globalThis.browser = previous; });
  return env;
}

test("browser API prefers Firefox promises, falls back to Chromium, and detects by extension scheme", (t) => {
  environment(t);
  assert.equal(extensionApi(), globalThis.chrome);
  assert.equal(isFirefox(), false);
  const prior = globalThis.browser;
  t.after(() => { globalThis.browser = prior; });
  globalThis.browser = { runtime: { getURL: () => "moz-extension://test/" } };
  assert.equal(extensionApi(), globalThis.browser);
  assert.equal(isFirefox(), true);
});

test("Firefox basic notification preserves rating and price without unsupported properties", () => {
  assert.deepEqual(firefoxNotificationOptions({ type: "image", iconUrl: "local.png", imageUrl: "cover.png",
    title: "Title", message: "100% off\n$19.99 → $0", contextMessage: "94% / 12,345 reviews", priority: 0, silent: false }),
  { type: "basic", iconUrl: "local.png", title: "Title", message: "100% off\n$19.99 → $0\n94% / 12,345 reviews" });
});

test("Firefox deliveries are serialized and a retry works after a rejected OS request", async (t) => {
  const { notifications } = firefoxEnvironment(t);
  browser.notifications.getPermissionLevel = async () => "granted";
  const times = [];
  browser.notifications.create = async (id, options) => { times.push(Date.now()); notifications.push({ id, options }); return id; };
  const ids = await Promise.all([sendTestNotification({ language: "en" }), sendTestNotification({ language: "ru" })]);
  assert.notEqual(ids[0], ids[1]);
  assert.ok(times[1] - times[0] >= 950);
  assert.equal(notifications[0].options.type, "basic");
  assert.match(notifications[0].options.message, /94%/);
  const create = browser.notifications.create;
  browser.notifications.create = async () => { throw new Error("OS unavailable"); };
  await assert.rejects(sendTestNotification(), /OS unavailable/);
  browser.notifications.create = create;
  await sendTestNotification();
  assert.equal(notifications.length, 3);
});

test("a notification destination exists before display and failed delivery is never acknowledged", async (t) => {
  const { data } = firefoxEnvironment(t);
  let opened = "", acknowledged = false;
  browser.tabs.create = async ({ url }) => { opened = url; };
  browser.notifications.create = async (id) => {
    assert.ok(data.notificationLinks[id]);
    await openNotificationTarget(id);
    throw new Error("OS rejected");
  };
  await assert.rejects(createPromotionNotifications([entry({ stableId: "gog:123", url: "https://www.gog.com/en/game/test" })],
    { onDelivered: () => { acknowledged = true; } }), /OS rejected/);
  assert.equal(opened, "https://www.gog.com/en/game/test");
  assert.equal(acknowledged, false);
  assert.deepEqual(data.notificationLinks, {});
});

test("revoked origins are reported independently of granted store permissions", async (t) => {
  firefoxEnvironment(t);
  browser.runtime.getManifest = () => ({ host_permissions: ["https://store.steampowered.com/*", "https://api.egdata.app/*"] });
  browser.permissions = { contains: async ({ origins }) => origins.every(origin => origin.includes("steampowered")) };
  assert.deepEqual(await missingHostPermissions(), ["https://api.egdata.app/*"]);
});

test("a displayed notification keeps its destination if acknowledgement fails", async (t) => {
  const { data, notifications } = firefoxEnvironment(t);
  await assert.rejects(createPromotionNotifications([entry({ url: "https://store.steampowered.com/app/123/" })],
    { onDelivered: () => { throw new Error("storage unavailable"); } }), /storage unavailable/);
  assert.equal(notifications.length, 1);
  assert.equal(data.notificationLinks[notifications[0].id].url, "https://store.steampowered.com/app/123/");
});

test("Firefox preview checks the manifest permission when getPermissionLevel is unavailable", async (t) => {
  const { notifications } = firefoxEnvironment(t);
  browser.permissions = { contains: async ({ permissions }) => permissions.includes("notifications") };
  assert.equal(browser.notifications.getPermissionLevel, undefined);
  await sendTestNotification();
  assert.equal(notifications.length, 1);
  browser.permissions.contains = async () => false;
  await assert.rejects(sendTestNotification(), /notificationsBlocked/);
  assert.equal(notifications.length, 1);
});
