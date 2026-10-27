import { epicFeed, gogPage, gogGiveaway } from "../tests/multistore-fixtures.mjs";
import { checkMultistore } from "./multistore-ui-checks.mjs";
import { cp, mkdir, readFile, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { checkFocusInterface } from "./focus-ui-checks.mjs";
import { checkNativePopup } from "./native-popup-checks.mjs";
import { checkPopupScales } from "./popup-scale-checks.mjs";
import { checkArtworkInterface } from "./artwork-ui-checks.mjs";

// Optional developer check: npm install --no-save playwright, or set PLAYWRIGHT_MODULE.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const root = resolve("."),
  out = join(root, "dist", "browser-check");
await mkdir(out, { recursive: true });
const extension = await mkdtemp(join(out, "extension-"));
for (const name of ["manifest.json", "src", "resources", "_locales"])
  await cp(join(root, name), join(extension, name), { recursive: true });
const bootstrap = `
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
export const testSeedReady = (async () => { if(!(await chrome.storage.local.get('testSeeded')).testSeeded)await chrome.storage.local.set({testSeeded:true,settings:{language:'en',region:'US',notificationsEnabled:false}}); })();
`;
await writeFile(join(extension, "src", "test-bootstrap.js"), bootstrap);
const sw = join(extension, "src", "service-worker.js");
await writeFile(
  sw,
  'import { testSeedReady } from "./test-bootstrap.js";\n' +
    (await readFile(sw, "utf8")).replace(
      "const ready = bootstrap();",
      "const ready = testSeedReady.then(bootstrap);",
    ),
);
if (process.argv.includes("--popup-scales")) {
  await checkPopupScales({ chromium, extension, out });
  process.exit(0);
}
const profile = await mkdtemp(join(out, "profile-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  acceptDownloads: true,
  downloadsPath: join(out, "downloads"),
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
const errors = [];
let checks = 0;
const headerArtwork = await readFile(
  new URL("./fixtures/header.svg", import.meta.url),
);
try {
  context.on("page", (page) =>
    page.on("pageerror", (e) => errors.push(e.message)),
  );
  await context.route("https://**/*", async (route) => {
    if (/steamstatic\.com|cdn1\.epicgames\.com|images\.gog-statics\.com/.test(route.request().url()))
      await route.fulfill({
        contentType: "image/svg+xml",
        body: headerArtwork,
      });
    else await route.abort();
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`chrome-extension://${id}/src/ui/popup.html`);
  await page.waitForFunction(
    () => document.querySelectorAll(".promotion-item").length === 10,
  );
  assert.equal(await page.locator("#show-all").textContent(), "Show all 12");
  checks++;
  assert.equal(await page.locator("#unread-pill").textContent(), "12 new");
  checks++;
  await page
    .getByRole("button", { name: "Already claimed", exact: true })
    .first()
    .click();
  await page.waitForFunction(
    () => document.querySelector("#show-all").textContent === "Show all 11",
  );
  checks++;
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#show-all").textContent === "Show all 12",
  );
  checks++;
  await page.locator(".new-marker").first().click();
  await page.waitForFunction(
    () => document.querySelector("#unread-pill").textContent === "11 new",
  );
  checks++;
  await page.locator("#compact-view").check();
  await page.waitForFunction(() =>
    document.querySelector("#promotion-list").classList.contains("compact"),
  );
  checks++;
  await page.screenshot({
    path: join(out, "popup-en-light.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: join(out, "popup-en-dark.png"),
    fullPage: true,
  });
  const options = await context.newPage();
  await options.setViewportSize({ width: 1200, height: 900 });
  await options.goto(`chrome-extension://${id}/src/ui/options.html`);
  await options.waitForFunction(
    () => document.querySelector("#region").value === "US",
  );
  await options.locator("#language").selectOption("ru");
  await options
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await options.waitForFunction(() => document.documentElement.lang === "ru");
  checks++;
  await options.locator('[data-section="filters"]').click();
  await options.locator("#minRating").fill("90");
  await options
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".promotion-item").length === 0,
  );
  assert.match(await page.locator("#empty-state").textContent(), /фильтрами/);
  checks++;
  await options.locator("#minRating").fill("0");
  await options
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".promotion-item").length === 10,
  );
  await options.screenshot({
    path: join(out, "options-ru-light.png"),
    fullPage: true,
  });
  const overflowingLabels = await options
    .locator(".settings-grid label")
    .evaluateAll((labels) =>
      labels
        .filter((label) => label.getClientRects().length)
        .filter((label) => {
          const panel = label.closest(".panel").getBoundingClientRect();
          return (
            label.scrollWidth > label.clientWidth + 1 ||
            label.getBoundingClientRect().right > panel.right
          );
        })
        .map((label) => label.textContent.trim()),
    );
  assert.deepEqual(overflowingLabels, []);
  checks++;
  await options.emulateMedia({ colorScheme: "dark" });
  await options.screenshot({
    path: join(out, "options-ru-dark.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(out, "popup-ru-dark.png"),
    fullPage: true,
  });
  const history = await context.newPage();
  await history.setViewportSize({ width: 1200, height: 800 });
  await history.goto(`chrome-extension://${id}/src/ui/history.html#active`);
  await history.waitForFunction(
    () => document.querySelectorAll("#history-body tr").length === 12,
  );
  checks++;
  await history.locator("#search").fill("Test giveaway 100");
  assert.equal(await history.locator("#history-body tr").count(), 1);
  checks++;
  await history
    .getByRole("button", { name: "Уже забрал", exact: true })
    .click();
  await history.waitForFunction(
    () => document.querySelectorAll("#history-body tr").length === 0,
  );
  await history.locator("#status-filter").selectOption("claimed");
  await history.waitForFunction(
    () => document.querySelectorAll("#history-body tr").length === 1,
  );
  checks++;
  await history
    .getByRole("button", { name: "Восстановить", exact: true })
    .click();
  await history.locator("#status-filter").selectOption("all");
  await history.locator("#search").fill("");
  await history.waitForFunction(
    () => document.querySelectorAll("#history-body tr").length === 12,
  );
  await history.screenshot({
    path: join(out, "history-ru-light.png"),
    fullPage: true,
  });
  checks += await checkFocusInterface({
    context,
    worker,
    page,
    options,
    history,
    out,
  });
  checks += await checkArtworkInterface({
    context,
    worker,
    page,
    history,
    out,
  });
  checks += await checkNativePopup({ context, worker, page, out });
  checks += await checkMultistore({ worker, page, options, history, out });
  // Settings used for display must not postpone the scheduled scan.
  const before = await worker.evaluate(
    async () => (await chrome.alarms.get("steam-promo-check")).scheduledTime,
  );
  await options.locator('[data-section="general"]').click();
  await options.locator("#language").selectOption("en");
  await options
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await options.waitForFunction(() => document.documentElement.lang === "en");
  assert.equal(
    await worker.evaluate(
      async () => (await chrome.alarms.get("steam-promo-check")).scheduledTime,
    ),
    before,
  );
  checks++;
  await options.locator("#trackFreeToKeep").uncheck();
  await options
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#status-text").textContent ===
      "Tracking is paused",
  );
  checks++;
  await options.locator("#trackFreeToKeep").check();
  await options
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#status-text").textContent !==
      "Tracking is paused",
  );
  let next = await worker.evaluate(
    async () => (await chrome.alarms.get("steam-promo-check")).scheduledTime,
  );
  assert.ok(next > Date.now() && next <= Date.now() + 31000);
  checks++;
  await options.locator("#region").fill("RU");
  await options
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".promotion-item").length === 0,
  );
  const regional = await worker.evaluate(() =>
    chrome.storage.local.get("runtimeState"),
  );
  assert.equal(regional.runtimeState.lastSuccessAt, 0);
  next = await worker.evaluate(
    async () => (await chrome.alarms.get("steam-promo-check")).scheduledTime,
  );
  assert.ok(next > Date.now() && next <= Date.now() + 31000);
  checks++;
  for (const p of [page, options, history])
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  await writeFile(
    join(out, "focus-results.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        errors,
        node: process.version,
        browser: context.browser()?.version(),
        screenshots: out,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { checks, errors, screenshots: out, extensionId: id },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("UI errors:", errors);
  for (const page of context.pages()) {
    console.error(
      "Page:",
      page.url(),
      (await page.locator("body").innerText()).slice(0, 2500),
    );
    await page
      .screenshot({ path: join(out, "failure.png"), fullPage: true })
      .catch(() => {});
  }
  for (const worker of context.serviceWorkers())
    console.error(
      "Worker state:",
      JSON.stringify(
        await worker.evaluate(() => chrome.storage.local.get(null)),
      ).slice(0, 5000),
    );
  throw error;
} finally {
  await context.close();
}
