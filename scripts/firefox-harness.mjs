import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { mkdir, mkdtemp, cp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

export const ADDON_ID = "free-games-watcher@grim1313";
export const UUID = "56c4b998-053a-4c78-8395-2532c3687acd";
export const BASE_URL = `moz-extension://${UUID}/`;

export async function launchFirefox({ out, extension, headed = false, profile } = {}) {
  await mkdir(out, { recursive: true });
  const options = new firefox.Options();
  if (!headed) options.addArguments("-headless");
  if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
  else if (process.platform === "win32") options.setBinary("C:/Program Files/Mozilla Firefox/firefox.exe");
  if (profile) options.addArguments("-profile", profile);
  options.setPreference("extensions.webextensions.uuids", JSON.stringify({ [ADDON_ID]: UUID }));
  options.setPreference("browser.download.folderList", 2);
  options.setPreference("browser.download.dir", resolve(out, "downloads"));
  options.setPreference("browser.helperApps.neverAsk.saveToDisk", "application/json,application/octet-stream");
  options.setPreference("ui.systemUsesDarkTheme", 0);
  const service = new firefox.ServiceBuilder().addArguments("--allow-system-access");
  const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build();
  try {
    await driver.manage().setTimeouts({ script: 180000, pageLoad: 60000, implicit: 0 });
    const id = await driver.installAddon(extension, true);
    if (id !== ADDON_ID) throw new Error(`Unexpected addon ID: ${id}`);
    return driver;
  } catch (error) {
    await driver.quit();
    throw error;
  }
}

export async function stageFirefox(out, bootstrap = "") {
  await mkdir(out, { recursive: true });
  const extension = await mkdtemp(join(out, "extension-"));
  await cp(resolve("dist/Free-Games-Watcher-Firefox"), extension, { recursive: true });
  if (bootstrap) {
    await writeFile(join(extension, "src/test-bootstrap.js"), bootstrap);
    const entry = join(extension, "src/service-worker.js");
    await writeFile(entry, 'import { testSeedReady } from "./test-bootstrap.js";\n' +
      (await readFile(entry, "utf8")).replace("const ready = bootstrap();", "const ready = testSeedReady.then(bootstrap);"));
  }
  return extension;
}

// Selenium serializes the result through a small envelope so browser rejections
// are failures in Node, never mistaken for a successful undefined result.
export async function evaluate(driver, fn, ...args) {
  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    Promise.resolve().then(() => (${fn.toString()})(...Array.from(arguments).slice(0, -1)))
      .then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error.stack || error) }));
  `, ...args);
  if (!result?.ok) throw new Error(result?.error || "Browser evaluation failed");
  return result.value;
}

export const send = (driver, type, payload = {}) => evaluate(driver,
  async (message) => {
    const result = await browser.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || "Message failed");
    return result;
  }, { type, ...payload });

export async function waitFor(driver, fn, ...args) {
  return driver.wait(() => evaluate(driver, fn, ...args), 20000, fn.toString());
}
