import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { By, Key } from "selenium-webdriver";
import { browserBootstrap } from "./browser-fixtures.mjs";
import { checkFirefoxRuntime } from "./firefox-runtime-checks.mjs";
import { launchFirefox, stageFirefox, BASE_URL, ADDON_ID, evaluate, send, waitFor } from "./firefox-harness.mjs";

const live = process.argv.includes("--live");
const out = resolve(process.env.FIREFOX_REPORT_DIR || `dist/firefox-${live ? "live" : "check"}`);
await mkdir(join(out, "downloads"), { recursive: true });
const controls = `
globalThis.testNotifications = [];
globalThis.testClicked = [];
globalThis.testClosed = [];
const nativeCreate = browser.notifications.create.bind(browser.notifications);
globalThis.nativeTestNotification = nativeCreate;
globalThis.testOpenedTabs = [];
const nativeOpenTab = browser.tabs.create.bind(browser.tabs);
browser.tabs.create = options => { globalThis.testOpenedTabs.push(options); return nativeOpenTab(options); };
browser.notifications.create = async (id, options) => {
  if (globalThis.testNotificationFailure) throw new Error('operationFailed');
  globalThis.testNotifications.push({id, options, at:Date.now()}); return id;
};
const nativePermission = browser.permissions.contains.bind(browser.permissions);
browser.permissions.contains = permissions => globalThis.testPermissionDenied && permissions.permissions?.includes('notifications') ? Promise.resolve(false) : nativePermission(permissions);
for (const [event, list] of [[browser.notifications.onClicked,globalThis.testClicked],[browser.notifications.onClosed,globalThis.testClosed]]) {
  const add = event.addListener.bind(event);
  event.addListener = fn => { list.push(fn); add(fn); };
}
`;
const bootstrap = live
  ? `export const testSeedReady=(async()=>{if(!(await browser.storage.local.get('testSeeded')).testSeeded)await browser.storage.local.set({testSeeded:true,settings:{notificationsEnabled:false,language:'en',region:'US',enabledStores:['steam','epic','gog']}});})();`
  : browserBootstrap + controls;
