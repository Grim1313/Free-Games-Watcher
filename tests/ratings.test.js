import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSearchRows,parseSearchReviews} from '../src/lib/providers/steamStoreSearchProvider.js';
import {enrichPromotions} from '../src/lib/providers/enrichmentProvider.js';
import {sanitizePromotionEntry} from '../src/lib/history.js';
import {sanitizeGogRating,sanitizeSteamReviewSummary} from '../src/lib/utils.js';
import {parseGogGiveaway} from '../src/lib/providers/gogProvider.js';
import {readFile} from 'node:fs/promises';
const tooltip = (percent,count) => `<span class="search_review_summary positive" data-tooltip-html="Very Positive&lt;br&gt;${percent}% of the ${count} user reviews for this game are positive."></span>`;
const row = `<a class="search_result_row" href="https://store.steampowered.com/app/785890/" data-price-final="0"><span class="title">Hexologic</span><div class="discount_original_price">$4.99</div><div class="discount_final_price">$0.00</div>${tooltip(96,694)}</a>`;

test('Steam search fallback survives discovery, enrichment failure and storage without invented vote counts', async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('API unavailable');});
 const promotion=parseSearchRows(row)[0];
 const result=await enrichPromotions([promotion],{}, {region:'US'});
 const entry=sanitizePromotionEntry(result.promotions[0]);
 assert.equal(entry.reviewPercent,96);
 assert.equal(entry.reviewTotal,694);
 assert.equal(entry.reviewPositive,0);
 assert.equal(entry.reviewNegative,0);
 assert.equal(entry.gogRating,0);
 assert.equal(sanitizePromotionEntry(entry).reviewPercent,96);
});

test('Steam fallback accepts zero percent and grouped counts but rejects unknown or malformed ratings',()=>{
 assert.equal(parseSearchReviews(tooltip(0,'1,234')).reviewPercent,0);
 assert.equal(parseSearchReviews(tooltip(0,'1,234')).reviewTotal,1234);
 for(const text of [tooltip(101,20),tooltip(90,0),'<span data-tooltip-html="95% of the 10 user reviews for this game are positive."></span>','No user reviews']) assert.deepEqual(parseSearchReviews(text),{});
 assert.equal(sanitizeSteamReviewSummary({reviewPercent:99,reviewTotal:10,reviewNegative:10}).reviewPercent,0);
});

test('fresh API reviews take priority; stale API reviews yield to the current search summary',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('API unavailable');});
 const now=Date.now();
 const cached={region:'US',updatedAt:now,reviewUpdatedAt:now,reviewTotal:10,reviewPositive:8,reviewNegative:2};
 const p=parseSearchRows(row)[0];
 const fresh=await enrichPromotions([p],{'app:785890':cached},{region:'US'});
 assert.equal(fresh.promotions[0].reviewPercent,80);
 const stale=await enrichPromotions([p],{'app:785890':{...cached,reviewUpdatedAt:now-8*86400000}},{region:'US'});
 assert.equal(stale.promotions[0].reviewPercent,96);
});

test('GOG rating retains its own scale through giveaway discovery and history normalization',async()=>{
 const {section}=JSON.parse(await readFile(new URL('./fixtures/gog-a-new-beginning.json',import.meta.url),'utf8'));
 const {promotion}=parseGogGiveaway(section,'US',Date.parse('2026-10-31T12:00Z'));
 const entry=sanitizePromotionEntry(promotion);
 assert.equal(entry.gogRating,3.6);
 assert.equal(entry.gogRatingCount,649);
 assert.equal(entry.reviewTotal,0);
 assert.equal(entry.reviewPercent,0);
 assert.equal(sanitizePromotionEntry(entry).gogRating,3.6);
 assert.equal(sanitizePromotionEntry({...entry,stableId:'epic:test:offer'}).gogRating,0);
 assert.equal(sanitizePromotionEntry({...entry,stableId:'app:785890'}).gogRating,0);
 for(const data of [{gogRating:6,gogRatingCount:10},{gogRating:3.6,gogRatingCount:0},{gogRating:3.6,gogRatingCount:-1},{gogRating:NaN,gogRatingCount:20}]) assert.deepEqual(sanitizeGogRating(data),{gogRating:0,gogRatingCount:0});
});


test('a fresh all-negative API summary replaces old positive counts atomically',async t=>{
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('/appreviews/'))return {ok:true,json:async()=>({success:1,query_summary:{total_positive:0,total_negative:10,total_reviews:10}})};
  throw Error('Other metadata unavailable');
 });
 const cache={'app:785890':{region:'US',updatedAt:Date.now(),reviewUpdatedAt:Date.now()-8*86400000,reviewPositive:8,reviewNegative:2,reviewTotal:10}};
 const {promotions}=await enrichPromotions(parseSearchRows(row),cache,{region:'US'});
 assert.equal(promotions[0].reviewPercent,0);
 assert.equal(promotions[0].reviewPositive,0);
 assert.equal(promotions[0].reviewNegative,10);
 assert.equal(promotions[0].reviewTotal,10);
});
