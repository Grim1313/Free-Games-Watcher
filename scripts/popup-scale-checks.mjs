import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkNativePopup } from "./native-popup-checks.mjs";

// Actual Chrome display scaling; assigning a Playwright tab viewport would miss
// the native popup's size limit. Run separately from the full behavioral suite.
export async function checkPopupScales({ chromium, extension, out }) {
  const results = [];
  for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
    const context = await chromium.launchPersistentContext(
      await mkdtemp(join(out, "scale-profile-")),
      {
        channel: "chromium",
        headless: false,
        viewport: null,
        args: [
          `--force-device-scale-factor=${scale}`,
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      },
    );
    try {
      const worker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent("serviceworker"));
      const page = context.pages()[0];
      await page.goto(
        `chrome-extension://${new URL(worker.url()).host}/src/ui/popup.html`,
      );
      await page.waitForFunction(
        () => document.querySelectorAll(".promotion-item").length === 10,
      );
      const checks = await checkNativePopup({
        context,
        worker,
        page,
        out,
        scale,
      });
      results.push({ scale, checks });
      console.log(`Popup at ${scale * 100}%: ${checks} checks passed`);
    } finally {
      await context.close();
    }
  }
  await writeFile(
    join(out, "popup-scale-results.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
  );
}
