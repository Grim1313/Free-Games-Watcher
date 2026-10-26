import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPlan, probeSource } from "./source-audit/core.mjs";

const regions = process.argv.slice(2);
const plan = buildPlan(regions.length ? regions : ["US", "RU"]);
const started = Date.now();
const output = resolve("dist/source-audit", new Date(started).toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const results = [];
// Bound concurrency and total requests; this is a manual audit, never a polling loop.
for (let i = 0; i < plan.length; i += 3) {
  const batch = await Promise.all(plan.slice(i, i + 3).map((spec) => probeSource(spec, started)));
  for (const { result, raw } of batch) {
    if (raw) await writeFile(resolve(output, `${result.id}.json`), raw);
    results.push(result);
    console.log(`${result.id}: ${result.status || "no HTTP"} ${result.outcome} (${result.durationMs} ms)`);
  }
}
const report = { checkedAt: new Date(started).toISOString(), runtime: process.version,
  transport: "Node fetch; default TLS verification; no cookies, tokens or API keys", results };
await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
await writeFile(resolve("dist/source-audit/latest-node.json"), JSON.stringify({ output, ...report }, null, 2));
console.log(`Report: ${output}`);
if (results.some((r) => !["ok", "expected-auth-required"].includes(r.outcome))) process.exitCode = 1;