const extension = await stageFirefox(out, bootstrap);
const driver = await launchFirefox({ out, extension, headed: process.argv.includes("--headed") });
const checks = [];
const record = name => { checks.push(name); console.log(`PASS ${name}`); };
const css = selector => driver.findElement(By.css(selector));
const count = selector => evaluate(driver, s => document.querySelectorAll(s).length, selector);
const text = selector => css(selector).getText();
const click = async selector => {
  // Storage events can replace a row between locating and clicking it.
  for (let attempt = 0; ; attempt++) {
    try {
      const el = await css(selector);
      await driver.executeScript("arguments[0].scrollIntoView({block:'center'})", el);
      await el.click(); return;
    } catch (error) {
      if (error.name !== "StaleElementReferenceError" || attempt >= 4) throw error;
    }
  }
};
const set = async (selector, value) => {
  const el = await css(selector);
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'})",el);
  if (typeof value === "boolean") { if (await el.isSelected() !== value) await click(selector); }
  else if ((await el.getTagName()) === "select") {
    await el.findElement(By.css(`option[value="${value}"]`)).click();
  } else if (await el.getAttribute("type") === "time") {
    await driver.executeScript("arguments[0].value=arguments[1];arguments[0].dispatchEvent(new Event('input',{bubbles:true}))",el,value);
  } else {
    await el.sendKeys(Key.chord(Key.CONTROL,"a"),Key.BACK_SPACE);
    if (value !== "" && value != null) await el.sendKeys(String(value));
  }
};
const open = async path => {
  await driver.get(BASE_URL + `src/ui/${path}`);
  await waitFor(driver, () => Boolean(document.querySelector("#app-version")?.textContent || document.querySelector("#history-count")?.textContent));
};
const data = () => send(driver, "GET_OPTIONS_DATA");
const bg = (key, value) => evaluate(driver, async (key, value) => { (await browser.runtime.getBackgroundPage())[key] = value; }, key, value);
const notificationLog = () => evaluate(driver, async () => (await browser.runtime.getBackgroundPage()).testNotifications);
const save = async () => { await click("#save-settings"); await waitFor(driver, () => /^(Settings saved\.|Настройки сохранены\.)$/.test(document.querySelector("#form-status").textContent)); };
const section = id => click(`[data-section="${id}"]`);
const snapshot = name => driver.takeScreenshot().then(image => writeFile(join(out, name + ".png"), image, "base64"));
const readStorage = () => evaluate(driver, () => browser.storage.local.get(null));
const writeStorage = value => evaluate(driver, value => browser.storage.local.set(value), value);
let liveReport;
try {
  await open("options.html");
  await send(driver, "CHECK_NOW");
  await waitFor(driver, async () => !(await browser.runtime.sendMessage({ type: "GET_OPTIONS_DATA" })).runtimeState.checkInProgress);
  const initial = await data();
  assert.deepEqual(initial.settings.enabledStores, live ? ["steam", "epic", "gog"] : ["steam"]);
  record("installed MV3 event page, initialization and real runtime messaging");

  if (live) {
    liveReport = [];
    for (const region of ["US", "RU"]) {
      await send(driver, "SAVE_SETTINGS", { settings: { region } });
      const scan = await send(driver, "CHECK_NOW");
      const state = await data();
      liveReport.push({ region, scan, diagnostics: state.diagnostics,
        offers: state.latestPromotions, visible: state.visiblePromotions, upcoming: state.upcomingPromotions });
      assert.ok(state.diagnostics.sources?.length);
      assert.equal(state.runtimeState.checkInProgress, false);
      record(`live ${region}: ${state.visiblePromotions.length} visible offers; ${state.runtimeState.lastCheckOutcome}`);
    }
    await open("popup.html");
    await waitFor(driver,()=>[...document.images].every(img=>img.complete));
    await snapshot("live-popup");
    await writeFile(join(out,"artwork.json"),JSON.stringify(await evaluate(driver,()=>[...document.images].map(img=>({src:img.currentSrc||img.src,width:img.naturalWidth,height:img.naturalHeight}))),null,2));
    await open("options.html#diagnostics"); await snapshot("live-diagnostics");
  } else {
    assert.equal(initial.visiblePromotions.length, 12);
    await open("popup.html");
    assert.equal(await count(".promotion-item"), 10);
    assert.equal(await text("#show-all"), "Show all 12");
    assert.equal(await text("#unread-pill"), "12 new");
    record("Steam discovery, 10-card limit, count and unread badge");

    for (const action of ["claim", "snooze", "hide", "ignore"]) {
      await click(`.promotion-item [data-focus-key="${action}"]`);
      await waitFor(driver, () => document.querySelector("#show-all").textContent === "Show all 11");
      await click("#feedback button");
      await waitFor(driver, () => document.querySelector("#show-all").textContent === "Show all 12");
      record(`${action} and undo through popup controls`);
    }
    await click(".new-marker");
    await waitFor(driver, () => document.querySelector("#unread-pill").textContent === "11 new");
    assert.notEqual(await evaluate(driver, () => document.activeElement.tagName), "BODY");
    await click("#mark-all-read");
    await waitFor(driver, () => document.querySelectorAll(".new-marker").length === 0);
    record("mark one/all read and preserve keyboard focus");
    await set("#compact-view", true);
    await waitFor(driver, () => document.querySelector("#promotion-list").classList.contains("compact"));
    await set("#sort-by", "title");
    await waitFor(driver, async () => (await browser.storage.local.get("settings")).settings.sortBy === "title");
    record("compact view and saved sorting");

    await open("options.html");
    for (const store of ["steam", "epic", "gog"]) await set(`#store-${store}`, true);
    await save(); await send(driver, "CHECK_NOW");
    let all = await data();
    assert.equal(all.visiblePromotions.length, 14);
    assert.equal(all.upcomingPromotions.length, 1);
    assert.equal(all.latestPromotions.find(p => p.store === "gog").gogRating, 4.5);
    record("all three stores, independent identities, GOG rating and upcoming Epic");
    await open("popup.html");
    for (const [store, total] of [["epic",1],["gog",1],["steam",10]]) {
      await set("#store-filter", store);
      await waitFor(driver, total => document.querySelectorAll(".promotion-item").length === total, total);
    }
    await set("#store-filter", "gog");
    await waitFor(driver, () => document.querySelector('.store-tag')?.textContent === "GOG");
    assert.equal(await (await css("a.primary-button")).getAttribute("href"), "https://www.gog.com/en/");
    assert.match(await text(".promotion-item"), /4[.,]5/);
    record("popup store filters, GOG rating text and correct claim destination");

    await open("options.html#filters");
    for (const [genres, platforms, minRating, expected] of [
      ["Action",["windows"],0,13], ["Action",["linux"],0,12], ["Action",["mac"],0,0],
      ["RPG",["windows"],0,0], ["",[],90,2], ["",[],0,14],
    ]) {
      await set("#genres", genres);
      for (const platform of ["windows","mac","linux"]) await set(`#platform-${platform}`, platforms.includes(platform));
      await set("#minRating", minRating); await save();
      assert.equal((await data()).visiblePromotions.length, expected);
      record(`combined filters: ${genres || "all"}/${platforms.join(",") || "all"}/rating ${minRating}`);
    }
    await set("#minReviews", 101); await save();
    assert.equal((await data()).visiblePromotions.length,2);
    await set("#minReviews",0); await save();
    await section("advanced"); await set("#blockedAppIds", "100"); await set("#blockedKeywords", "giveaway 101"); await save();
    assert.equal((await data()).visiblePromotions.length,12);
    await set("#blockedAppIds", ""); await set("#blockedKeywords", ""); await save();
    record("review-count, Steam-ID and title exclusions");

    // Save all ordinary options through the real form, including hidden sections.
    await section("notifications");
    await set("#remindersEnabled",false); await set("#reminderHours",6);
    await set("#quietHoursEnabled",true); await set("#quietHoursStart","22:00"); await set("#quietHoursEnd","07:00");
    await section("history-settings");
    await set("#historyEnabled",false); await set("#historyRetentionDays",60);
    await section("advanced"); await set("#renotifyAfterRetention",false); await set("#notifiedRetentionDays",30); await save();
    const changed=(await data()).settings;
    for(const [key,value] of Object.entries({remindersEnabled:false,reminderHours:6,quietHoursEnabled:true,quietHoursStart:"22:00",quietHoursEnd:"07:00",historyEnabled:false,historyRetentionDays:60,renotifyAfterRetention:false,notifiedRetentionDays:30}))assert.equal(changed[key],value);
    await send(driver,"SAVE_SETTINGS",{settings:{historyEnabled:true,quietHoursEnabled:false,remindersEnabled:true,reminderHours:3}});
    record("reminder, quiet-hour, history and retention controls persist");

    await bg("failEpic",true); await send(driver,"CHECK_NOW");
    all=await data(); assert.equal(all.runtimeState.lastCheckOutcome,"partial");
    assert.equal(all.latestPromotions.find(p=>p.store==="epic").stale,true);
    assert.equal(all.diagnostics.storeResults.gog.ok,true);
    await bg("failEpic",false); await send(driver,"CHECK_NOW");
    assert.equal((await data()).runtimeState.lastCheckOutcome,"success");
    record("source failure retains stale offers, other stores succeed, recovery clears failure");

    await open("history.html");
    await set("#search","Test game");
    await waitFor(driver,()=>document.querySelectorAll("#history-body tr").length===2);
    await set("#store-filter","gog");
    await waitFor(driver,()=>document.querySelectorAll("#history-body tr").length===1);
    assert.match(await text("#history-body"),/4[.,]5/);
    await click("#history-body button");
    await set("#status-filter","claimed");
    await waitFor(driver,()=>document.querySelectorAll("#history-body tr").length===1);
    await click("#history-body button");
    await waitFor(driver,()=>document.querySelectorAll("#history-body tr").length===0);
    record("history search, store/status filters, ratings, claim and restore");

    await open("options.html#notifications");
    await bg("testNotifications",[]);
    for(let n=0;n<2;n++){
      await click("#test-notification");
      await waitFor(driver,()=>!document.querySelector("#test-notification").disabled && document.querySelector("#notification-test-status").textContent.length>0);
    }
    let logs=await notificationLog(); assert.equal(logs.length,2); assert.notEqual(logs[0].id,logs[1].id);
    assert.ok(logs[1].at-logs[0].at>=950); assert.match(logs[0].options.message,/94%/);
    assert.match(logs[0].options.message,/19\.99/); assert.equal(logs[0].options.type,"basic");
    assert.deepEqual(Object.keys(logs[0].options).sort(),["iconUrl","message","title","type"]);
    record("repeated notification preview preserves price, deadline, rating and fresh IDs");
    await bg("testPermissionDenied",true); await click("#test-notification");
    await waitFor(driver,()=>!document.querySelector("#test-notification").disabled);
    assert.equal((await notificationLog()).length,2);
    assert.match(await text("#notification-test-status"),/block|permission|disabled/i);
    await bg("testPermissionDenied",false); await bg("testNotificationFailure",true); await click("#test-notification");
    await waitFor(driver,()=>!document.querySelector("#test-notification").disabled);
    await bg("testNotificationFailure",false); await click("#test-notification");
    await waitFor(driver,async()=> (await browser.runtime.getBackgroundPage()).testNotifications.length===3);
    record("notification permission denial, OS failure and retry feedback");

    const savedState=await readStorage();
    await writeStorage({notifiedPromotions:{},latestPromotions:[],history:[],userActions:{}});
    await send(driver,"SAVE_SETTINGS",{settings:{notificationsEnabled:true}}); await bg("testNotifications",[]);
    await send(driver,"CHECK_NOW");
    logs=await notificationLog(); assert.equal(logs.length,4);
    await send(driver,"CHECK_NOW"); assert.equal((await notificationLog()).length,4);
    assert.ok(logs.every(n=>n.options.type==="basic"));
    record("three giveaway alerts plus summary, recorded only once per campaign");
    const links=(await readStorage()).notificationLinks;
    const handles=await driver.getAllWindowHandles();
    const current=await driver.getWindowHandle();
    await evaluate(driver,async id=>{const b=await browser.runtime.getBackgroundPage();b.testClosed[0](id);b.testClicked[0](id);},logs[0].id);
    await driver.wait(async()=> (await driver.getAllWindowHandles()).length>handles.length,10000);
    const opened=(await driver.getAllWindowHandles()).find(h=>!handles.includes(h));
    // A real store may redirect a fixture ID to a different canonical product.
    // Assert the requested destination before the store's own navigation.
    const requested=await evaluate(driver,async()=> (await browser.runtime.getBackgroundPage()).testOpenedTabs.at(-1));
    assert.equal(requested.url,links[logs[0].id].url);
    await driver.switchTo().window(opened);
    await driver.close(); await driver.switchTo().window(current);
    record("Firefox close-before-click event order preserves the store destination");
    await writeStorage(savedState);
    await send(driver,"SAVE_SETTINGS",{settings:{notificationsEnabled:false}});

    // Exercise a real alarm rather than invoking the production listener directly.
    const before=(await data()).runtimeState.lastCheckStartedAt;
    await evaluate(driver,()=>browser.alarms.create("steam-promo-check",{when:Date.now()+250}));
    await waitFor(driver,async before=>{const {runtimeState}=await browser.storage.local.get("runtimeState");return runtimeState.lastCheckStartedAt>before&&!runtimeState.checkInProgress;},before);
    assert.equal((await data()).runtimeState.lastTrigger,"scheduled");
    record("actual Firefox alarm runs a scan and reschedules");
    await checkFirefoxRuntime(driver,record,extension);

    await open("options.html#backup");
    const beforeFiles=new Set(await readdir(join(out,"downloads")));
    await click("#export-backup");
    let file;
    await driver.wait(async()=>{file=(await readdir(join(out,"downloads"))).find(n=>!beforeFiles.has(n)&&n.endsWith(".json"));return !!file;},15000);
    const full=JSON.parse(await readFile(join(out,"downloads",file),"utf8"));
    assert.equal(full.version,3); assert.equal(full.history.length,14);
    record("actual JSON download includes version-3 history backup");
    const backupPath=join(out,"import.json");
    const imported={...full,history:[...full.history,{...full.history[0],stableId:"gog:987654",id:"gog:987654|free-to-keep",campaignId:"gog:987654|free-to-keep",fingerprint:"gog:987654|free-to-keep",title:"Imported archive",store:"gog",url:"https://www.gog.com/",status:"expired",endsAt:Date.now()-1000}],userActions:{"gog:987654":{claimed:true,title:"Imported archive"}}};
    await writeFile(backupPath,JSON.stringify(imported));
    const upload=async()=>{await (await css("#import-backup")).sendKeys(backupPath);await waitFor(driver,()=>!document.querySelector("#backup-preview").hidden);};
    await upload(); assert.equal((await data()).historyEntries.some(p=>p.stableId==="gog:987654"),false);
    await click("#cancel-backup");
    await upload(); await click("#apply-backup"); await driver.switchTo().alert().accept();
    await waitFor(driver,()=>document.querySelector("#backup-preview").hidden);
    assert.equal((await data()).historyEntries.filter(p=>p.stableId==="gog:987654").length,1);
    await upload(); await click("#apply-backup"); await driver.switchTo().alert().accept();
    await waitFor(driver,()=>document.querySelector("#backup-preview").hidden);
    assert.equal((await data()).historyEntries.filter(p=>p.stableId==="gog:987654").length,1);
    record("backup preview/cancel, confirmed import and duplicate-free reimport");
    await writeFile(backupPath,"{broken"); await (await css("#import-backup")).sendKeys(backupPath);
    await waitFor(driver,()=>document.querySelector("#import-backup").value==="");
    assert.equal((await data()).historyEntries.filter(p=>p.stableId==="gog:987654").length,1);
    record("invalid backup is rejected without modifying history");

    await open("options.html#diagnostics");
    const origin="https://api.egdata.app/*";
    assert.equal(await evaluate(driver,origin=>browser.permissions.remove({origins:[origin]}),origin),true);
    await waitFor(driver,()=>!document.querySelector("#host-permissions-warning").hidden);
    assert.ok((await data()).missingHostPermissions.includes(origin));
    record("revoked host access is shown in diagnostics");
    // Permission restoration is checked through Firefox's real prompt below.
    await click("#restore-host-permissions");
    await driver.setContext("chrome");
    await driver.wait(()=>driver.executeScript("return !!document.getElementById('addon-webext-permissions-notification') && document.getElementById('notification-popup').state === 'open'"),10000);
    await driver.executeScript("document.querySelector('#addon-webext-permissions-notification').button.click()");
    await driver.setContext("content");
    await waitFor(driver,()=>document.querySelector("#host-permissions-warning").hidden);
    assert.deepEqual((await data()).missingHostPermissions,[]);
    record("restore host access through Firefox permission prompt");

    await open("options.html");
    const alarm=await evaluate(driver,()=>browser.alarms.get("steam-promo-check"));
    for(const language of ["en","ru"]){
      await set("#language",language); await save();
      assert.equal((await evaluate(driver,()=>browser.alarms.get("steam-promo-check"))).scheduledTime,alarm.scheduledTime);
      for(const theme of [0,1]){
        await driver.setContext("chrome"); await driver.executeScript("Services.prefs.setIntPref('ui.systemUsesDarkTheme',arguments[0])",theme); await driver.setContext("content");
        for(const page of ["popup.html","options.html","history.html"]){
          await open(page);
          await waitFor(driver,language=>document.documentElement.lang===language,language);
          assert.equal(await evaluate(driver,()=>document.documentElement.scrollWidth>innerWidth),false);
          await snapshot(`${page.split('.')[0]}-${language}-${theme?'dark':'light'}`);
        }
      }
      await open("options.html");
    }
    record("EN/RU and light/dark screenshots of every page, no overflow, display settings preserve alarms");
    await send(driver,"SAVE_SETTINGS",{settings:{enabledStores:[]}});
    await open("popup.html"); assert.equal(await (await css("#check-now")).isEnabled(),false);
    assert.equal((await evaluate(driver,()=>browser.alarms.getAll())).length,0);
    record("disabling all stores pauses checks and clears alarms");
    await send(driver,"SAVE_SETTINGS",{settings:{enabledStores:["steam","epic","gog"],region:"RU"}});
    assert.equal((await data()).visiblePromotions.length,0); await send(driver,"CHECK_NOW");
    assert.equal((await data()).visiblePromotions.length,14);
    record("region changes discard old regional results and rebuild all stores");
    await open("options.html#history-settings"); await click("#clear-history"); await driver.switchTo().alert().accept();
    await waitFor(driver,async()=>!(await browser.storage.local.get("history")).history.length);
    assert.equal((await data()).latestPromotions.length,14);
    record("clear history preserves live offers");
    await section("advanced"); await click("#reset-settings"); await driver.switchTo().alert().accept();
    await waitFor(driver,()=>document.querySelector("#language").value==="auto");
    assert.equal((await data()).settings.region,"US");
    record("reset settings confirmation and defaults");
  }
  await writeFile(join(out,"results.json"),JSON.stringify({checkedAt:new Date().toISOString(),browser:(await driver.getCapabilities()).get("browserVersion"),checks,live:liveReport},null,2));
  console.log(JSON.stringify({checks:checks.length,out}));
} catch(error) {
  await driver.setContext("content").catch(()=>{});
  await snapshot("failure").catch(()=>{});
  await writeFile(join(out,"failure.json"),JSON.stringify({error:String(error.stack||error),checks,url:await driver.getCurrentUrl().catch(()=>""),body:await evaluate(driver,()=>document.body.innerText).catch(()=>""),state:await readStorage().catch(()=>null)},null,2));
  throw error;
} finally { await driver.quit().catch(()=>{}); }
