import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function firefoxManifest(base) {
  const manifest = structuredClone(base);
  delete manifest.minimum_chrome_version;
  manifest.background = { scripts: [base.background.service_worker], type: "module" };
  manifest.browser_specific_settings = {
    gecko: {
      id: "free-games-watcher@grim1313",
      strict_min_version: "142.0",
      // Selected store country and the existing Steam age-gate cookie fallback.
      // See docs/FIREFOX.md for the exact request/data inventory.
      data_collection_permissions: { required: ["locationInfo", "websiteContent"] },
    },
  };
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  if (!process.argv[2]) throw new Error("Expected output manifest path");
  await writeFile(process.argv[2], JSON.stringify(firefoxManifest(base), null, 2) + "\n");
}
