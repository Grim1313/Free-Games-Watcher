// Isolated end-to-end backup UI checks; no real profile or store requests.
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {sanitizePromotionEntry} from '../src/lib/history.js';
import {sanitizeSettings} from '../src/lib/settings.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=resolve('dist/backup-ui-check');await mkdir(out,{recursive:true});
const extension=await mkdtemp(join(out,'extension-'));
for(const name of ['manifest.json','src','resources','_locales'])await cp(name,join(extension,name),{recursive:true});
const settings=sanitizeSettings({language:'ru',trackFreeToKeep:false,notificationsEnabled:false});
const fixture=(stableId,title)=>sanitizePromotionEntry({stableId,title,id:`${stableId}|free-to-keep`,campaignId:`${stableId}|free-to-keep`,fingerprint:`${stableId}|free-to-keep`,status:'expired',firstSeenAt:Date.now()-86400000,lastSeenAt:Date.now()-3600000,endsAt:Date.now()-1000,region:'US'});
const local=fixture('app:123','Local game');
const imported=fixture('gog:456','Imported game');
await writeFile(join(extension,'src/test-bootstrap.js'),`export const testSeedReady=chrome.storage.local.set(${JSON.stringify({schemaVersion:3,settings,history:[local],latestPromotions:[],userActions:{}})});`);
const sw=join(extension,'src/service-worker.js');
await writeFile(sw,'import {testSeedReady} from "./test-bootstrap.js";\n'+(await readFile(sw,'utf8')).replace('const ready = bootstrap();','const ready = testSeedReady.then(bootstrap);'));
const context=await chromium.launchPersistentContext(await mkdtemp(join(out,'profile-')),{channel:'chromium',headless:true,acceptDownloads:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const errors=[],checks=[];
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(new URL('ui/options.html#backup',worker.url()).href);
 await page.waitForFunction(()=>document.documentElement.lang==='ru'&&document.querySelector('#backup-history-count').textContent.includes('1'));
 await worker.evaluate(()=>chrome.alarms.clearAll());
 const saved=await page.locator('#form-status').textContent();
 const download=async()=>{const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#export-backup').click()]);return JSON.parse(await readFile(await file.path(),'utf8'));};
 assert.equal(await page.locator('#backup-scope').inputValue(),'full');
 const full=await download();assert.equal(full.history.length,1);checks.push('full export default');
 await page.locator('#backup-scope').selectOption('settings');const only=await download();assert.equal(only.history,undefined);assert.equal(await page.locator('#form-status').textContent(),saved);checks.push('settings export does not dirty settings');
 const upload=async data=>{await page.locator('#import-backup').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});};
 const input={...full,history:[{...local,title:'Older title'},imported],userActions:{'gog:456':{claimed:true,title:'Imported game'}}};
 const history=()=>worker.evaluate(()=>chrome.storage.local.get(['history','latestPromotions']));
 const original=await history();
 await upload(input);await page.locator('#apply-backup').waitFor();assert.deepEqual(await history(),original);checks.push('preview makes no changes');
 assert.ok((await page.locator('#backup-preview-details').textContent()).includes('2 записей'));
 await page.locator('#cancel-backup').click();assert.equal(await page.locator('#backup-preview').isVisible(),false);assert.deepEqual(await history(),original);checks.push('cancel preview');
 await upload(input);await page.locator('#apply-backup').waitFor();
 for(const language of ['ru','en']){
  await worker.evaluate(async language=>{const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...settings,language}});},language);
  await page.waitForFunction(language=>document.documentElement.lang===language,language);
  for(const theme of ['light','dark']){
   await page.emulateMedia({colorScheme:theme});
   for(const width of [1100,360]){
    await page.setViewportSize({width,height:900});await page.screenshot({path:join(out,`preview-${language}-${theme}-${width}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
  }
 }
 checks.push('preview in both languages/themes at desktop/mobile widths');
 await page.setViewportSize({width:1100,height:900});
 page.once('dialog',d=>d.dismiss());await page.locator('#apply-backup').click();assert.deepEqual(await history(),original);checks.push('cancel final confirmation');
 await page.locator('#backup-restore-history').uncheck();page.once('dialog',d=>d.accept());await page.locator('#apply-backup').click();await page.locator('#backup-preview').waitFor({state:'hidden'});assert.deepEqual(await history(),original);checks.push('unchecked history stays untouched');
 await upload(input);await page.locator('#apply-backup').waitFor();page.once('dialog',d=>d.accept());await page.locator('#apply-backup').click();await page.locator('#backup-preview').waitFor({state:'hidden'});
 let result=await history();assert.equal(result.history.length,2);assert.equal(result.history.find(e=>e.stableId==='app:123').title,'Local game');assert.equal(result.latestPromotions.length,0);checks.push('full merge keeps local duplicates and live list');
 await upload(input);await page.locator('#apply-backup').waitFor();page.once('dialog',d=>d.accept());await page.locator('#apply-backup').click();await page.locator('#backup-preview').waitFor({state:'hidden'});assert.equal((await history()).history.length,2);checks.push('repeated import deduplicates');
 await upload({...only,version:2});await page.locator('#apply-backup').waitFor();assert.equal(await page.locator('#backup-restore-history-label').isVisible(),false);page.once('dialog',d=>d.accept());await page.locator('#apply-backup').click();await page.locator('#backup-preview').waitFor({state:'hidden'});assert.equal((await history()).history.length,2);checks.push('legacy v2 import without history');
 await upload(input);await page.locator('#apply-backup').waitFor();const beforeBad=await history();await upload('{broken');await page.waitForFunction(()=>/Некорректный|Invalid/.test(document.querySelector('#feedback').textContent));assert.equal(await page.locator('#backup-preview').isVisible(),false);assert.deepEqual(await history(),beforeBad);checks.push('bad selection clears old preview without writes');
 assert.deepEqual(errors,[]);await writeFile(join(out,'result.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors}));
}finally{await context.close();}
