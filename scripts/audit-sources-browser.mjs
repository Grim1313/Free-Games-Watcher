import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("dist/source-audit");
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, "browser-"));
const extension = join(root, "extension");
await mkdir(join(extension, "scripts/source-audit"), { recursive: true });
await cp(resolve("src"), join(extension, "src"), { recursive: true });
await cp(resolve("scripts/source-audit/core.mjs"), join(extension, "scripts/source-audit/core.mjs"));
await writeFile(join(extension, "manifest.json"), JSON.stringify({
  manifest_version: 3, name: "Anonymous source audit (temporary)", version: "0.0.1",
  host_permissions: ["https://store.steampowered.com/*", "https://store-site-backend-static.ak.epicgames.com/*",
    "https://www.gog.com/*", "https://sections.gog.com/*", "https://catalog.gog.com/*"],
  background: { service_worker: "worker.mjs", type: "module" },
}));
await writeFile(join(extension, "worker.mjs"),
  'import { buildPlan, probeSource } from "./scripts/source-audit/core.mjs";\nglobalThis.sourceAudit = { buildPlan, probeSource };\n');
const context = await chromium.launchPersistentContext(join(root, "profile"), {
  ...(process.env.SOURCE_AUDIT_CHROMIUM ? { executablePath: process.env.SOURCE_AUDIT_CHROMIUM } : { channel: "chromium" }),
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const requests = [];
context.on("request", (request) => {
  const headers = request.headers();
  requests.push({ url: request.url(), cookiePresent: Boolean(headers.cookie), authorizationPresent: Boolean(headers.authorization) });
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
  const cookiesBefore = (await context.cookies()).length;
  const report = await worker.evaluate(async () => {
    const now = Date.now(), plan = globalThis.sourceAudit.buildPlan(), results = [];
    for (const spec of plan) results.push((await globalThis.sourceAudit.probeSource(spec, now)).result);
    return { checkedAt: new Date(now).toISOString(), userAgent: navigator.userAgent, results };
  });
  Object.assign(report, { transport: "Actual Manifest V3 service worker in a fresh isolated Chromium profile",
    cookiesBefore, cookiesAfter: (await context.cookies()).length, requests });
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(output, "latest-browser.json"), JSON.stringify({ output: root, ...report }, null, 2));
  for (const r of report.results) console.log(`${r.id}: ${r.status || "no HTTP"} ${r.outcome}`);
  console.log(`Cookies: ${report.cookiesBefore} -> ${report.cookiesAfter}; observed requests: ${requests.length}`);
  console.log(`Report: ${root}`);
  if (report.results.some((r) => !["ok", "expected-auth-required"].includes(r.outcome))
    || requests.some((r) => r.cookiePresent || r.authorizationPresent)) process.exitCode = 1;
} finally {
  await context.close();
}
