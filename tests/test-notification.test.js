import test from "node:test";
import assert from "node:assert/strict";
import { environment } from "./helpers.mjs";
import { sendTestNotification, openNotificationTarget, clearNotificationTarget, createPromotionNotifications } from "../src/lib/notifications.js";

test("store alerts and reminders show a numeric discount deadline or omit unknown dates", async (t) => {
  const env = environment(t);
  for (const store of ["steam", "epic", "gog"]) {
    for (const language of ["ru", "en"]) {
      for (const reminder of [false, true]) {
        const promotion = { id: `${store}:test`, store, title: "Fixture", endsAt: new Date(2026, 10, 2, 14).getTime() };
        await createPromotionNotifications([promotion], { settings: { language }, reminder });
        assert.ok(env.notifications.at(-1).options.message.endsWith(language === "ru"
          ? "Скидка 100% до 02.11.2026" : "100% off until 02.11.2026"));
        await createPromotionNotifications([{ ...promotion, endsAt: null }], { settings: { language }, reminder });
        assert.ok(env.notifications.at(-1).options.message.endsWith(language === "ru" ? "Скидка 100%" : "100% off"));
      }
    }
  }
});

test("each manual notification is new, local, and independent of giveaway state", async (t) => {
  const env = environment(t, { notifiedPromotions: { real: { fingerprint: "kept" } } });
  const before = structuredClone(env.data);
  chrome.notifications.getPermissionLevel = async () => "granted";
  globalThis.fetch = async () => { throw new Error("Test must not require a network request"); };
  await Promise.all([sendTestNotification({ language: "ru", notificationsEnabled: false }), sendTestNotification({ language: "en" })]);
  assert.equal(env.notifications.length, 2);
  assert.equal(new Set(env.notifications.map((n) => n.id)).size, 2);
  for (const { id, options } of env.notifications) {
    assert.match(id, /:test:/);
    assert.equal(options.type, "image");
    assert.ok(options.iconUrl.startsWith("chrome-extension://test/"));
    assert.equal(options.imageUrl, "chrome-extension://test/src/ui/assets/notification-demo.png");
    assert.match(options.contextMessage, /^Steam: 94% · 12[\s,]345 /);
    assert.match(options.message, /\d{2}\.\d{2}\.\d{4}\n\$19\.99 → \$0$/);
    assert.equal(options.silent, false);
    await clearNotificationTarget(id);
  }
  // Concurrent locale loads may finish in either order.
  assert.equal(env.notifications.filter(({ options }) => options.title === "Starfall Courier — тест" && options.message.startsWith("Скидка 100% до ")).length, 1);
  assert.equal(env.notifications.filter(({ options }) => options.title === "Starfall Courier — test" && options.message.startsWith("100% off until ")).length, 1);
  assert.deepEqual(env.data, before);
  let opened;
  chrome.tabs.create = async (value) => { opened = value.url; };
  await openNotificationTarget(env.notifications[0].id);
  assert.equal(opened, "chrome-extension://test/src/ui/options.html#notifications");
});

test("test notification keeps its data and identity when the image is unsupported", async (t) => {
  environment(t);
  chrome.notifications.getPermissionLevel = async () => "granted";
  const calls = [];
  chrome.notifications.create = async (id, options) => {
    calls.push({ id, options });
    if (options.type === "image") throw new Error("Image unsupported");
    return id;
  };
  const id = await sendTestNotification({ language: "ru" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].id, id);
  assert.equal(calls[1].id, id);
  const { imageUrl, ...original } = calls[0].options;
  assert.deepEqual(calls[1].options, { ...original, type: "basic" });
});

test("blocked and failed test notifications report errors and allow a later retry", async (t) => {
  const env = environment(t);
  chrome.notifications.getPermissionLevel = async () => "denied";
  await assert.rejects(sendTestNotification(), /notificationsBlocked/);
  assert.equal(env.notifications.length, 0);
  chrome.notifications.getPermissionLevel = async () => "granted";
  const create = chrome.notifications.create;
  chrome.notifications.create = async () => { throw new Error("Native notification failed"); };
  await assert.rejects(sendTestNotification(), /Native notification failed/);
  chrome.notifications.create = create;
  await sendTestNotification();
  assert.equal(env.notifications.length, 1);
});
