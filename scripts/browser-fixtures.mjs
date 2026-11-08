import { epicFeed, gogPage, gogGiveaway } from "../tests/multistore-fixtures.mjs";
export const browserBootstrap = `
const chrome = globalThis.browser ?? globalThis.chrome;
const epicFixture = ${epicFeed.toString()};
const gogPageFixture = ${gogPage.toString()};
const gogGiveawayFixture = ${gogGiveaway.toString()};
const originalFetch = globalThis.fetch;
const count = 12;
const row = i => '<a href="https://store.steampowered.com/app/'+i+'/" class="search_result_row" data-price-final="0"><span class="title">Test giveaway '+i+'</span><div class="discount_original_price">$9.99</div><div class="discount_final_price">$0.00</div></a>';
globalThis.fetch = async (url, options) => {
 url=String(url);
 let payload;
 if(url.includes('freeGamesPromotions')){if(globalThis.failEpic)throw new Error('Epic offline');payload=epicFixture();}
 else if(url.includes('store.epicgames.com/graphql')){if(globalThis.failEpic)throw new Error('Epic offline');payload={data:{Catalog:{searchStore:{elements:[],paging:{total:0}}}}};}
 else if(url.includes('api.egdata.app'))throw new Error('EGData offline in fixture');
 else if(url.includes('sections.gog.com'))payload=url.includes('/sections/')?gogGiveawayFixture():gogPageFixture();
 else if(url.includes('catalog.gog.com'))payload={productCount:0,products:[]};
 else if(url.includes('/search/results/'))payload={total_count:count,results_html:Array.from({length:count},(_,i)=>row(100+i)).join('')};
 else if(url.includes('/api/appdetails')){const id=new URL(url).searchParams.get('appids');payload={[id]:{success:true,data:{name:'Test giveaway '+id,type:'game',genres:[{description:'Action'}],platforms:{windows:true,linux:true},header_image:'https://shared.akamai.steamstatic.com/test.png',price_overview:{initial:999,final:0,initial_formatted:'$9.99'}}}};}
 else if(url.includes('/appreviews/'))payload={success:1,query_summary:{total_reviews:100,total_positive:85,total_negative:15}};
 else if(url.includes('IStoreBrowseService')){const input=JSON.parse(new URL(url).searchParams.get('input_json'));payload={response:{store_items:input.ids.map(({appid})=>({appid,best_purchase_option:{is_free_to_keep:true,free_to_keep_ends:Math.floor(Date.now()/1000)+12*3600}}))}};}
 else if(url.includes('featuredcategories'))payload={specials:{items:[]}};
 else return originalFetch(url,options);
 return new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
};
export const testSeedReady = (async () => { if(!(await chrome.storage.local.get('testSeeded')).testSeeded)await chrome.storage.local.set({testSeeded:true,settings:{enabledStores:['steam'],language:'en',region:'US',notificationsEnabled:false}}); })();
`;
