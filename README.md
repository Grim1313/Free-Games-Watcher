# Free Games Watcher - Steam, Epic & GOG

![GitHub Release](https://img.shields.io/github/v/release/Grim1313/Free-Games-Watcher) ![GitHub Release Date](https://img.shields.io/github/release-date/Grim1313/Free-Games-Watcher) ![GitHub Downloads](https://img.shields.io/github/downloads/Grim1313/Free-Games-Watcher/total)

A lightweight Chrome / Edge extension that finds limited-time **Free to Keep** giveaways in Steam, Epic Games Store and GOG and notifies you about new offers. No account connection or API key is required for discovery. Settings, history and personal marks stay in your browser.

[![Available in the Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png)](https://chromewebstore.google.com/detail/steam-promo-watch-free-ga/aahjgnocdbhipkfcmhkhlkneonhkafji)

![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/aahjgnocdbhipkfcmhkhlkneonhkafji) ![Chrome Web Store Rating Count](https://img.shields.io/chrome-web-store/rating-count/aahjgnocdbhipkfcmhkhlkneonhkafji)

[Download on GitHub](https://github.com/Grim1313/Free-Games-Watcher/releases/latest) · [Changelog](CHANGELOG.md)

Screenshots of the previous Steam Promo Watch 1.0 interface (core layout retained):

<img width="30%" alt="01-free-games" src="https://github.com/user-attachments/assets/6d544bcc-74be-4014-b7d9-f4732c68c48f" />
<img width="30%" alt="02-your-preferences" src="https://github.com/user-attachments/assets/0c821fd6-709f-48b9-96df-d7267ce98d96" />
<img width="30%" alt="03-history-and-marks" src="https://github.com/user-attachments/assets/ed55e157-3c74-4a0a-b31c-59471ae25fad" />

## What's new in 2.0.0

- **Steam Promo Watch is now Free Games Watcher.**
- **Multi-store support:** Steam, Epic Games Store and GOG, selected independently in Settings.
- Store filters in popup/history and independent source diagnostics.
- Upcoming Epic giveaways in a separate list, without early notifications.
- Existing settings, personal marks and backups remain compatible.

Existing installations keep Steam selected; enable Epic and GOG in Settings. New installations select all three stores. GOG integration is experimental: its active-giveaway parsing has been tested with fixtures, while live checks have so far returned no active giveaway section. A zero catalog price alone is not accepted as a giveaway.

## Features

- Automatic background checks and an on-demand **Check now** action.
- Browser notifications, quiet hours and a toolbar badge for active offers.
- Giveaway deadlines, original prices and Steam review summaries when available.
- Light and dark themes that follow your system, plus an optional compact view.
- Sorting by ending time, discovery date, rating or title.
- Content filters for DLC, soundtracks, demos, tools and packages; exclusions by title or Steam ID.
- Local history and personal marks that can be managed separately.

Only limited-time **Free to Keep** offers are tracked. Permanently free games, **Free Weekend** and **Play for Free** events are outside the scope of this extension. Opening an offer takes you to its store; claiming the game is up to you.

## Installation

Requires Chrome 120+ or a compatible Chromium-based browser such as Microsoft Edge.

### Chrome Web Store

Open [Steam Promo Watch in the Chrome Web Store](https://chromewebstore.google.com/detail/steam-promo-watch-free-ga/aahjgnocdbhipkfcmhkhlkneonhkafji) and choose **Add to Chrome**. This is the existing Chrome Web Store listing; it may still use the old name/version until updated separately. The GitHub release provides version 2.0.0.

### Manual installation from GitHub

1. Open [GitHub Releases](https://github.com/Grim1313/Free-Games-Watcher/releases/latest).
2. Download **Free-Games-Watcher-2.0.0.zip** (or the corresponding ZIP for a newer release).
3. Extract it to a permanent local folder.
4. Open `chrome://extensions/` or `edge://extensions/`.
5. Enable **Developer mode**, select **Load unpacked**, and choose the extracted folder containing `manifest.json`.
6. Pin the extension to your browser toolbar.

Use the named release ZIP, rather than GitHub's **Source code (zip)** or **Source code (tar.gz)** downloads. Keep the extracted folder in place while the extension is installed.

## Updating a manual installation

1. Download the new release ZIP and close any open extension pages.
2. Replace the extension files in the **same folder** used for the previous installation.
3. Open `chrome://extensions/` or `edge://extensions/` and click **Reload** on Free Games Watcher.

Updating in place with the same extension ID preserves browser storage. Version 2.0.0 retains legacy Steam campaign IDs, settings and marks; renaming the product does not require a fresh installation. Avoid removing the extension to update it, as removal can erase its local data. In version 1.0.0 and later, you can also export settings and personal marks before moving to another browser, computer or installation folder. Backups do not include the full detection history.

## Getting started

1. Open **Settings**, choose the stores, country and preferred language, and save. The default region is **US**; the interface language follows the browser unless you choose English or Russian.
2. Configure notifications, the check interval, quiet hours and filters. DLC, soundtracks, demos and tools are excluded by default; enable them if you want those offers.
3. Select **Check now** in the popup. Scheduled checks run every three hours by default while the browser can run the extension.
4. Open an offer in its store and mark it **Already claimed** after receiving it. This stops further alerts for that game until you restore it.
5. Use **More actions** to snooze an offer, hide its current giveaway, or ignore the game until restored. Mark offers as read individually or together.
6. Open **History** to search and filter records. Settings also provides personal marks, backup import/export and source diagnostics.

Reminders are enabled by default three hours before a known end time. Quiet hours and personal marks also apply to reminders. **Versions on GitHub** opens the latest release page; manually installed copies need to be updated using the steps above.

## Privacy and permissions

The extension contacts the selected stores to discover offers and retrieve details and images. It has no separate backend and does not connect to your game libraries. Its permissions support scheduled checks, notifications and local storage, with network access limited to the store API and image domains listed in the manifest. Epic and GOG discovery requests omit account credentials.

## Limitations

- Available listings and regional restrictions mean that not every giveaway can be found. A country selection does not override account eligibility or regional restrictions.
- Stores may change their pages or data sources, requiring an extension update. Diagnostics shows source status and incomplete checks.
- Deadlines, prices and other details depend on store data. Ratings/review filters apply only to Steam; selected genre/platform filters exclude offers with unknown metadata. Reminders require a known deadline.
- A sleeping device or closed browser can delay checks and alerts. Operating-system notification settings may also suppress alerts.
- **Already claimed** is a manual local mark; it does not verify ownership or claim a game for you.

Microsoft Store / Xbox, itch.io, IndieGala and Ubisoft remain future work; they are not queried by this build.

## Development and releases

Development checks use Node.js 24 LTS; packaging uses PowerShell 7. The extension has no runtime package dependencies, and users do not need Node.js or PowerShell to install it.

```powershell
npm test
npm run pack
```

For local testing, load the project root or `dist/Free-Games-Watcher` as an unpacked extension. The ZIP is written to `dist/`, which is excluded from Git. On GitHub, pushing a version tag such as **v2.0.0** runs the release workflow: it checks the version, runs tests, builds the ZIP, and creates or updates the GitHub release with that asset. An existing draft remains unpublished so its owner can verify the asset and publish it under their own account. The release description is extracted from the matching section of **CHANGELOG.md**. Committing alone does not generate a changelog or publish a release.

See [TECHNICAL.md](TECHNICAL.md) for architecture, browser checks, troubleshooting and release maintenance.
