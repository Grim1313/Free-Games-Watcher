import test from "node:test";
import assert from "node:assert/strict";
import { environment } from "./helpers.mjs";
import { sendTestNotification, openNotificationTarget, clearNotificationTarget } from "../src/lib/notifications.js";

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
    assert.equal(options.type, "basic");
    assert.ok(options.iconUrl.startsWith("chrome-extension://test/"));
    assert.equal(options.imageUrl, undefined);
    assert.equal(options.silent, false);
    await clearNotificationTarget(id);
  }
  assert.match(env.notifications[0].options.title, /проверка уведомлений/);
  assert.match(env.notifications[1].options.title, /notification test/);
  assert.deepEqual(env.data, before);
  let opened;
  chrome.tabs.create = async (value) => { opened = value.url; };
  await openNotificationTarget(env.notifications[0].id);
  assert.equal(opened, "chrome-extension://test/src/ui/options.html#notifications");
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
