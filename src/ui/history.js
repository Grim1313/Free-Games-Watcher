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
  storeUrl,
  artwork,
  ratingSummary,
  action,
  sortEntries,
  watch,
  errorText,
  moreActions,
  preserveListInteraction,
} from "./common.js";
import { actionState } from "../lib/actions.js";
import { buildSteamUrlFromStableId } from "../lib/utils.js";
const $ = (id) => document.getElementById(id);
let data;
if (location.hash === "#active") $("status-filter").value = "active";
function render() {
  if (!data) return;
  const merged = new Map(data.historyEntries.map((e) => [e.id, e]));
  for (const e of data.latestPromotions) merged.set(e.id, e);
  const represented = new Set([...merged.values()].map((e) => e.stableId));
  for (const [stableId, a] of Object.entries(data.userActions))
    if (
      !represented.has(stableId) &&
      (a.claimed ||
        a.ignored ||
        a.hiddenCampaign ||
        a.snoozedUntil > Date.now())
    )
      merged.set(stableId, {
        stableId,
        id: stableId,
        title: a.title,
        url: storeUrl({ stableId, url: a.url }),
        fingerprint: a.hiddenCampaign,
        status: "unknown",
      });
  const query = $("search").value.trim().toLocaleLowerCase();
  const filter = $("status-filter").value;
  const selectedStore = $("store-filter").value;
  const entries = sortEntries(
    [...merged.values()].filter((e) => {
      const state = actionState(e, data.userActions);
      const status = e.endsAt && e.endsAt <= Date.now() ? "expired" : e.status;
      return (
        (selectedStore === "all" || storeOf(e) === selectedStore) &&
        (!query || e.title.toLocaleLowerCase().includes(query)) &&
        (filter === "all" ||
          (filter === "active"
            ? data.visiblePromotions.some((v) => v.id === e.id)
            : filter === "expired"
              ? status === "expired"
              : state === filter))
      );
    }),
    $("sort-by").value,
  );
  $("history-note").textContent = t("historyNote", {
    days: data.settings.historyRetentionDays,
  });
  $("history-count").textContent = t("recordCount", { count: entries.length });
  $("empty-state").classList.toggle("hidden", entries.length > 0);
  $("history-table").classList.toggle("hidden", !entries.length);
  const restoreInteraction = preserveListInteraction($("history-body"));
  $("history-body").replaceChildren();
  for (const entry of entries) {
    const row = el("tr");
    row.dataset.entryId = entry.id;
    const titleCell = el("td", "title-cell");
    const wrap = el("div", "history-entry");
    const title = el("div", "history-entry-copy");
    wrap.append(artwork(entry, true), title);
    titleCell.append(storeLink(entry, entry.title, "game-link"), wrap);
    if (entry.endsAt) {
      const end = el("div", "deadline-line", deadline(entry, true));
      end.title = date(entry.endsAt);
      end.setAttribute("aria-label", deadline(entry));
      title.append(end);
    }
    if (entry.stale) title.append(el("div", "meta-line", t("stale")));
    const rating = ratingSummary(entry);
    if (rating.textContent) title.append(rating);
    title.append(el("span", `tag store-tag store-tag--${storeOf(entry)}`, STORE_NAMES[storeOf(entry)]));
    const personal = actionState(entry, data.userActions);
    const status =
      entry.endsAt && entry.endsAt <= Date.now() ? "expired" : entry.status;
    const state = el("td");
    state.append(
      el(
        "span",
        `tag${status === "active" ? " status-active" : ""}`,
        t(status === "expired" ? "ended" : status),
      ),
    );
    if (personal) state.append(el("div", "tag", t(personal)));
    const actions = el("td", "actions-cell");
    const controls = el("div", "card-actions");
    const store = storeLink({ ...entry, url: entry.claimUrl || entry.url }, `${storeOf(entry) === "epic" ? "Epic" : STORE_NAMES[storeOf(entry)]} ↗`, "header-link");
    store.setAttribute("aria-label", `${t("openStore")}: ${entry.title}`);
    controls.append(store);
    if (personal)
      controls.append(button(t("restore"), () => action(entry, "restore")));
    else {
      controls.append(button(t("claim"), () => action(entry, "claim")));
    }
    const extra = [];
    if (!personal)
      extra.push(button(t("ignore"), () => action(entry, "ignore")));
    if (entry.unread)
      extra.push(
        button(t("markRead"), () => send("MARK_READ", { ids: [entry.id] })),
      );
    if (extra.length) controls.append(moreActions(entry, extra));
    actions.append(controls);
    const dates = el("td");
    const dateStack = el("div", "history-dates");
    for (const [label, value] of [
      [t("firstSeen"), entry.firstSeenAt],
      [t("lastNotified"), entry.lastNotifiedAt],
    ]) {
      const line = el("div");
      line.append(el("span", "meta-line", label), el("span", "", date(value)));
      dateStack.append(line);
    }
    dates.append(dateStack);
    row.append(titleCell, state, dates, actions);
    $("history-body").append(row);
  }
  restoreInteraction();
}
async function refresh() {
  data = await send("GET_HISTORY_DATA");
  await localize(data.settings);
  render();
}
for (const id of ["search", "status-filter", "sort-by", "store-filter"])
  $(id).addEventListener("input", render);
watch(refresh);
refresh().catch((e) => announce(errorText(e)));
