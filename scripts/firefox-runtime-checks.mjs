import assert from "node:assert/strict";
import { evaluate, send, waitFor, ADDON_ID, BASE_URL } from "./firefox-harness.mjs";

export async function checkFirefoxRuntime(driver, record, extension) {
  const snapshot = await evaluate(driver, () => browser.storage.local.get(null));
  const log = () => evaluate(driver, async () => (await browser.runtime.getBackgroundPage()).testNotifications);
  const data = () => send(driver, "GET_OPTIONS_DATA");
  try {
    await evaluate(driver, async () => {
      (await browser.runtime.getBackgroundPage()).testNotifications=[];
      await browser.storage.local.set({latestPromotions:[],history:[],notifiedPromotions:{},userActions:{}});
    });
    const time = hours => { const date=new Date(Date.now()+hours*3600000);return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`; };
    await send(driver,"SAVE_SETTINGS",{settings:{notificationsEnabled:true,quietHoursEnabled:true,quietHoursStart:time(-1),quietHoursEnd:time(1)}});
    await send(driver,"CHECK_NOW");
    assert.equal((await log()).length,0);
    assert.ok((await data()).runtimeState.pendingQuietCount>0);
    await send(driver,"SAVE_SETTINGS",{settings:{quietHoursEnabled:false}});
    await send(driver,"CHECK_NOW"); assert.equal((await log()).length,4);
    record("quiet hours defer notifications and release pending offers afterward");
    // Production intentionally waits a minute after the initial alert.
    await evaluate(driver,async()=>{const {notifiedPromotions}=await browser.storage.local.get("notifiedPromotions");for(const n of Object.values(notifiedPromotions))n.lastNotifiedAt-=120000;await browser.storage.local.set({notifiedPromotions});});
    await send(driver,"SAVE_SETTINGS",{settings:{remindersEnabled:true,reminderHours:48}});
    await send(driver,"CHECK_NOW");
    const reminders=(await log()).filter(n=>n.id.includes(":reminder:"));
    assert.equal(reminders.length,4);
    await send(driver,"CHECK_NOW"); assert.equal((await log()).length,8);
    record("deadline reminders fire once and retain Firefox-compatible text");
    await send(driver,"SAVE_SETTINGS",{settings:{remindersEnabled:false}});
    await send(driver,"SET_ACTION",{stableId:"app:100",action:"snooze"});
    await evaluate(driver,async()=>{const {userActions}=await browser.storage.local.get("userActions");userActions['app:100'].snoozedUntil=Date.now()-1;await browser.storage.local.set({userActions});});
    await send(driver,"CHECK_NOW"); assert.equal((await log()).length,9);
    await send(driver,"CHECK_NOW"); assert.equal((await log()).length,9);
    record("expired snooze requests exactly one fresh notification");
    await send(driver,"SAVE_SETTINGS",{settings:{badgeEnabled:false}});
    assert.equal(await evaluate(driver,()=>browser.action.getBadgeText({})),"");
    await send(driver,"SAVE_SETTINGS",{settings:{badgeEnabled:true}});
    assert.equal(await evaluate(driver,()=>browser.action.getBadgeText({})),"14");
    record("toolbar badge can be disabled and restored with correct counts");
  } finally {
    await evaluate(driver, async snapshot=>{await browser.storage.local.clear();await browser.storage.local.set(snapshot);},snapshot);
    await send(driver,"SAVE_SETTINGS",{settings:{notificationsEnabled:false}});
  }

  // No extension view can remain open when testing an idle event page.
  const state = await evaluate(driver,()=>browser.storage.local.get(["settings","history","userActions"]));
  await driver.get("about:blank");
  await driver.setContext("chrome");
  const stopped = await evaluate(driver,async id=>{
    const e=ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs").ExtensionParent.GlobalManager.getExtension(id);
    await e.terminateBackground();
    return e.backgroundState;
  },ADDON_ID);
  assert.equal(stopped,"stopped");
  await driver.setContext("content");
  await driver.get(BASE_URL+"src/ui/options.html");
  await waitFor(driver,()=>!!document.querySelector("#app-version")?.textContent);
  assert.deepEqual(await evaluate(driver,()=>browser.storage.local.get(["settings","history","userActions"])),state);
  record("idle event page unloads, wakes on a message and preserves settings/history/marks");
  await evaluate(driver,()=>browser.alarms.clearAll());
  await driver.get("about:blank");
  // Geckodriver uploads a temporary ZIP whose path older Firefox cannot reload.
  // Reinstall the same ID from the retained build to exercise an in-place update.
  assert.equal(await driver.installAddon(extension,true),ADDON_ID);
  await driver.get(BASE_URL+"src/ui/options.html");
  await waitFor(driver,()=>!!document.querySelector("#app-version")?.textContent);
  // onInstalled also checks the stores on reload: discovery timestamps can advance.
  await waitFor(driver,async()=>!(await browser.runtime.sendMessage({type:"GET_OPTIONS_DATA"})).runtimeState.checkInProgress);
  const restored=await evaluate(driver,()=>browser.storage.local.get(["settings","history","userActions"]));
  assert.deepEqual(restored.settings,state.settings);
  assert.deepEqual(restored.userActions,state.userActions);
  const retained=history=>history.map(({id,firstSeenAt,fingerprint,unread,importedAt})=>({id,firstSeenAt,fingerprint,unread,importedAt})).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(retained(restored.history),retained(state.history));
  assert.ok(await evaluate(driver,()=>browser.alarms.get("steam-promo-check")));
  record("in-place extension update preserves data and restores a missing scheduled alarm");
}
