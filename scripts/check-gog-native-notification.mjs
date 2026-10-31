import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {parseGogGiveaway} from '../src/lib/providers/gogProvider.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const steam=process.argv.includes('--steam');
const out=resolve(steam?'dist/steam-native-notification':'dist/gog-native-notification');await mkdir(out,{recursive:true});
const ext=await mkdtemp(join(out,'extension-'));
for(const name of ['manifest.json','src','resources','_locales'])await cp(name,join(ext,name),{recursive:true});
const fixture=JSON.parse(await readFile('tests/fixtures/gog-a-new-beginning.json','utf8'));
const promotion=steam ? { stableId:'app:599140', appId:599140, title:'Graveyard Keeper — тест уведомления', promoType:'free-to-keep', reviewPercent:86, reviewTotal:49353, endsAt:Date.now()+2*3600000, url:'https://store.steampowered.com/app/599140/', headerImage:'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg' } : parseGogGiveaway(fixture.section,'US',Date.parse('2026-10-31T12:00Z')).promotion;
await writeFile(join(ext,'src/test-bootstrap.js'),`
import {createPromotionNotifications} from './lib/notifications.js';
globalThis.storeNativeCalls=[];
const nativeCreate=chrome.notifications.create.bind(chrome.notifications);
chrome.notifications.create=async(id,options)=>{const record={id,options,sentAt:new Date().toISOString()};storeNativeCalls.push(record);try{record.result=await nativeCreate(id,options);return record.result;}catch(e){record.error=e.message;throw e;}};
globalThis.sendStoreNative=async(reminder=false,large=false)=>createPromotionNotifications([{...${JSON.stringify(promotion)},...(large?{reviewPercent:100,reviewTotal:12345678}:{}),id:'store-native-check',fingerprint:'store-native-check-'+Date.now()}],{settings:{language:'ru'},reminder});
export const testSeedReady=chrome.storage.local.set({settings:{enabledStores:[],notificationsEnabled:false,language:'ru',region:'US'}});
`);
const workerFile=join(ext,'src/service-worker.js');await writeFile(workerFile,'import {testSeedReady} from "./test-bootstrap.js";\n'+(await readFile(workerFile,'utf8')).replace('const ready = bootstrap();','const ready = testSeedReady.then(bootstrap);'));
const ctx=await chromium.launchPersistentContext(await mkdtemp(join(out,'profile-')),{channel:'chromium',headless:false,viewport:null,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
let worker;try{
 worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 const page=ctx.pages()[0];await page.goto(new URL('ui/options.html#notifications',worker.url()).href);
 console.log(JSON.stringify({ready:true,permission:await worker.evaluate(()=>chrome.notifications.getPermissionLevel()),browser:ctx.browser()?.version()}));
 const lines=createInterface({input:process.stdin});
 for await(const line of lines){const cmd=line.trim();if(cmd==='close')break;if(['send','reminder','large'].includes(cmd))await worker.evaluate(cmd=>globalThis.sendStoreNative(cmd==='reminder',cmd==='large'),cmd);const result=await worker.evaluate(async()=>({calls:globalThis.storeNativeCalls,active:await chrome.notifications.getAll()}));await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
 lines.close();process.stdin.pause();process.stdin.unref?.();
}finally{if(worker)await worker.evaluate(async()=>{for(const {id} of globalThis.storeNativeCalls||[])await chrome.notifications.clear(id);}).catch(()=>{});await ctx.close();}
