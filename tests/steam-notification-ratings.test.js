import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './helpers.mjs';
import {createPromotionNotifications} from '../src/lib/notifications.js';
import {MAX_NOTIFICATIONS_PER_BATCH} from '../src/lib/constants.js';
const steam={id:'steam-rating-check',stableId:'app:599140',title:'Steam notification fixture',reviewPercent:86,reviewTotal:49353,headerImage:'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/599140/header.jpg'};

test('Steam alerts and reminders use compact localized headers without losing normal review counts',async t=>{
 const env=environment(t);
 for(const language of ['ru','en'])for(const reminder of [false,true]){
  await createPromotionNotifications([steam],{settings:{language},reminder});
  assert.equal(env.notifications.at(-1).options.contextMessage,language==='ru'?'Steam: 86% · 49\u00a0353 отзывов':'Steam: 86% · 49,353 reviews');
  await createPromotionNotifications([{...steam,reviewPercent:100,reviewTotal:12345678}],{settings:{language},reminder});
  assert.equal(env.notifications.at(-1).options.contextMessage,language==='ru'?'Steam: 100% · 12,3\u00a0млн отзывов':'Steam: 100% · 12.3M reviews');
 }
});

test('Steam rating stays absent for unknown ratings and summaries and survives basic fallback',async t=>{
 const env=environment(t);
 await createPromotionNotifications([{...steam,reviewTotal:0}],{settings:{language:'en'}});
 assert.equal(env.notifications.at(-1).options.contextMessage,undefined);
 await createPromotionNotifications(Array.from({length:MAX_NOTIFICATIONS_PER_BATCH+2},(_,i)=>({...steam,id:String(i)})),{settings:{language:'en'}});
 assert.equal(env.notifications.at(-1).options.contextMessage,undefined);
 const attempts=[];
 t.mock.method(chrome.notifications,'create',async(id,options)=>{attempts.push(options);if(options.type==='image')throw Error('Image not supported');return id;});
 await createPromotionNotifications([steam],{settings:{language:'ru'},reminder:true});
 assert.deepEqual(attempts.map(o=>o.type),['image','basic']);
 assert.equal(attempts[1].contextMessage,'Steam: 86% · 49\u00a0353 отзывов');
});
