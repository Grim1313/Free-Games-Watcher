import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkArtworkInterface({
  context,
  worker,
  page,
  history,
  out,
}) {
  const header = await readFile(
    new URL("./fixtures/header.svg", import.meta.url),
    "utf8",
  );
  const capsule = header.replace(
    'width="460" height="215"',
    'width="462" height="174"',
  );
  const snapshot = await worker.evaluate(() =>
    chrome.storage.local.get(["latestPromotions", "history"]),
  );
  const pattern = "https://shared.akamai.steamstatic.com/artwork-check/**";
  const requested = [];
  const routeHandler = async (route) => {
    const url = route.request().url();
    requested.push(url);
    await route.fulfill(
      url.includes("missing")
        ? { status: 404, body: "" }
        : {
            contentType: "image/svg+xml",
            body: url.includes("capsule") ? capsule : header,
          },
    );
  };
  await context.route(pattern, routeHandler);
  let checks = 0;
  try {
    for (const scenario of ["header", "capsule", "missing", "absent"]) {
      requested.length = 0;
      await worker.evaluate(
        ({ snapshot, scenario }) => {
          const url = `https://shared.akamai.steamstatic.com/artwork-check/${scenario}/`;
          const entries = snapshot.latestPromotions
            .slice(0, 2)
            .map((entry, i) => ({
              ...entry,
              appId: scenario === "absent" ? 0 : entry.appId,
              stableId: scenario === "absent" ? `sub:${i + 1}` : entry.stableId,
              title: [
                "Wide header — uniform thumbnail frame",
                "Capsule fallback — all details retained",
              ][i],
              headerImage:
                scenario === "absent"
                  ? ""
                  : url +
                    (scenario === "header"
                      ? "header.svg"
                      : "missing-header.svg"),
              capsuleImage:
                scenario === "absent"
                  ? ""
                  : url +
                    (scenario === "missing"
                      ? "missing-capsule.svg"
                      : "capsule.svg"),
              screenshotThumbnail: url + "must-not-load-shot.svg",
              screenshotFull: url + "must-not-load-full-shot.svg",
            }));
          return chrome.storage.local.set({
            latestPromotions: entries,
            history: entries,
          });
        },
        { snapshot, scenario },
      );
      for (const [view, selector] of [
        [page, ".promotion-item"],
        [history, "#history-body tr"],
      ]) {
        await view.waitForFunction(
          ({ selector, scenario }) => {
            const rows = [...document.querySelectorAll(selector)];
            if (
              rows.length !== 2 ||
              !rows[0].textContent.includes("Wide header")
            )
              return false;
            return rows.every((row) => {
              const image = row.querySelector(
                ".promotion-image, .history-entry-image",
              );
              if (["absent", "missing"].includes(scenario))
                return !image && row.querySelector(".artwork-missing");
              return (
                image?.complete &&
                image.naturalWidth > 0 &&
                image.src.includes(`/${scenario}/`) &&
                image.src.endsWith(`${scenario}.svg`)
              );
            });
          },
          { selector, scenario },
        );
      }
      for (const theme of ["light", "dark"]) {
        for (const [view, selector, name] of [
          [page, ".promotion-item", "popup"],
          [history, "#history-body tr", "history"],
        ]) {
          await view.emulateMedia({ colorScheme: theme });
          const details = await view.locator(selector).evaluateAll((rows) =>
            rows.map((row) => {
              const link = row.querySelector(
                ".promotion-media, .history-entry-preview",
              );
              const image = link.querySelector("img");
              const bounds = link.getBoundingClientRect();
              return {
                width: bounds.width,
                height: bounds.height,
                fit: image ? getComputedStyle(image).objectFit : null,
                natural: image
                  ? [image.naturalWidth, image.naturalHeight]
                  : null,
                placeholder: !link.querySelector(".artwork-placeholder").hidden,
                accessible: !!link.getAttribute("aria-label"),
                target: link.target,
                href: link.href,
                deadline: !!row.querySelector(".deadline-line"),
                title: !!row.querySelector(".promotion-title, .game-link"),
                buttons: row.querySelectorAll("button").length,
              };
            }),
          );
          for (const detail of details) {
            assert.equal(detail.width, 120);
            assert.equal(detail.height, 56);
            assert.ok(
              detail.accessible &&
                detail.deadline &&
                detail.title &&
                detail.buttons > 0,
            );
            assert.match(detail.href, /^https:\/\/store\.steampowered\.com\//);
            assert.equal(detail.target, "_blank");
            if (["missing", "absent"].includes(scenario)) {
              assert.equal(detail.natural, null);
              assert.equal(detail.placeholder, true);
            } else {
              assert.equal(detail.fit, "cover");
              assert.deepEqual(
                detail.natural,
                scenario === "header" ? [460, 215] : [462, 174],
              );
              assert.equal(detail.placeholder, false);
            }
          }
          checks++;
          await view.screenshot({
            path: join(out, `artwork-${name}-${scenario}-${theme}.png`),
            fullPage: true,
          });
        }
        await history.setViewportSize({ width: 360, height: 800 });
        assert.equal(
          await history.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        checks++;
        await history.screenshot({
          path: join(out, `artwork-history-${scenario}-${theme}-narrow.png`),
          fullPage: true,
        });
        await history.setViewportSize({ width: 1200, height: 800 });
      }
      assert.ok(
        requested.every((url) => !url.includes("shot")),
        "Gallery images must never be requested",
      );
      if (scenario === "header")
        assert.ok(
          requested.every((url) => !url.includes("capsule")),
          "No speculative fallback request",
        );
      if (scenario === "capsule") {
        assert.ok(requested.some((url) => url.includes("missing-header")));
        assert.ok(requested.some((url) => url.endsWith("/capsule.svg")));
      }
      if (scenario === "absent") assert.equal(requested.length, 0);
    }
  } finally {
    await context.unroute(pattern, routeHandler);
    await worker.evaluate(
      (snapshot) => chrome.storage.local.set(snapshot),
      snapshot,
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".promotion-item").length === 10,
    );
  }
  return checks;
}
