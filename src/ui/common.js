import { STORE_NAMES, storeOf, storeUrl } from "../lib/stores.js";
export { STORE_NAMES, storeOf, storeUrl };
import { getTranslator } from "../lib/i18n.js";
import { getPromotionCoverUrls } from "../lib/utils.js";
export let t = (key) => key;
export async function localize(settings) {
  t = await getTranslator(settings.language);
  document.documentElement.lang = t.locale;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.placeholder);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  return t;
}
export async function send(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || "operationFailed");
  return result;
}
export function errorText(error) {
  const key = error?.message || "operationFailed";
  const translated = t(key);
  return translated === key ? t("operationFailed") : translated;
}
export function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
export function button(label, callback, className = "ghost-button") {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", async (event) => {
    if (node.getAttribute("aria-disabled") === "true") return;
    // Native disabled moves focus to the body before a row can be rerendered.
    // Guard repeated activation while keeping the keyboard position available.
    node.setAttribute("aria-disabled", "true");
    try {
      await callback(event);
    } catch (error) {
      announce(errorText(error));
    } finally {
      node.removeAttribute("aria-disabled");
    }
  });
  return node;
}
export function announce(text) {
  const node = document.querySelector("#feedback");
  if (node) {
    node.textContent = text;
    node.classList.toggle("hidden", !text);
  }
}
export function date(timestamp) {
  return timestamp
    ? new Intl.DateTimeFormat(t.locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(timestamp)
    : t("never");
}
export function relative(timestamp) {
  const diff = timestamp - Date.now();
  const unit =
    Math.abs(diff) < 3600000
      ? "minute"
      : Math.abs(diff) < 86400000
        ? "hour"
        : "day";
  return new Intl.RelativeTimeFormat(t.locale, { numeric: "auto" }).format(
    Math.round(diff / { minute: 60000, hour: 3600000, day: 86400000 }[unit]),
    unit,
  );
}
export function deadline(entry, compact = false) {
  if (!entry.endsAt) return t("endUnknown");
  return entry.endsAt <= Date.now()
    ? t("ended")
    : compact
      ? t("endsRelative", { value: relative(entry.endsAt) })
      : `${t("endsAt", { value: date(entry.endsAt) })} · ${relative(entry.endsAt)}`;
}
export function moreActions(entry, controls) {
  const menu = el("details", "more-actions");
  const summary = el("summary", "", "•••");
  summary.setAttribute("aria-label", `${t("more")}: ${entry.title}`);
  summary.title = t("more");
  const content = el("div", "more-actions-content");
  content.append(...controls);
  menu.append(summary, content);
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.open = false;
      summary.focus();
      event.preventDefault();
    }
  });
  return menu;
}
// Storage updates may arrive while a menu is open or keyboard focus is in a row.
// Restore that interaction after rendering instead of interrupting the user.
export function preserveListInteraction(container) {
  const rows = [...container.querySelectorAll("[data-entry-id]")];
  const opened = new Set(
    rows
      .filter((row) => row.querySelector("details[open]"))
      .map((row) => row.dataset.entryId),
  );
  const active = document.activeElement;
  const row = active?.closest("[data-entry-id]");
  const focused = row && container.contains(row);
  const focusKey = focused ? active.dataset.focusKey : "";
  const index = focused
    ? [...row.querySelectorAll("a, button, summary")].indexOf(active)
    : -1;
  const scroller = container.closest(".promotion-scroll");
  const scrollTop = scroller?.scrollTop;
  return () => {
    const updated = [...container.querySelectorAll("[data-entry-id]")];
    for (const current of updated) {
      if (opened.has(current.dataset.entryId))
        current.querySelector("details")?.setAttribute("open", "");
    }
    if (focused) {
      const current = updated.find(
        (current) => current.dataset.entryId === row.dataset.entryId,
      );
      const controls = [
        ...(current || container).querySelectorAll("a, button, summary"),
      ];
      const preferred = current && (focusKey
        ? controls.find((control) => control.dataset.focusKey === focusKey)
        : controls[index]);
      const target = preferred?.getClientRects().length
        ? preferred
        : controls.find((control) => control.getClientRects().length);
      target?.focus({ preventScroll: true });
    }
    if (scroller) scroller.scrollTop = scrollTop;
  };
}
export function storeLink(entry, text, className = "") {
  const node = el("a", className, text);
  node.href = storeUrl(entry);
  node.target = "_blank";
  node.rel = "noreferrer";
  return node;
}
export function artwork(entry, history = false) {
  const link = storeLink(
    entry,
    "",
    history ? "history-entry-preview" : "promotion-media",
  );
  const image = el("img", history ? "history-entry-image" : "promotion-image");
  const candidates = getPromotionCoverUrls(entry);
  let candidate = 0;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  const placeholder = el("span", "artwork-placeholder", "▧");
  placeholder.setAttribute("aria-hidden", "true");
  const loadNext = () => {
    if (candidate < candidates.length) image.src = candidates[candidate++];
    else {
      image.remove();
      link.classList.add("artwork-missing");
      placeholder.hidden = false;
    }
  };
  image.addEventListener("error", loadNext);
  image.addEventListener("load", () => {
    placeholder.hidden = true;
  });
  link.setAttribute("aria-label", `${t("openStore")} (${STORE_NAMES[storeOf(entry)]}): ${entry.title}`);
  link.append(placeholder, image);
  loadNext();
  return link;
}
export async function action(entry, type, payload = {}) {
  const result = await send("SET_ACTION", {
    stableId: entry.stableId,
    action: type,
    payload: { title: entry.title, url: entry.url, fingerprint: entry.fingerprint, ...payload },
  });
  announce(t("actionSaved"));
  const feedback = document.querySelector("#feedback");
  feedback?.append(
    button(t("undo"), async () => {
      await send("SET_ACTION", {
        stableId: entry.stableId,
        action: "undo",
        payload: { previous: result.previous },
      });
      announce("");
      document.dispatchEvent(new Event("data-refresh"));
    }),
  );
  document.dispatchEvent(new Event("data-refresh"));
}
export function sortEntries(entries, sortBy = "ending") {
  return [...entries].sort((a, b) => {
    if (sortBy === "title") return a.title.localeCompare(b.title, t.locale);
    if (sortBy === "rating")
      return b.reviewPercent - a.reviewPercent || b.reviewTotal - a.reviewTotal;
    if (sortBy === "newest") return b.firstSeenAt - a.firstSeenAt;
    return (
      (a.endsAt || Infinity) - (b.endsAt || Infinity) ||
      b.firstSeenAt - a.firstSeenAt
    );
  });
}
export function watch(refresh) {
  let timer;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area !== "local" ||
      ![
        "latestPromotions",
        "runtimeState",
        "userActions",
        "settings",
        "history",
      ].some((k) => changes[k])
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(
      () => refresh().catch((e) => announce(errorText(e))),
      80,
    );
  });
  document.addEventListener("data-refresh", () =>
    refresh().catch((e) => announce(errorText(e))),
  );
}
