// Actual action-popup sizing; fixtures only, no changes to the installed extension.
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS} from '../src/lib/settings.js';
import {sanitizePromotionEntry} from '../src/lib/history.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out=resolve('dist/card-layout-check'); await mkdir(out,{recursive:true});
const extension=await mkdtemp(join(out,'extension-'));
for(const name of ['manifest.json','src','resources','_locales'])await cp(name,join(extension,name),{recursive:true});
const common={endsAt:Date.now()+36*3600000,unread:true,status:'active',contentType:'game',basePriceFormatted:'$19.99',headerImage:'https://shared.akamai.steamstatic.com/test.png'};
const entries=[
 {...common,stableId:'app:100',title:'A long game title that should be truncated without hiding the New button',reviewTotal:694,reviewPercent:96},
 {...common,stableId:'gog:100',title:'GOG game',gogRating:3.6,gogRatingCount:649,stale:true},
 {...common,stableId:'epic:test:100',title:'Epic game'},
 {...common,stableId:'app:101',title:'No rating, no price, unknown deadline',reviewTotal:0,endsAt:0,basePriceFormatted:'',unread:false},
 {...common,stableId:'app:102',title:'Long price and unavailable data',stale:true,contentType:'soundtrack',basePriceFormatted:'123 456 789,00 KZT',reviewTotal:10,reviewPercent:0},
].map((p,i)=>sanitizePromotionEntry({...p,id:String(i)}));
const data={ok:true,settings:{...DEFAULT_SETTINGS,language:'ru',notificationsEnabled:false},runtimeState:{lastCheckOutcome:'success',lastSuccessAt:Date.now()},visiblePromotions:entries,latestPromotions:entries,upcomingPromotions:[]};
await writeFile(join(extension,'src/service-worker.js'),`globalThis.testData=${JSON.stringify(data)};chrome.runtime.onMessage.addListener((m,s,reply)=>{reply(globalThis.testData);});`);
const results=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<100;n++){if(await fn())return;await pause(50);}throw Error('Popup did not reach expected state');}
for(const scale of [1,1.25]){
 const ctx=await chromium.launchPersistentContext(await mkdtemp(join(out,'profile-')),{channel:'chromium',headless:false,viewport:null,args:[`--force-device-scale-factor=${scale}`,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
  const page=ctx.pages()[0];await page.goto('about:blank');const cdp=await ctx.newCDPSession(page);
  const before=new Set((await cdp.send('Target.getTargets')).targetInfos.map(t=>t.targetId));
  await worker.evaluate(()=>chrome.action.openPopup());let target;
  await until(async()=>{target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/src/ui/popup.html')&&!before.has(t.targetId));return target;});
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});let sequence=0;
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const listener=e=>{if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id!==id)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);};const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error(method+' timeout'));},10000);cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
  const artwork=(await readFile('scripts/fixtures/header.svg')).toString('base64');
  cdp.on('Target.receivedMessageFromTarget',e=>{if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.method==='Fetch.requestPaused')void send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'}],body:artwork}).catch(()=>{});});
  await send('Fetch.enable',{patterns:[{urlPattern:'https://*',resourceType:'Image'}]});
  for(const language of ['ru','en'])for(const compact of [false,true])for(const theme of ['light','dark']){
   await worker.evaluate(({language,compact})=>{globalThis.testData.settings.language=language;globalThis.testData.settings.compactView=compact;},{language,compact});
   await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await send('Page.reload');
   await until(()=>evaluate(`document.documentElement?.lang===${JSON.stringify(language)}&&document.querySelectorAll('.promotion-item').length===5&&document.querySelector('.promotion-list').classList.contains('compact')===${compact}&&innerWidth>=410`));
   const g=await evaluate(`(()=>{const cards=[...document.querySelectorAll('.promotion-item')];return {width:innerWidth,dpr:devicePixelRatio,overflow:document.body.scrollWidth>innerWidth||document.querySelector('.promotion-scroll').scrollWidth>document.querySelector('.promotion-scroll').clientWidth+1,cards:cards.map(c=>{const rect=c.getBoundingClientRect();const tags=[...c.querySelectorAll('.tag')];const title=c.querySelector('.promotion-title');const rating=c.querySelector('.rating-summary');const price=c.querySelector('.base-price-tag');return {height:rect.height,title:title.textContent,titleHint:title.title,titleHeight:title.getBoundingClientRect().height,rating:rating.textContent,ratingHint:rating.title,aria:rating.getAttribute('aria-label'),tagY:tags.map(t=>t.getBoundingClientRect().y),within:tags.every(t=>t.getBoundingClientRect().right<=rect.right),price:price?.textContent,priceHint:price?.title,stale:c.querySelector('.stale-indicator')?.title};})};})()`);
   assert.equal(g.dpr,scale);assert.equal(g.overflow,false);
   assert.ok(Math.max(...g.cards.map(c=>c.height))-Math.min(...g.cards.map(c=>c.height))<0.1,JSON.stringify(g));
   for(const c of g.cards){assert.ok(c.height<=130);assert.equal(c.titleHint,c.title);assert.ok(c.titleHeight<20);assert.ok(c.within);assert.ok(Math.max(...c.tagY)-Math.min(...c.tagY)<0.1);if(c.price)assert.ok(c.priceHint.includes(c.price));}
   assert.match(g.cards[0].rating,/96%/);assert.ok(g.cards[0].ratingHint.includes('694'));assert.equal(g.cards[0].ratingHint,g.cards[0].aria);
   assert.match(g.cards[1].rating,/3[.,]6\/5/);assert.ok(g.cards[1].ratingHint.includes('649'));assert.ok(g.cards[1].stale);
   assert.equal(g.cards.find(c=>c.title==='Epic game').rating,'');assert.equal(g.cards.find(c=>c.title.startsWith('No rating')).rating,'');assert.match(g.cards.find(c=>c.title.startsWith('Long price')).rating,/0%/);
   await evaluate(`globalThis.previousRating=document.querySelector('.rating-summary[tabindex]');previousRating.focus();document.dispatchEvent(new Event('data-refresh'));`);
   await until(()=>evaluate(`document.activeElement!==globalThis.previousRating&&document.activeElement?.dataset.focusKey==='rating'`));
   await writeFile(join(out,`cards-${scale}-${language}-${compact?'compact':'normal'}-${theme}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
   results.push({scale,language,compact,theme,...g});
  }
 }finally{await ctx.close();}
}
await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
console.log(`Passed ${results.length} native popup scenarios; reports: ${out}`);
