# Changelog

## 2.2.0

### New features

- Compact Steam and GOG ratings with explanatory tooltips in giveaway cards and history.
- GOG ratings in individual giveaway notifications and reminders.
- Full notification preview with a fictional game, artwork, price, deadline and rating.
- Color-coded store labels in giveaway cards and history, adapted to light and dark themes.
- Optional history transfer in a single backup file, with an import preview and duplicate-free merging.

### Fixes

- Restored missing Steam ratings when the review service is unavailable.
- Uniform popup card heights, with compact prices and full-title tooltips.
- Shorter rating lines in Windows notifications so review counts remain visible.
- Clearer notification text: 100% discount with a compact end date.

## 2.1.1

### Fixes

- Permanently free Epic games no longer trigger an incomplete-check warning and are excluded from current and upcoming giveaways.

## 2.1.0

### New features

- More Epic giveaways, including 100% discounts outside the weekly selection.
- Genre and platform filters for Epic games.
- Compact action buttons with tooltips in giveaway cards.
- Click the **New** badge to mark a giveaway as read.

### Fixes

- More reliable Epic discovery when the store catalog is unavailable.
- Consistent RPG filtering across Steam, Epic and GOG.
- Faster test notifications that work on repeated clicks, with clear feedback.
- Stable card button layout and clearer reminder settings.
- Updated settings hints and diagnostics for all supported stores.

## 2.0.0

### What's new

- Renamed Steam Promo Watch to **Free Games Watcher**.
- Added **multi-store support** for Steam, Epic Games Store and GOG, with store selection, filters and independent source diagnostics.
- Added a separate list of upcoming Epic giveaways without early notifications.
- Preserved settings, personal marks and backup compatibility for existing Steam Promo Watch users.

## 1.0.0

### What's new

- New design.
- More reliable giveaway discovery and fewer duplicate notifications.
- Added Russian language support and a selectable Steam store region.
- Added claimed, snooze, hide and ignore actions, with undo and restore.
- Added reminders before giveaways end and notifications after quiet hours.
- Added rating, review-count, genre and platform filters, sorting and read/unread controls.
- Added searchable history with status filters and source diagnostics.
- Added import and export of settings and personal marks.

## 0.5.0

### What's new

- Added automatic dark theme support for the popup, settings, and history pages.
- Added the game's base price before the 100% discount to promotion cards when Steam provides it.

## 0.4.1

### What's new

- Fixed promotion end date detection.

## 0.4.0

### What's new

- Added promotion end-time detection so the popup and notifications can show when a Free to Keep offer ends.

## 0.3.3

### What's new

- Removed the unnecessary `tabs` permission from the Chrome extension manifest for Chrome Web Store compliance.

## 0.3.2

### What's new

- Improved Steam promotion discovery so current free-to-keep offers are found more reliably.
- The popup now prioritizes full games before other content types, making the main list easier to scan.

## 0.3.1

### What's new

- Fixed an issue where the popup could get stuck on `Checking now...` and keep `Check now` blocked after an interrupted check.

## 0.3.0

### What's new

- Added an `Ignored promotions` section in Settings so ignored titles stay visible, can be opened on Steam, and can be restored without clearing all local data.
- Improved ignore/restore matching so the same Steam promotion stays ignored even when it appears from another provider or source entry.
- Added Steam user review badges to popup and history cards, plus review summary text in notifications when review data is available.
- Added a `Check for updates` link in the popup that opens the latest GitHub release.
- Updated the release workflow so GitHub Releases use the matching `CHANGELOG.md` entry as `What's new` while still attaching the packaged zip asset.

## 0.2.1

### What's new

- Updated the GitHub Actions release workflow to use `actions/checkout@v6`, which is compatible with Node 24.
- Fixed the release workflow so it actually runs the packaging script and captures the generated archive path.
- Made the release workflow idempotent: if a GitHub release already exists for the tag, the workflow now uploads or replaces the asset instead of failing.

## 0.2.0

### What's new

- Empty `Free to Keep` results are now treated as a normal successful check instead of a source warning.
- The popup now clearly shows `No new free promotions found` when the check succeeds but there are no active giveaways.
- The popup list now keeps only active promotions visible, which removes stale non-active entries from the main view.
- The toolbar badge is now hidden when there are no active `Free to Keep` promotions.
- When active promotions exist, the badge still shows the active count: red for unread items, green when everything is already seen.

## 0.1.0

### What's new

- Initial release
