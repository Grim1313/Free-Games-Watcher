# Steam Promo Watch

![GitHub Release](https://img.shields.io/github/v/release/Grim1313/steam-promo-watch) ![GitHub Release Date](https://img.shields.io/github/release-date/Grim1313/steam-promo-watch) ![GitHub Downloads](https://img.shields.io/github/downloads/Grim1313/steam-promo-watch/total)

A lightweight Chrome / Edge extension that finds limited-time Steam **Free to Keep** giveaways and notifies you about new offers. No Steam login, account connection or API key is required. Settings, history and personal marks stay in your browser.

[![Available in the Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png)](https://chromewebstore.google.com/detail/steam-promo-watch-free-ga/aahjgnocdbhipkfcmhkhlkneonhkafji)

![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/aahjgnocdbhipkfcmhkhlkneonhkafji) ![Chrome Web Store Rating Count](https://img.shields.io/chrome-web-store/rating-count/aahjgnocdbhipkfcmhkhlkneonhkafji)

[Download on GitHub](https://github.com/Grim1313/steam-promo-watch/releases/latest) · [Changelog](CHANGELOG.md)

<img width="800" height="500" alt="unnamed-1" src="https://github.com/user-attachments/assets/de94cee4-3e82-4f0d-a128-ea55d994251f" />
<img width="800" height="500" alt="unnamed-2" src="https://github.com/user-attachments/assets/372597ec-c63c-4ad7-b1f6-6f66cd73424e" />

## What's new in 1.0.0

- New design.
- More reliable giveaway discovery and fewer duplicate notifications.
- English and Russian interface and notifications, with a selectable Steam store region.
- **Already claimed**, **Snooze for 24 hours**, **Hide this giveaway** and **Ignore this game**, with undo and restore.
- Reminders before a known giveaway deadline and notifications after quiet hours.
- Filters for rating, review count, genres and supported platforms.
- Sorting, read/unread controls, and searchable history with status filters.
- Import and export of settings and personal marks, plus source diagnostics.

## Features

- Automatic background checks and an on-demand **Check now** action.
- Browser notifications, quiet hours and a toolbar badge for active offers.
- Giveaway deadlines, original prices and Steam review summaries when available.
- Light and dark themes that follow your system, plus an optional compact view.
- Sorting by ending time, discovery date, rating or title.
- Content filters for DLC, soundtracks, demos, tools and packages; exclusions by title or Steam ID.
- Local history and personal marks that can be managed separately.

Only limited-time **Free to Keep** offers are tracked. Permanently free games, **Free Weekend** and **Play for Free** events are outside the scope of this extension. Opening an offer takes you to Steam; claiming the game is up to you.

## Installation

Requires Chrome 120+ or a compatible Chromium-based browser such as Microsoft Edge.

### Chrome Web Store

Open [Steam Promo Watch in the Chrome Web Store](https://chromewebstore.google.com/detail/steam-promo-watch-free-ga/aahjgnocdbhipkfcmhkhlkneonhkafji) and choose **Add to Chrome**. Store releases are published separately and may arrive later than GitHub releases.

### Manual installation from GitHub

1. Open [GitHub Releases](https://github.com/Grim1313/steam-promo-watch/releases/latest).
2. Download **steam-promo-watch-1.0.0.zip** (or the corresponding ZIP for a newer release).
3. Extract it to a permanent local folder.
4. Open `chrome://extensions/` or `edge://extensions/`.
5. Enable **Developer mode**, select **Load unpacked**, and choose the extracted folder containing `manifest.json`.
6. Pin the extension to your browser toolbar.

Use the named release ZIP, rather than GitHub's **Source code (zip)** or **Source code (tar.gz)** downloads. Keep the extracted folder in place while the extension is installed.

## Updating a manual installation

1. Download the new release ZIP and close any open extension pages.
2. Replace the extension files in the **same folder** used for the previous installation.
3. Open `chrome://extensions/` or `edge://extensions/` and click **Reload** on Steam Promo Watch.

Updating in place preserves the browser's extension storage; version 1.0.0 automatically migrates existing settings and ignored games. Avoid removing the extension to update it, as removal can erase its local data. In version 1.0.0 and later, you can also export settings and personal marks before moving to another browser, computer or installation folder. Backups do not include the full detection history.

## Getting started

1. Open **Settings**, choose your Steam store region and preferred language, and save. The default region is **US**; the interface language follows the browser unless you choose English or Russian.
2. Configure notifications, the check interval, quiet hours and filters. DLC, soundtracks, demos and tools are excluded by default; enable them if you want those offers.
3. Select **Check now** in the popup. Scheduled checks run every three hours by default while the browser can run the extension.
4. Open an offer on Steam and mark it **Already claimed** after receiving it. This stops further alerts for that game until you restore it.
5. Use **More actions** to snooze an offer, hide its current giveaway, or ignore the game until restored. Mark offers as read individually or together.
6. Open **History** to search and filter records. Settings also provides personal marks, backup import/export and source diagnostics.

Reminders are enabled by default three hours before a known end time. Quiet hours and personal marks also apply to reminders. **Versions on GitHub** opens the latest release page; manually installed copies need to be updated using the steps above.

## Privacy and permissions

The extension contacts Steam to discover offers, load game details and retrieve images. It has no separate backend and does not connect to your Steam library. Its permissions support scheduled checks, notifications and local storage, with network access limited to the Steam domains listed in the manifest.

## Limitations

- Steam's available listings and regional restrictions mean that not every giveaway can be found.
- Steam may change its pages or data sources, requiring an extension update. Diagnostics shows source status and incomplete checks.
- Deadlines, prices, reviews and other details depend on what Steam provides. Reminders require a known deadline.
- A sleeping device or closed browser can delay checks and alerts. Operating-system notification settings may also suppress alerts.
- **Already claimed** is a manual local mark; it does not verify ownership or claim a game for you.

## Development and releases

Development checks use Node.js 24 LTS; packaging uses PowerShell 7. The extension has no runtime package dependencies, and users do not need Node.js or PowerShell to install it.

```powershell
npm test
npm run pack
```

The ZIP is written to `dist/`, which is excluded from Git. On GitHub, pushing a version tag such as **v1.0.0** runs the release workflow: it checks the version, runs tests, builds the ZIP, and creates or updates the GitHub release with that asset. The release description is extracted from the matching section of **CHANGELOG.md**. Committing alone does not generate a changelog or publish a release.

See [TECHNICAL.md](TECHNICAL.md) for architecture, browser checks, troubleshooting and release maintenance.
