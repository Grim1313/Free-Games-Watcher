import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Runs only against the isolated, fixture-backed extension created by browser-smoke.
export async function checkFocusInterface({
  context,
  worker,
  page,
  options,
  history,
  out,
}) {
  let checks = 0;
  const sections = [
    "general",
    "notifications",
    "filters",
    "history-settings",
    "backup",
    "diagnostics",
    "advanced",
  ];
  const selectSection = async (id) => {
    await options.locator(`[data-section="${id}"]`).click();
    await options.waitForFunction(
      (id) => !document.getElementById(id).hidden,
      id,
    );
  };
  const save = async () => {
    await options.locator("#save-settings").click();
    await options.waitForFunction(() =>
      /^(Настройки сохранены|Settings saved)/.test(
        document.getElementById("form-status").textContent,
      ),
    );
  };
  const assertLayout = async (view, popup = false) => {
    const bad = await view.evaluate((popup) => {
      const issues = [];
      if (document.documentElement.scrollWidth > innerWidth)
        issues.push("horizontal overflow");
      if (
        popup &&
        document.querySelector(".footer").getBoundingClientRect().bottom > 581
      )
        issues.push("popup footer outside height limit");
      for (const label of document.querySelectorAll(".field-grid label")) {
        if (!label.getClientRects().length) continue;
        const bounds = label.getBoundingClientRect();
        const text = label.querySelector("span");
        if (label.scrollWidth > label.clientWidth + 1)
          issues.push("overflowing field: " + label.textContent.trim());
        if (
          text &&
          bounds.width > 300 &&
          text.getBoundingClientRect().width < 90
        )
          issues.push("compressed label: " + text.textContent);
      }
      return issues;
    }, popup);
    assert.deepEqual(bad, []);
    checks++;
  };

  // All sections remain reachable in both languages and both appearances.
  for (const locale of ["en", "ru"]) {
    await selectSection("general");
    await options.locator("#language").selectOption(locale);
    await save();
    await page.waitForFunction(
      (locale) => document.documentElement.lang === locale,
      locale,
    );
    await history.waitForFunction(
      (locale) => document.documentElement.lang === locale,
      locale,
    );
    for (const theme of ["light", "dark"]) {
      for (const view of [page, options, history])
        await view.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 410, height: 580 });
      await page.locator("#compact-view").uncheck();
      await page.waitForFunction(
        () =>
          !document
            .getElementById("promotion-list")
            .classList.contains("compact"),
      );
      await page
        .locator(".popup-shell")
        .screenshot({ path: join(out, `focus-popup-${locale}-${theme}.png`) });
      await assertLayout(page, true);
      for (const section of sections) {
        await selectSection(section);
        assert.equal(
          await options.locator(".settings-section:visible").count(),
          1,
        );
        await assertLayout(options);
        if (locale === "ru")
          await options.screenshot({
            path: join(out, `focus-settings-${section}-${theme}.png`),
            fullPage: true,
          });
      }
      await selectSection("general");
      await options.screenshot({
        path: join(out, `focus-settings-${locale}-${theme}.png`),
        fullPage: true,
      });
      await history.screenshot({
        path: join(out, `focus-history-${locale}-${theme}.png`),
        fullPage: true,
      });
      await assertLayout(history);
      // Verify actual computed foreground/background pairs, including blue buttons.
      for (const view of [page, options, history]) {
        const ratios = await view.evaluate(() => {
          const rgb = (s) =>
            s
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number);
          const lum = (color) =>
            rgb(color).reduce((v, n, i) => {
              n /= 255;
              return (
                v +
                (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4) *
                  [0.2126, 0.7152, 0.0722][i]
              );
            }, 0);
          const pairs = [];
          for (const target of document.querySelectorAll(
            ".primary-button, .note, .meta-line",
          )) {
            if (!target.getClientRects().length) continue;
            let current = target,
              bg;
            do {
              bg = getComputedStyle(current).backgroundColor;
              current = current.parentElement;
            } while (bg === "rgba(0, 0, 0, 0)" && current);
            const a = lum(getComputedStyle(target).color),
              b = lum(bg);
            pairs.push((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
          }
          return pairs;
        });
        assert.ok(
          ratios.every((ratio) => ratio >= 4.5),
          `${theme} text contrast: ${ratios}`,
        );
        checks++;
      }
    }
  }

  // Navigating between sections and a background refresh must preserve the draft.
  await selectSection("filters");
  await options.locator("#minReviews").fill("42");
  await selectSection("notifications");
  await worker.evaluate(async () => {
    const { runtimeState } = await chrome.storage.local.get("runtimeState");
    await chrome.storage.local.set({
      runtimeState: { ...runtimeState, lastCheckAt: Date.now() },
    });
  });
  await options.evaluate(() =>
    document.dispatchEvent(new Event("data-refresh")),
  );
  await selectSection("filters");
  assert.equal(await options.locator("#minReviews").inputValue(), "42");
  checks++;

  // Native validation reveals a bad control in an inactive section.
  await options.locator("#minRating").fill("101");
  await selectSection("general");
  await options.locator("#save-settings").click();
  await options.waitForFunction(
    () => document.activeElement.id === "minRating",
  );
  assert.equal(await options.locator("#filters").isVisible(), true);
  checks++;
  await options.locator("#minRating").fill("0");
  await options.locator("#minReviews").fill("0");
  await selectSection("notifications");
  await options.locator("#quietHoursEnabled").check();
  await options.locator("#quietHoursStart").fill("23:00");
  await options.locator("#quietHoursEnd").fill("23:00");
  await selectSection("general");
  await options.locator("#save-settings").click();
  await options.waitForFunction(
    () => document.activeElement.id === "quietHoursEnd",
  );
  checks++;
  await options.locator("#quietHoursEnabled").uncheck();
  await options.locator("#quietHoursEnd").fill("08:00");
  await save();

  // Icon-button focus survives a data rerender, even if the New button disappears.
  await page.locator('.icon-action[data-focus-key="snooze"]').first().focus();
  const activeLabel = await page.evaluate(
    () => document.activeElement.getAttribute("aria-label"),
  );
  const previousRow = await page
    .locator(".promotion-item")
    .first()
    .elementHandle();
  await worker.evaluate(async () => {
    const { latestPromotions } =
      await chrome.storage.local.get("latestPromotions");
    await chrome.storage.local.set({
      latestPromotions: latestPromotions.map((entry) => ({
        ...entry,
        unread: false,
        lastCheckedAt: Date.now(),
      })),
    });
  });
  await page.waitForFunction((row) => !row.isConnected, previousRow);
  await previousRow.dispose();
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
    activeLabel,
  );
  assert.equal(await page.locator(".more-actions").count(), 0);
  checks++;

  // All secondary actions and undo still travel through the real service worker.
  for (const label of [
    "Отложить на 24 часа",
    "Скрыть эту раздачу",
    "Игнорировать игру",
  ]) {
    await page
      .getByRole("button", { name: label, exact: true })
      .first()
      .click();
    await page.waitForFunction(
      () =>
        document.getElementById("show-all").textContent === "Показать все: 11",
    );
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.getElementById("show-all").textContent === "Показать все: 12",
    );
    checks++;
  }

  // Removing a compact row must not focus its invisible artwork link.
  await page.locator("#compact-view").check();
  await page.waitForFunction(() =>
    document.getElementById("promotion-list").classList.contains("compact"),
  );
  await page
    .getByRole("button", { name: "Уже забрал", exact: true })
    .first()
    .click();
  await page.waitForFunction(
    () =>
      document.getElementById("show-all").textContent === "Показать все: 11",
  );
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.classList.contains("promotion-title"),
    ),
    true,
  );
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.getElementById("show-all").textContent === "Показать все: 12",
  );
  await page.locator("#compact-view").uncheck();
  checks++;

  // Backup export/import uses the visible controls and browser confirmation.
  await page.waitForFunction(async () => {
    const data = await chrome.runtime.sendMessage({ type: "GET_POPUP_DATA" });
    return !data.settings.compactView && !document.getElementById("promotion-list").classList.contains("compact");
  });
  await selectSection("backup");
  const [download] = await Promise.all([
    options.waitForEvent("download"),
    options.locator("#export-backup").click(),
  ]);
  const backup = await readFile(await download.path(), "utf8");
  assert.ok(JSON.parse(backup));
  checks++;
  await options.locator("#import-backup").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await options.waitForFunction(() =>
    /Некорректный|Неподдерживаемая/.test(
      document.getElementById("feedback").textContent,
    ),
  );
  checks++;
  options.once("dialog", (dialog) => dialog.accept());
  await options.locator("#import-backup").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await options.locator("#apply-backup").click();
  await options.waitForFunction(() =>
    document.getElementById("feedback").textContent.includes("импортирована"),
  );
  checks++;

  // Narrow settings/history and a popup constrained by available screen height.
  await options.setViewportSize({ width: 360, height: 800 });
  await history.setViewportSize({ width: 360, height: 800 });
  await page.setViewportSize({ width: 410, height: 480 });
  for (const section of sections) {
    await selectSection(section);
    await assertLayout(options);
  }
  await page.locator(".status-panel summary").click();
  await assertLayout(page, true);
  await page.locator(".status-panel summary").click();
  await assertLayout(history);
  await page
    .locator(".popup-shell")
    .screenshot({ path: join(out, "focus-popup-short.png") });
  await history.screenshot({
    path: join(out, "focus-history-narrow.png"),
    fullPage: true,
  });
  await selectSection("general");
  await options.screenshot({
    path: join(out, "focus-settings-narrow.png"),
    fullPage: true,
  });
  await options.setViewportSize({ width: 1200, height: 900 });
  await history.setViewportSize({ width: 1200, height: 800 });
  await page.setViewportSize({ width: 410, height: 580 });

  // Empty, initial, failed, partial and stale states keep status and navigation usable.
  const snapshot = await worker.evaluate(() =>
    chrome.storage.local.get(["latestPromotions", "runtimeState"]),
  );
  for (const state of ["empty", "initial", "error", "partial"]) {
    await worker.evaluate(
      async ({ snapshot, state }) => {
        const runtime = {
          ...snapshot.runtimeState,
          checkInProgress: false,
          lastCheckOutcome:
            state === "error"
              ? "error"
              : state === "partial"
                ? "partial"
                : "success",
        };
        if (state === "initial") runtime.lastSuccessAt = 0;
        const offers = ["empty", "initial"].includes(state)
          ? []
          : snapshot.latestPromotions.map((entry) => ({
              ...entry,
              stale: true,
            }));
        await chrome.storage.local.set({
          runtimeState: runtime,
          latestPromotions: offers,
        });
      },
      { snapshot, state },
    );
    if (["empty", "initial"].includes(state))
      await page.waitForFunction(
        () =>
          !document.getElementById("empty-state").classList.contains("hidden"),
      );
    else
      await page.waitForFunction(
        () =>
          !document.getElementById("warning-box").classList.contains("hidden"),
      );
    await page.waitForFunction((state) => {
      const expected =
        state === "initial" ? "pending" : state === "empty" ? "success" : state;
      return document.querySelector(".status-panel").dataset.state === expected;
    }, state);
    await assertLayout(page, true);
    await page
      .locator(".popup-shell")
      .screenshot({ path: join(out, `focus-popup-${state}.png`) });
  }
  await worker.evaluate(
    (snapshot) => chrome.storage.local.set(snapshot),
    snapshot,
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".promotion-item").length === 10,
  );
  await selectSection("general");
  return checks;
}
