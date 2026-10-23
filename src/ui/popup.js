import {
  t,
  localize,
  send,
  el,
  button,
  announce,
  date,
  deadline,
  steamLink,
  artwork,
  action,
  sortEntries,
  watch,
  errorText,
  moreActions,
  preserveListInteraction,
} from "./common.js";
const $ = (selector) => document.querySelector(selector);
let refreshId = 0;
async function refresh() {
  const id = ++refreshId;
  const data = await send("GET_POPUP_DATA");
  if (id !== refreshId) return;
  await localize(data.settings);
  if (id !== refreshId) return;
  const state = data.runtimeState;
  $("#app-version").textContent = t("version", {
    value: chrome.runtime.getManifest().version,
  });
  $("#check-now").disabled =
    state.checkInProgress || !data.settings.trackFreeToKeep;
  $("#status-text").textContent = !data.settings.trackFreeToKeep
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
  $(".status-panel").dataset.state = !data.settings.trackFreeToKeep
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
  const entries = sortEntries(data.visiblePromotions, data.settings.sortBy);
  const unread = entries.filter((e) => e.unread).length;
  $("#unread-pill").textContent = t("newCount", { count: unread });
  $("#unread-pill").classList.toggle("hidden", !unread);
  $("#mark-all-read").disabled = !unread;
  $("#empty-state").classList.toggle("hidden", entries.length > 0);
  $("#empty-state").textContent = !data.settings.trackFreeToKeep
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
    head.append(steamLink(entry, entry.title, "promotion-title"));
    if (entry.unread) head.append(el("span", "pill", t("new")));
    const end = el("div", "deadline-line", deadline(entry, true));
    end.title = entry.endsAt ? date(entry.endsAt) : t("endUnknown");
    end.setAttribute("aria-label", deadline(entry));
    if (entry.endsAt > Date.now() && entry.endsAt - Date.now() < 86400000)
      end.classList.add("urgent");
    copy.append(end);
    if (entry.stale) copy.append(el("p", "meta-line", t("stale")));
    const tags = el("div", "meta-tags");
    tags.append(el("span", "tag", t(entry.contentType)));
    if (entry.reviewTotal)
      copy.append(
        el(
          "span",
          "meta-line review-summary",
          t("reviewSummary", {
            percent: entry.reviewPercent,
            count: entry.reviewTotal,
          }),
        ),
      );
    if (entry.basePriceFormatted)
      tags.append(
        el(
          "span",
          "tag base-price-tag",
          t("basePrice", { value: entry.basePriceFormatted }),
        ),
      );
    copy.append(tags);
    const actions = el("div", "card-actions");
    actions.append(
      steamLink(entry, t("openSteam"), "primary-button"),
      button(t("claim"), () => action(entry, "claim")),
    );
    const extra = [
      button(t("snooze"), () => action(entry, "snooze")),
      button(t("hide"), () => action(entry, "hide")),
      button(t("ignore"), () => action(entry, "ignore")),
    ];
    if (entry.unread)
      extra.unshift(
        button(t("markRead"), () => send("MARK_READ", { ids: [entry.id] })),
      );
    actions.append(moreActions(entry, extra));
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
watch(refresh);
refresh().catch((e) => announce(errorText(e)));
// Refresh relative deadlines only while this view is alive; no background polling.
setInterval(() => refresh().catch(() => undefined), 60000);
