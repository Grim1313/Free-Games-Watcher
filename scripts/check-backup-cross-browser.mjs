import assert from "node:assert/strict";
import { chromium } from "playwright";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { sanitizePromotionEntry } from "../src/lib/history.js";
import { sanitizeSettings } from "../src/lib/settings.js";
import { launchFirefox, stageFirefox, BASE_URL, send } from "./firefox-harness.mjs";

const out=resolve("dist/cross-browser-backup"); await mkdir(out,{recursive:true});
const settings=sanitizeSettings({language:"ru",trackFreeToKeep:false,notificationsEnabled:false});
const history=["app:123","epic:namespace:offer","gog:456"].map((stableId,i)=>sanitizePromotionEntry({stableId,
  id:`${stableId}|free-to-keep`,campaignId:`${stableId}|free-to-keep`,fingerprint:`${stableId}|free-to-keep`,
  title:`Transferred ${i}`,status:"expired",region:"US",firstSeenAt:Date.now()-86400000,lastSeenAt:Date.now()-3600000,endsAt:Date.now()-1000}));
const userActions=Object.fromEntries(history.map(p=>[p.stableId,{claimed:true,title:p.title}]));
const chromeExtension=await mkdtemp(join(out,"chromium-"));
for(const name of ["manifest.json","src","resources","_locales"])await cp(name,join(chromeExtension,name),{recursive:true});
await writeFile(join(chromeExtension,"src/test-bootstrap.js"),`export const testSeedReady=chrome.storage.local.set(${JSON.stringify({schemaVersion:3,settings,history,userActions})});`);
const entry=join(chromeExtension,"src/service-worker.js");
await writeFile(entry,'import {testSeedReady} from "./test-bootstrap.js";\n'+(await readFile(entry,"utf8")).replace("const ready = bootstrap();","const ready = testSeedReady.then(bootstrap);"));
const firefoxExtension=await stageFirefox(out,`export const testSeedReady=browser.storage.local.set(${JSON.stringify({schemaVersion:3,settings,history:[],userActions:{}})});`);
const context=await chromium.launchPersistentContext(await mkdtemp(join(out,"chrome-profile-")),{channel:"chromium",headless:true,args:[`--disable-extensions-except=${chromeExtension}`,`--load-extension=${chromeExtension}`]});
let driver;
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");
  const page=await context.newPage(); await page.goto(new URL("ui/options.html",worker.url()).href);
  await page.waitForFunction(()=>!!document.querySelector("#app-version").textContent);
  const chromeSend=message=>page.evaluate(message=>chrome.runtime.sendMessage(message),message);
  const backup=await chromeSend({type:"EXPORT_BACKUP",includeHistory:true}); assert.equal(backup.ok,true);
  driver=await launchFirefox({out,extension:firefoxExtension}); await driver.get(BASE_URL+"src/ui/options.html");
  await send(driver,"IMPORT_BACKUP",{data:JSON.stringify(backup.data),includeHistory:true});
  const imported=await send(driver,"GET_OPTIONS_DATA");
  assert.equal(imported.historyEntries.length,3); assert.equal(Object.keys(imported.userActions).length,3);
  assert.equal(imported.settings.language,"ru"); assert.ok(imported.historyEntries.every(p=>p.importedAt&&!p.unread));
  const returned=await send(driver,"EXPORT_BACKUP",{includeHistory:true});
  const importBack=await chromeSend({type:"IMPORT_BACKUP",data:JSON.stringify(returned.data),includeHistory:true});
  assert.equal(importBack.ok,true);
  const restored=await chromeSend({type:"GET_OPTIONS_DATA"});
  assert.equal(restored.historyEntries.length,3); assert.equal(Object.keys(restored.userActions).length,3);
  for(const version of [1,2]){
    await send(driver,"IMPORT_BACKUP",{data:{format:"steam-promo-watch",version,settings,userActions},includeHistory:true});
    assert.equal((await send(driver,"GET_OPTIONS_DATA")).historyEntries.length,3);
  }
  await writeFile(join(out,"results.json"),JSON.stringify({checks:["Chromium to Firefox: all-store history and marks","Imported history is read and guarded","Firefox to Chromium: no duplicate history","Legacy backup v1","Legacy backup v2"],firefox:(await driver.getCapabilities()).get("browserVersion")},null,2));
  console.log("PASS 5 cross-browser backup checks");
} finally {await driver?.quit().catch(()=>{});await context.close();}
