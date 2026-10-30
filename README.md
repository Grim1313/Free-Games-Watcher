# Free Games Watcher - Steam, Epic & GOG

![GitHub Release](https://img.shields.io/github/v/release/Grim1313/Free-Games-Watcher) ![GitHub Release Date](https://img.shields.io/github/release-date/Grim1313/Free-Games-Watcher) ![GitHub Downloads](https://img.shields.io/github/downloads/Grim1313/Free-Games-Watcher/total)

A lightweight Chrome / Edge extension that finds limited-time **Free to Keep** giveaways in Steam, Epic Games Store and GOG and notifies you about new offers. No account connection or API key is required for discovery. Settings, history and personal marks stay in your browser.

[![Available in the Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png)](https://chromewebstore.google.com/detail/free-games-watcher-steam/aahjgnocdbhipkfcmhkhlkneonhkafji)

![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/aahjgnocdbhipkfcmhkhlkneonhkafji) ![Chrome Web Store Rating Count](https://img.shields.io/chrome-web-store/rating-count/aahjgnocdbhipkfcmhkhlkneonhkafji)

[Download on GitHub](https://github.com/Grim1313/Free-Games-Watcher/releases/latest) · [Changelog](CHANGELOG.md)

<img width="30%" alt="free games watcher steam epic and gog 01 giveaways" src="https://github.com/user-attachments/assets/e9f1fe2f-a690-4fce-aae9-5db974696911" />
<img width="30%" alt="free games watcher steam epic and gog 02 preferences" src="https://github.com/user-attachments/assets/b212bd40-8146-493d-abdf-18987e386147" />
<img width="30%" alt="free games watcher steam epic and gog 03 history" src="https://github.com/user-attachments/assets/b806e1cf-fbc8-4d2d-9cda-b15c0394c2f0" />

## What's new in 2.1.1

- Fixed a false incomplete-check warning caused by permanently free Epic games. These games are skipped in both current and upcoming giveaways.

### Highlights from 2.1.0

- **More Epic giveaways:** finds 100% discounts beyond the weekly selection, with a fallback when the store catalog is unavailable.
- **Epic genre and platform filters**, plus consistent RPG filtering across stores.
- **Quick action buttons** with tooltips; click **New** to mark a giveaway as read.
- **Reliable repeat test notifications** with visible sending/error feedback.
- Clearer reminder settings, store hints and diagnostics.

Free Games Watcher was formerly Steam Promo Watch. Steam, Epic Games Store and GOG can be selected independently; existing settings, personal marks and backups remain compatible. Installations upgraded from Steam Promo Watch keep Steam selected; new installations select all three stores.

GOG integration is experimental: its active-giveaway parsing has been tested with fixtures, while live checks have so far returned no active giveaway section. A zero catalog price alone is not accepted as a giveaway.

## Features

- Automatic background checks and an on-demand **Check now** action.
- Store filters in popup/history, independent source diagnostics and a separate list of upcoming Epic giveaways.
- Browser notifications, quiet hours and a toolbar badge for active offers.
- Giveaway deadlines, original prices and Steam review summaries when available.
- Light and dark themes that follow your system, plus an optional compact view.
- Sorting by ending time, discovery date, rating or title.
- Content filters for DLC, soundtracks, demos, tools and packages; exclusions by title or Steam ID.
- Genre/platform filters use store metadata; `RPG` and GOG's `Role-playing` match the same genre.
- Local history and personal marks that can be managed separately.

Only limited-time **Free to Keep** offers are tracked. Permanently free games, **Free Weekend** and **Play for Free** events are outside the scope of this extension. Opening an offer takes you to its store; claiming the game is up to you.

## Installation

Requires Chrome 120+ or a compatible Chromium-based browser such as Microsoft Edge.

### Chrome Web Store

Open [Steam Promo Watch in the Chrome Web Store](https://chromewebstore.google.com/detail/free-games-watcher-steam/aahjgnocdbhipkfcmhkhlkneonhkafji) and choose **Add to Chrome**. This is the existing Chrome Web Store listing; it may still use the old name/version until updated separately. The GitHub release provides version 2.1.1.

### Manual installation from GitHub

1. Open [GitHub Releases](https://github.com/Grim1313/Free-Games-Watcher/releases/latest).
2. Download **Free-Games-Watcher-2.1.1.zip** (or the corresponding ZIP for a newer release).
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
5. Use the **clock**, **crossed-out eye** and **muted bell** buttons to snooze an offer for 24 hours, hide its current giveaway, or ignore the game until restored. Hover or focus a button for its label. Click **New** to mark that offer as read, or use **Mark all as read** for the whole list.
6. Open **History** to search and filter records. Settings also provides personal marks, backup import/export and source diagnostics.

Reminders are enabled by default three hours before a known end time. Quiet hours and personal marks also apply to reminders. **Versions on GitHub** opens the latest release page; manually installed copies need to be updated using the steps above.

## Privacy and permissions

The extension contacts the selected stores to discover offers and retrieve details and images. When Epic's direct catalog fails or returns incomplete results, it also contacts `api.egdata.app`, a third-party catalog service, sending the selected country, language and public search filters. EGData receives ordinary network request information, including your IP address; no account cookies, library, history or personal marks are sent. Its indexed data may lag behind Epic. The extension has no separate backend and does not connect to your game libraries. Its permissions support scheduled checks, notifications and local storage, with network access limited to the API and image domains listed in the manifest. Epic, EGData and GOG discovery requests omit account credentials.

After updating a locally loaded extension, reload it on `chrome://extensions` (or `edge://extensions`) and run **Check now**. Version 2.1.0 adds access to `store.epicgames.com` and `api.egdata.app`; Chrome may request approval for the new sites.

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

For local testing, load the project root or `dist/Free-Games-Watcher` as an unpacked extension. The ZIP is written to `dist/`, which is excluded from Git. On GitHub, pushing a version tag such as **v2.1.1** runs the release workflow: it checks the version, runs tests, builds the ZIP, and creates or updates the GitHub release with that asset. An existing draft remains unpublished so its owner can verify the asset and publish it under their own account. The release description is extracted from the matching section of **CHANGELOG.md**. Committing alone does not generate a changelog or publish a release.

See [TECHNICAL.md](TECHNICAL.md) for architecture, browser checks, troubleshooting and release maintenance.
