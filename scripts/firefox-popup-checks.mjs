import assert from "node:assert/strict";
import { resolve,join } from "node:path";
import { writeFile } from "node:fs/promises";
import { By } from "selenium-webdriver";
import { browserBootstrap } from "./browser-fixtures.mjs";
import { launchFirefox, stageFirefox, BASE_URL, evaluate, send, waitFor } from "./firefox-harness.mjs";

const out=resolve(process.env.FIREFOX_REPORT_DIR||"dist/firefox-popup");
const extension=await stageFirefox(out,browserBootstrap);
const driver=await launchFirefox({out,extension});
const results=[];
try {
  await driver.get(BASE_URL+"src/ui/options.html");
  // Firefox 142 requires a real user gesture for action.openPopup().
  await evaluate(driver,()=>{
    const button=document.createElement('button');button.id='test-open-popup';button.textContent='Open test popup';
    button.style.cssText='position:fixed;top:0;left:0;z-index:9999';
    button.onclick=()=>browser.action.openPopup();document.body.append(button);
  });
  await send(driver,"CHECK_NOW");
  await send(driver,"SAVE_SETTINGS",{settings:{enabledStores:["steam","epic","gog"],compactView:false}});
  await send(driver,"CHECK_NOW");
  const stored=await evaluate(driver,()=>browser.storage.local.get("latestPromotions"));
  assert.equal(stored.latestPromotions.length,14);
  for(const scale of [1,1.25]){
    await driver.setContext("chrome");await driver.executeScript("Services.prefs.setCharPref('layout.css.devPixelsPerPx',arguments[0])",String(scale));await driver.setContext("content");
    for(const language of ["en","ru"]){
      await send(driver,"SAVE_SETTINGS",{settings:{language}});
      for(const theme of [0,1]){
        await driver.setContext("chrome");await driver.executeScript("Services.prefs.setIntPref('ui.systemUsesDarkTheme',arguments[0])",theme);await driver.setContext("content");
        for(const count of [0,2,14]){
          await evaluate(driver,({stored,count})=>browser.storage.local.set({latestPromotions:stored.latestPromotions.slice(0,count)}),{stored,count});
          await driver.findElement(By.id('test-open-popup')).click();
          await waitFor(driver,()=>browser.extension.getViews({type:"popup"}).some(w=>w.document.querySelector("#app-version")?.textContent));
          await waitFor(driver,count=>browser.extension.getViews({type:"popup"})[0]?.document.querySelectorAll('.promotion-item').length===Math.min(10,count),count);
          // Wait for the popup content-driven width to settle after module rendering.
          await evaluate(driver,async()=>{const w=browser.extension.getViews({type:"popup"})[0];await new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)));});
          const layout=await evaluate(driver,()=>{
            const w=browser.extension.getViews({type:"popup"})[0],doc=w.document;
            const bounds=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
            return {width:w.innerWidth,height:w.innerHeight,scrollWidth:doc.documentElement.scrollWidth,
              dark:w.matchMedia('(prefers-color-scheme: dark)').matches,
              actions:[...doc.querySelectorAll('.card-actions')].map(bounds),
              footer:bounds(doc.querySelector('footer')),
              clipped:[...doc.querySelectorAll('.card-actions > *')].filter(el=>el.getBoundingClientRect().right>w.innerWidth+1).length};
          });
          results.push({scale,language,theme:theme?'dark':'light',count,...layout});
          assert.ok(layout.scrollWidth<=layout.width+1,JSON.stringify(results.at(-1)));
          assert.equal(layout.clipped,0,JSON.stringify(results.at(-1)));
          assert.equal(layout.dark,Boolean(theme));
          assert.ok(layout.footer.bottom<=layout.height+1);
          await evaluate(driver,()=>browser.extension.getViews({type:"popup"})[0]?.close());
          await waitFor(driver,()=>browser.extension.getViews({type:"popup"}).length===0);
        }
      }
    }
  }
  await writeFile(join(out,"results.json"),JSON.stringify({browser:(await driver.getCapabilities()).get("browserVersion"),checks:results},null,2));
  console.log(`PASS ${results.length} actual Firefox popup layouts`);
} catch(error){await writeFile(join(out,"failure.json"),JSON.stringify({error:String(error.stack||error),results},null,2));throw error;}
finally{await driver.quit().catch(()=>{});}
