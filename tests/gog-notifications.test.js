import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {environment} from './helpers.mjs';
import {createPromotionNotifications} from '../src/lib/notifications.js';
import {parseGogGiveaway} from '../src/lib/providers/gogProvider.js';
import {MAX_NOTIFICATIONS_PER_BATCH} from '../src/lib/constants.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/gog-a-new-beginning.json',import.meta.url),'utf8'));
const {promotion}=parseGogGiveaway(fixture.section,'US',Date.parse('2026-10-31T12:00Z'));
const gog={...promotion,id:'gog:1207659150|free-to-keep',fingerprint:'gog-rating-test'};

test('individual GOG alerts and reminders include localized ratings from a real giveaway response',async t=>{
 const env=environment(t);
 for(const language of ['ru','en'])for(const reminder of [false,true]){
  await createPromotionNotifications([gog],{settings:{language},reminder});
  const {id,options}=env.notifications.at(-1);
  assert.equal(options.contextMessage,language==='ru'?'GOG: 3,6/5 · 649 оценок':'GOG: 3.6/5 · 649 ratings');
  assert.ok(id.includes(reminder?':reminder:':':new:'));
  assert.ok(options.message.startsWith('GOG · '));
 }
});

test('GOG ratings are omitted from summaries, unknown ratings and other stores',async t=>{
 const env=environment(t);
 const batch=Array.from({length:MAX_NOTIFICATIONS_PER_BATCH+2},(_,i)=>({...gog,id:String(i),fingerprint:String(i)}));
 await createPromotionNotifications(batch,{settings:{language:'en'}});
 assert.equal(env.notifications.length,MAX_NOTIFICATIONS_PER_BATCH+1);
 assert.ok(env.notifications.slice(0,-1).every(n=>n.options.contextMessage.includes('3.6')));
 assert.equal(env.notifications.at(-1).options.contextMessage,undefined);
 for(const patch of [{gogRating:0},{gogRating:6},{gogRatingCount:0},{gogRatingCount:-1},{stableId:'epic:test:offer'}]){
  await createPromotionNotifications([{...gog,...patch}],{settings:{language:'ru'}});
  assert.equal(env.notifications.at(-1).options.contextMessage,undefined);
 }
});

test('GOG rating survives the fallback from image to basic OS notification',async t=>{
 environment(t);
 const attempts=[];
 t.mock.method(chrome.notifications,'create',async(id,options)=>{
  attempts.push(options);
  if(options.type==='image')throw Error('Image notifications unsupported');
  return id;
 });
 const delivered=await createPromotionNotifications([gog],{settings:{language:'ru'}});
 assert.equal(delivered.length,1);
 assert.deepEqual(attempts.map(o=>o.type),['image','basic']);
 assert.equal(attempts[1].contextMessage,'GOG: 3,6/5 · 649 оценок');
});
