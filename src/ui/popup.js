import { enabledStores } from "../lib/stores.js";
import {
  t,
  localize,
  send,
  el,
  button,
  announce,
  date,
  deadline,
  storeLink,
  storeOf,
  STORE_NAMES,
  artwork,
  ratingSummary,
  action,
  sortEntries,
  watch,
  errorText,
  preserveListInteraction,
} from "./common.js";
const $ = (selector) => document.querySelector(selector);
const ACTION_ICONS = {
  snooze: ["M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0", "M12 7v5l3 2"],
  hide: ["m3 3 18 18", "M10.6 10.6a2 2 0 0 0 2.8 2.8", "M9.9 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a19 19 0 0 1-3 3.8", "M6.2 6.2A21 21 0 0 0 2 12s4 7 10 7a10 10 0 0 0 5-1.4"],
  ignore: ["m3 3 18 18", "M10 4.3a5 5 0 0 1 7 4.6V12", "M7 7v5l-2 5h12", "M10 21h4"],
};
function tooltip(control, label, key) {
  control.classList.add("tooltip-action");
  control.dataset.tooltip = label;
  control.dataset.focusKey = key;
  control.setAttribute("aria-label", label);
  return control;
}
function iconAction(entry, key) {
  const control = tooltip(button("", () => action(entry, key), "ghost-button icon-action"), t(key), key);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ACTION_ICONS[key]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  control.append(svg);
  return control;
}
let refreshId = 0;
async function refresh() {
  const id = ++refreshId;
  const data = await send("GET_POPUP_DATA");
  if (id !== refreshId) return;
  await localize(data.settings);
  if (id !== refreshId) return;
  const state = data.runtimeState;
  const paused = !data.settings.trackFreeToKeep || !enabledStores(data.settings).length;
  $("#app-version").textContent = t("version", {
    value: chrome.runtime.getManifest().version,
  });
  $("#check-now").disabled =
    state.checkInProgress || paused;
  $("#status-text").textContent = paused
    ? t("paused")
    : state.checkInProgress
      ? t("checking")
      : state.lastCheckOutcome === "error"
        ? t("failed")
        : state.lastSuccessAt
          ? t("activeCount", { count: data.visiblePromotions.length })
          : t("firstCheck");
  $("#last-success").textContent = date(state.lastSuccessAt);
  $("#next-check").textContent = state.nextCheckAt
    ? date(state.nextCheckAt)
    : t("notScheduled");
  $("#status-region").textContent = data.settings.region;
  $(".status-panel").dataset.state = paused
    ? "paused"
    : !state.lastSuccessAt && state.lastCheckOutcome !== "error"
      ? "pending"
      : state.lastCheckOutcome;
  $("#quiet-status").textContent = state.pendingQuietCount
    ? t("quietPending", { count: state.pendingQuietCount })
    : "";
  const warning =
    state.lastCheckOutcome === "error"
      ? t("sourceError")
      : state.lastCheckOutcome === "partial"
        ? t("partial")
        : "";
  $("#warning-box").textContent = warning;
  $("#warning-box").classList.toggle("hidden", !warning);
  $("#sort-by").value = data.settings.sortBy;
  $("#compact-view").checked = data.settings.compactView;
  const list = $("#promotion-list");
  list.classList.toggle("compact", data.settings.compactView);
  const restoreInteraction = preserveListInteraction(list);
  list.replaceChildren();
  const selectedStore = $("#store-filter").value;
  const entries = sortEntries(data.visiblePromotions.filter((e) => selectedStore === "all" || storeOf(e) === selectedStore), data.settings.sortBy);
  $("#upcoming-list").replaceChildren();
  const upcoming = data.upcomingPromotions.filter((p) => selectedStore === "all" || storeOf(p) === selectedStore);
  $("#upcoming-section").hidden = !upcoming.length;
  for (const p of upcoming.slice(0, 10)) {
    const row = el("li", "upcoming-item");
    row.append(storeLink(p, p.title), el("span", "meta-line", `${STORE_NAMES[storeOf(p)]} · ${t("startsAt", { value: date(p.startsAt) })}`));
    if (p.stale) row.append(el("span", "meta-line", t("stale")));
    $("#upcoming-list").append(row);
  }
  const unread = entries.filter((e) => e.unread).length;
  $("#unread-pill").textContent = t("newCount", { count: unread });
  $("#unread-pill").classList.toggle("hidden", !unread);
  $("#mark-all-read").disabled = !unread;
  $("#empty-state").classList.toggle("hidden", entries.length > 0);
  $("#empty-state").textContent = !enabledStores(data.settings).length ? t("noStoresSelected") : selectedStore !== "all" && !entries.length ? t("noOffersInStore") : !data.settings.trackFreeToKeep
    ? t("paused")
    : !state.lastSuccessAt
      ? state.lastCheckOutcome === "error"
        ? t("sourceError")
        : t("firstCheck")
      : data.latestPromotions.some(
            (e) => e.status === "active" && e.region === data.settings.region,
          )
        ? t("allHidden")
        : t("noOffers");
  $("#show-all").classList.toggle("hidden", entries.length <= 10);
  $("#open-history").classList.toggle("hidden", entries.length > 10);
  $("#show-all").textContent = t("showAll", { count: entries.length });
  for (const entry of entries.slice(0, 10)) {
    const item = el("li", "promotion-item");
    item.dataset.entryId = entry.id;
    const overview = el("div", "promotion-overview");
    overview.append(artwork(entry));
    const copy = el("div", "card-copy");
    const head = el("div", "promotion-head");
    const title = storeLink(entry, entry.title, "promotion-title");
    title.title = entry.title;
    head.append(title);
    if (entry.unread) {
      const markRead = tooltip(button(t("new"), () => send("MARK_READ", { ids: [entry.id] }),
        "pill new-marker"), t("markReadHint"), "mark-read");
      markRead.setAttribute("aria-label", `${t("new")}: ${t("markReadHint")}`);
      head.append(markRead);
    }
    const end = el("div", "deadline-line", deadline(entry, true));
    end.title = entry.endsAt ? date(entry.endsAt) : t("endUnknown");
    end.setAttribute("aria-label", deadline(entry));
    if (entry.endsAt > Date.now() && entry.endsAt - Date.now() < 86400000)
      end.classList.add("urgent");
    copy.append(end);
    const facts = el("div", "card-facts");
    facts.append(ratingSummary(entry));
    if (entry.stale) {
      const stale = el("span", "stale-indicator", "⚠");
      stale.title = t("stale");
      stale.setAttribute("aria-label", t("stale"));
      stale.tabIndex = 0;
      stale.dataset.focusKey = "stale";
      facts.append(stale);
    }
    copy.append(facts);
    const tags = el("div", "meta-tags");
    const store = el("span", `tag store-tag store-tag--${storeOf(entry)}`, storeOf(entry) === "epic" ? "Epic" : STORE_NAMES[storeOf(entry)]);
    store.title = STORE_NAMES[storeOf(entry)];
    tags.append(store, el("span", "tag content-tag", t(entry.contentType)));
    if (entry.basePriceFormatted) {
      const price = el("s", "tag base-price-tag", entry.basePriceFormatted);
      price.title = t("basePrice", { value: entry.basePriceFormatted });
      price.setAttribute("aria-label", price.title);
      tags.append(price);
    }
    copy.append(tags);
    const actions = el("div", "card-actions");
    actions.append(
      storeLink({ ...entry, url: entry.claimUrl || entry.url }, t("openStore"), "primary-button"),
      button(t("claim"), () => action(entry, "claim")),
    );
    actions.children[0].dataset.focusKey = "store";
    actions.children[1].dataset.focusKey = "claim";
    for (const key of ["snooze", "hide", "ignore"]) actions.append(iconAction(entry, key));
    overview.append(copy);
    item.append(head, overview, actions);
    list.append(item);
  }
  restoreInteraction();
}
$("#check-now").addEventListener("click", async () => {
  $("#check-now").disabled = true;
  try {
    await send("CHECK_NOW");
  } catch (e) {
    announce(errorText(e));
  }
  await refresh();
});
$("#mark-all-read").addEventListener("click", async () => {
  try {
    await send("MARK_ALL_READ");
    await refresh();
  } catch (e) {
    announce(errorText(e));
  }
});
for (const [id, key] of [
  ["#sort-by", "sortBy"],
  ["#compact-view", "compactView"],
])
  $(id).addEventListener("change", async (event) => {
    try {
      await send("SAVE_SETTINGS", {
        settings: {
          [key]:
            event.target.type === "checkbox"
              ? event.target.checked
              : event.target.value,
        },
      });
      await refresh();
    } catch (e) {
      announce(errorText(e));
    }
  });
$("#store-filter").addEventListener("change", () => refresh().catch((e) => announce(errorText(e))));
watch(refresh);
refresh().catch((e) => announce(errorText(e)));
// Refresh relative deadlines only while this view is alive; no background polling.
setInterval(() => refresh().catch(() => undefined), 60000);
