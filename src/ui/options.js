import { STORE_IDS, STORE_NAMES, storeOf, storeUrl, enabledStores } from "../lib/stores.js";
import {
  t,
  localize,
  send,
  el,
  button,
  announce,
  date,
  action,
  watch,
  errorText,
} from "./common.js";
import { actionState } from "../lib/actions.js";
import { buildSteamUrlFromStableId } from "../lib/utils.js";
const $ = (id) => document.getElementById(id);
const fields = [
  "region",
  "language",
  "sortBy",
  "compactView",
  "notificationsEnabled",
  "badgeEnabled",
  "remindersEnabled",
  "reminderHours",
  "trackFreeToKeep",
  "checkIntervalMinutes",
  "quietHoursEnabled",
  "quietHoursStart",
  "quietHoursEnd",
  "historyEnabled",
  "historyRetentionDays",
  "renotifyAfterRetention",
  "notifiedRetentionDays",
];
const filters = [
  "ignoreDlc",
  "ignoreSoundtracks",
  "ignoreDemos",
  "ignoreTools",
  "ignorePackages",
  "minRating",
  "minReviews",
  "includeUnrated",
  "genres",
  "blockedAppIds",
  "blockedKeywords",
];
let dirty = false,
  report = "",
  loaded = false;
function showSection(id) {
  const section =
    document.querySelector(`.settings-section[id="${id}"]`) || $("general");
  document.querySelectorAll(".settings-section").forEach((panel) => {
    panel.hidden = panel !== section;
  });
  document.querySelectorAll("[data-section]").forEach((link) => {
    if (link.dataset.section === section.id)
      link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}
function sectionFromHash() {
  // Match against known IDs rather than inserting arbitrary hash text into a selector.
  const id = location.hash.slice(1);
  const valid = [...document.querySelectorAll(".settings-section")].some(
    (panel) => panel.id === id,
  );
  showSection(valid ? id : "general");
}
window.addEventListener("hashchange", sectionFromHash);
document.querySelectorAll("[data-section]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (location.hash !== link.hash) history.pushState(null, "", link.hash);
    showSection(link.dataset.section);
    window.scrollTo(0, 0);
  });
});
sectionFromHash();
// Reveal invalid controls before native form validation tries to focus them.
let firstInvalid;
$("settings-form").addEventListener(
  "invalid",
  (event) => {
    if (firstInvalid) return;
    firstInvalid = event.target;
    const sectionId = event.target.closest(".settings-section").id;
    showSection(sectionId);
    history.replaceState(null, "", `#${sectionId}`);
    event.target.closest("details")?.setAttribute("open", "");
    setTimeout(() => {
      firstInvalid = null;
    }, 0);
  },
  true,
);
function fill(settings) {
  for (const key of [...fields, ...filters]) {
    const input = $(key),
      value = fields.includes(key) ? settings[key] : settings.filters[key];
    if (input.type === "checkbox") input.checked = value;
    else input.value = Array.isArray(value) ? value.join("\n") : value;
  }
  for (const store of STORE_IDS) $("store-" + store).checked = enabledStores(settings).includes(store);
  for (const p of ["windows", "mac", "linux"])
    $(`platform-${p}`).checked = settings.filters.platforms.includes(p);
  for (const option of $("checkIntervalMinutes").options)
    option.textContent =
      Number(option.value) < 60
        ? t("minutes", { count: option.value })
        : t("hours", { count: Number(option.value) / 60 });
  $("quietHoursEnd").setCustomValidity("");
}
function collect() {
  const read = (key) =>
    $(key).type === "checkbox"
      ? $(key).checked
      : $(key).type === "number" || key === "checkIntervalMinutes"
        ? Number($(key).value)
        : $(key).value;
  return {
    ...Object.fromEntries(fields.map((k) => [k, read(k)])),
    enabledStores: STORE_IDS.filter((store) => $("store-" + store).checked),
    filters: {
      ...Object.fromEntries(filters.map((k) => [k, read(k)])),
      platforms: ["windows", "mac", "linux"].filter(
        (p) => $(`platform-${p}`).checked,
      ),
    },
  };
}
async function refresh() {
  const data = await send("GET_OPTIONS_DATA");
  if (!dirty) {
    await localize(data.settings);
    fill(data.settings);
    $("form-status").textContent = t("saved");
  }
  loaded = true;
  $("app-version").textContent = t("version", {
    value: chrome.runtime.getManifest().version,
  });
  const marks = $("personal-marks");
  marks.replaceChildren();
  for (const [stableId, record] of Object.entries(data.userActions)) {
    const entry = data.latestPromotions.find(
      (e) => e.stableId === stableId,
    ) || { stableId, url: record.url, title: record.title, fingerprint: record.hiddenCampaign };
    const state = actionState(entry, data.userActions);
    if (!state) continue;
    const row = el("article", "ignored-item");
    const link = el("a", "ignored-title", entry.title);
    link.href = storeUrl(entry);
    link.target = "_blank";
    link.rel = "noreferrer";
    row.append(
      link,
      el(
        "span",
        "ignored-meta",
        STORE_NAMES[storeOf(stableId)] + " · " + t(state) +
          (state === "snoozed" ? ` · ${date(record.snoozedUntil)}` : ""),
      ),
      button(t("restore"), () => action(entry, "restore"), "secondary-button"),
    );
    marks.append(row);
  }
  if (!marks.childElementCount) marks.append(el("p", "note", t("noMarks")));
  $("diagnostics-summary").textContent =
    `${t("lastFullCheck")}: ${date(data.runtimeState.lastFullSuccessAt)} · ${t("region")}: ${data.settings.region}`;
  $("source-status").replaceChildren();
  for (const source of data.diagnostics.sources || [])
    $("source-status").append(
      el(
        "li",
        "note",
        `${t(source.id)}: ${t(!source.ok ? "failed" : !source.complete || source.coverageLimited ? "limited" : "complete")} · ${t("lastSuccess")}: ${date(data.diagnostics.storeResults?.[source.store]?.lastSuccessAt)}`,
      ),
    );
  if (!data.diagnostics.sources?.length)
    $("source-status").append(el("li", "note", t("noDiagnostics")));
  $("rejected-list").replaceChildren();
  for (const item of data.diagnostics.rejected || [])
    $("rejected-list").append(
      el("li", "note", `${item.title}: ${t(item.reason)}`),
    );
  report = JSON.stringify(
    {
      version: chrome.runtime.getManifest().version,
      runtime: data.runtimeState,
      diagnostics: data.diagnostics,
    },
    null,
    2,
  );
  $("diagnostics-report").textContent = report;
  $("check-now").disabled =
    data.runtimeState.checkInProgress || !data.settings.trackFreeToKeep;
}
$("settings-form").addEventListener("input", () => {
  $("quietHoursEnd").setCustomValidity(
    $("quietHoursEnabled").checked &&
      $("quietHoursStart").value === $("quietHoursEnd").value
      ? t("quietRange")
      : "",
  );
  dirty = true;
  $("form-status").textContent = t("unsaved");
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loaded) return;
  const submit = event.submitter || $("save-settings");
  submit.disabled = true;
  $("form-status").textContent = t("saving");
  try {
    await send("SAVE_SETTINGS", { settings: collect() });
    dirty = false;
    await refresh();
    $("form-status").textContent = t("saved");
  } catch (e) {
    announce(errorText(e));
  } finally {
    submit.disabled = false;
  }
});
function on(id, handler) {
  $(id).addEventListener("click", async () => {
    $(id).disabled = true;
    try {
      await handler();
    } catch (e) {
      announce(errorText(e));
    } finally {
      $(id).disabled = false;
    }
  });
}
on("test-notification", async () => {
  const status = $("notification-test-status");
  status.textContent = t("testSending");
  try {
    await send("TEST_NOTIFICATION");
    status.textContent = t("testSent");
  } catch (error) {
    status.textContent = errorText(error);
  }
});
on("check-now", async () => {
  await send("CHECK_NOW");
  await refresh();
});
on("clear-history", async () => {
  if (confirm(t("clearConfirm"))) {
    await send("CLEAR_HISTORY");
    announce(t("cleared"));
  }
});
on("reset-settings", async () => {
  if (confirm(t("resetConfirm"))) {
    await send("RESET_SETTINGS");
    dirty = false;
    await refresh();
    announce(t("saved"));
  }
});
on("copy-report", async () => {
  await navigator.clipboard.writeText(report);
  announce(t("copied"));
});
on("export-backup", async () => {
  const result = await send("EXPORT_BACKUP");
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result.data, null, 2)], {
      type: "application/json",
    }),
  );
  const link = el("a");
  link.href = url;
  link.download = "free-games-watcher-backup.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("import-backup").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("invalidBackup");
    const data = await file.text();
    const preview = await send("VALIDATE_BACKUP", { data });
    if (confirm(t("importConfirm", preview))) {
      await send("IMPORT_BACKUP", { data });
      dirty = false;
      await refresh();
      announce(t("imported"));
    }
  } catch (e) {
    announce(errorText(e));
  } finally {
    event.target.value = "";
  }
});
watch(refresh);
refresh().catch((e) => announce(errorText(e)));
