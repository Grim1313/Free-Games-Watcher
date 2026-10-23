import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Action popups use Chrome's content-driven sizing, unlike a tab with an assigned
// viewport. Playwright does not expose this target as a Page, so attach via CDP.
export async function checkNativePopup({ context, worker, page, out, scale }) {
  const artwork = (
    await readFile(new URL("./fixtures/header.svg", import.meta.url))
  ).toString("base64");
  const cdp = await context.newCDPSession(page);
  const snapshot = await worker.evaluate(() =>
    chrome.storage.local.get(["latestPromotions", "settings"]),
  );
  const url = new URL("ui/popup.html", worker.url()).href;
  let checks = 0;
  try {
    for (const language of ["en", "ru"]) {
      for (const theme of ["light", "dark"]) {
        for (const count of scale ? [2] : [0, 2, 12]) {
          await page.bringToFront();
          await worker.evaluate(
            ({ snapshot, language, count, scale }) =>
              chrome.storage.local.set({
                latestPromotions: snapshot.latestPromotions
                  .slice(0, count)
                  .map((entry, i) =>
                    scale
                      ? {
                          ...entry,
                          title: [
                            "Squad Weapon Skins - Recon Team Pack",
                            "Popcorn & Premieren - Ausgehviertel",
                          ][i],
                          contentType: "dlc",
                          reviewTotal: 100000,
                          reviewPositive: 85000,
                          reviewNegative: 15000,
                        }
                      : entry,
                  ),
                settings: {
                  ...snapshot.settings,
                  language,
                  compactView: false,
                  filters: {
                    ...snapshot.settings.filters,
                    ...(scale ? { ignoreDlc: false } : {}),
                  },
                },
              }),
            { snapshot, language, count, scale },
          );
          const existing = new Set(
            (await cdp.send("Target.getTargets")).targetInfos.map(
              (t) => t.targetId,
            ),
          );
          await worker.evaluate(() => chrome.action.openPopup());
          let target;
          await poll(async () => {
            target = (await cdp.send("Target.getTargets")).targetInfos.find(
              (t) => t.url === url && !existing.has(t.targetId),
            );
            return !!target;
          });
          const { sessionId } = await cdp.send("Target.attachToTarget", {
            targetId: target.targetId,
            flatten: false,
          });
          let sequence = 0;
          const send = (method, params = {}) =>
            new Promise((resolve, reject) => {
              const id = ++sequence;
              const cleanup = () => {
                clearTimeout(timer);
                cdp.off("Target.receivedMessageFromTarget", listener);
              };
              const listener = (event) => {
                if (event.sessionId !== sessionId) return;
                const message = JSON.parse(event.message);
                if (message.id !== id) return;
                cleanup();
                if (message.error) reject(new Error(message.error.message));
                else resolve(message.result);
              };
              const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Native popup CDP timeout: ${method}`));
              }, 10000);
              cdp.on("Target.receivedMessageFromTarget", listener);
              cdp
                .send("Target.sendMessageToTarget", {
                  sessionId,
                  message: JSON.stringify({ id, method, params }),
                })
                .catch((error) => {
                  cleanup();
                  reject(error);
                });
            });
          const evaluate = async (expression) => {
            const result = await send("Runtime.evaluate", {
              expression,
              returnByValue: true,
            });
            assert.ok(
              !result.exceptionDetails,
              JSON.stringify(result.exceptionDetails),
            );
            return result.result.value;
          };
          const intercept = (event) => {
            if (event.sessionId !== sessionId) return;
            const message = JSON.parse(event.message);
            if (message.method === "Fetch.requestPaused")
              void send("Fetch.fulfillRequest", {
                requestId: message.params.requestId,
                responseCode: 200,
                responseHeaders: [
                  { name: "Content-Type", value: "image/svg+xml" },
                ],
                body: artwork,
              }).catch(() => {});
          };
          try {
            cdp.on("Target.receivedMessageFromTarget", intercept);
            await send("Fetch.enable", {
              patterns: [
                {
                  urlPattern: "https://*steamstatic.com/*",
                  resourceType: "Image",
                },
              ],
            });
            await send("Page.reload");
            await send("Emulation.setEmulatedMedia", {
              features: [{ name: "prefers-color-scheme", value: theme }],
            });
            await poll(() =>
              evaluate(
                `document.documentElement.lang === ${JSON.stringify(language)} && document.querySelectorAll('.promotion-item').length === ${Math.min(count, 10)} && document.querySelector('.status-panel').dataset.state === 'success'`,
              ),
            );
            // Wait for Chrome's asynchronous autosizing, without overriding it.
            await poll(() =>
              evaluate(
                `innerWidth >= 410 && innerHeight >= ${scale ? 400 : 480}`,
              ),
            );
            if (count)
              await poll(() =>
                evaluate(
                  "[...document.images].every(image => image.complete && image.naturalWidth > 0)",
                ),
              );
            for (const expanded of [false, true]) {
              await evaluate(
                `document.querySelector('.status-panel').open = ${expanded}`,
              );
              await evaluate("document.body.offsetHeight");
              const geometry = await evaluate(`(() => {
                const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
                return { width: innerWidth, height: innerHeight,
                  scale: devicePixelRatio, header: rect('.popup-header'), status: rect('.status-panel summary'),
                  listScrollHeight: document.querySelector('.promotion-scroll').scrollHeight,
                  listClientHeight: document.querySelector('.promotion-scroll').clientHeight,
                  list: rect('.promotion-scroll'), actions: rect('.list-footer'),
                  footer: rect('.footer'), body: rect('body'),
                  horizontalOverflow: document.body.scrollWidth > innerWidth,
                  covers: [...document.querySelectorAll('.promotion-image')].map(image => ({
                    fit: getComputedStyle(image).objectFit, width: image.width, height: image.height,
                    naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
                  })),
                  theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };
              })()`);
              const label = JSON.stringify({
                language,
                theme,
                count,
                expanded,
                scale,
                geometry,
              });
              assert.ok(geometry.width >= 410 && geometry.width <= 425, label);
              assert.ok(
                geometry.height >= (scale ? 400 : 480) &&
                  geometry.height <= 601,
                label,
              );
              assert.ok(geometry.list.height >= (expanded ? 60 : 180), label);
              assert.ok(
                geometry.list.bottom <= geometry.actions.top + 4,
                label,
              );
              assert.ok(
                geometry.actions.bottom <= geometry.footer.top + 1,
                label,
              );
              assert.ok(geometry.footer.bottom <= geometry.height + 1, label);
              assert.ok(!geometry.horizontalOverflow, label);
              assert.equal(geometry.theme, theme, label);
              for (const cover of geometry.covers) {
                assert.equal(cover.fit, "contain", label);
                assert.equal(cover.width, 120, label);
                assert.equal(cover.height, 56, label);
                assert.equal(cover.naturalWidth, 460, label);
                assert.equal(cover.naturalHeight, 215, label);
              }
              assert.ok(
                Math.abs(geometry.header.height - geometry.status.height - 1) <
                  1,
                label,
              );
              if (scale) assert.equal(geometry.scale, scale, label);
              if (count === 2 && (scale ? scale < 1.5 : !expanded))
                assert.ok(
                  geometry.listScrollHeight <= geometry.listClientHeight,
                  label,
                );
              checks++;
              if (count === 2) {
                const screenshot = await send("Page.captureScreenshot");
                await writeFile(
                  join(
                    out,
                    `native-popup-${language}-${theme}${expanded ? "-expanded" : ""}${scale ? `-${scale * 100}` : ""}.png`,
                  ),
                  Buffer.from(screenshot.data, "base64"),
                );
              }
            }
          } finally {
            cdp.off("Target.receivedMessageFromTarget", intercept);
            await cdp.send("Target.closeTarget", { targetId: target.targetId });
            await poll(
              async () =>
                !(await cdp.send("Target.getTargets")).targetInfos.some(
                  (entry) => entry.targetId === target.targetId,
                ),
            );
          }
        }
      }
    }
  } finally {
    await worker.evaluate(
      (snapshot) => chrome.storage.local.set(snapshot),
      snapshot,
    );
    await cdp.detach();
  }
  return checks;
}

async function poll(predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Native popup did not reach its expected state/size");
}
