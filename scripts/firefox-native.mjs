// Headed, isolated native notification verification. Commands: send, status, close.
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { launchFirefox, stageFirefox, evaluate, send, BASE_URL } from "./firefox-harness.mjs";
const out=resolve("dist/firefox-native");
const extension=await stageFirefox(out,`export const testSeedReady=(async()=>{if(!(await browser.storage.local.get('testSeeded')).testSeeded)await browser.storage.local.set({testSeeded:true,settings:{language:'ru',trackFreeToKeep:false,notificationsEnabled:false}});})();`);
const driver=await launchFirefox({out,extension,headed:true});
const results=[];
try {
  await driver.get(BASE_URL+"src/ui/options.html#notifications");
  console.log("Ready: send / status / close");
  for await(const command of createInterface({input:process.stdin})) {
    if(command.trim()==="close") break;
    if(command.trim()==="send") {
      const result=await send(driver,"TEST_NOTIFICATION");
      results.push({at:new Date().toISOString(),result});
      console.log(JSON.stringify(results.at(-1)));
    }
    if(command.trim()==="status") console.log(await evaluate(driver,()=>browser.notifications.getAll()));
  }
} finally {
  await evaluate(driver,async()=>{for(const id of Object.keys(await browser.notifications.getAll()))await browser.notifications.clear(id);}).catch(()=>{});
  await writeFile(resolve(out,"results.json"),JSON.stringify(results,null,2));
  await driver.quit();
}
