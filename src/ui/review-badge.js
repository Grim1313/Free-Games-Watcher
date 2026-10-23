import {
  formatCompactNumber,
  formatSteamReviewTooltip,
  getSteamReviewTone,
  sanitizeSteamReviewSummary,
} from "../lib/utils.js";

export function buildSteamStoreAriaLabel(title, reviewSummarySource) {
  const base = `Open ${title} on Steam`;
  const tooltip = formatSteamReviewTooltip(reviewSummarySource);
  return tooltip ? `${base}. ${tooltip}.` : base;
}

export function createSteamReviewBadge(reviewSummarySource, t = null) {
  const summary = sanitizeSteamReviewSummary(reviewSummarySource);
  if (summary.reviewTotal <= 0) {
    return null;
  }

  const badge = document.createElement("span");
  badge.className = `steam-review-badge steam-review-${getSteamReviewTone(summary)}`;
  badge.title = t ? t("reviewSummary", { percent: summary.reviewPercent, count: summary.reviewTotal }) : formatSteamReviewTooltip(summary);
  badge.setAttribute("aria-hidden", "true");

  const percent = document.createElement("span");
  percent.className = "steam-review-percent";
  percent.textContent = `${summary.reviewPercent}%`;

  const total = document.createElement("span");
  total.className = "steam-review-total";
  total.textContent = t ? t("reviewCount", { count: new Intl.NumberFormat(t.locale, { notation: "compact" }).format(summary.reviewTotal) }) : `${formatCompactNumber(summary.reviewTotal)} reviews`;

  badge.append(percent, total);
  return badge;
}
