# Free Games Watcher — technical documentation

This document describes the implementation and development checks for contributors. See the [README](README.md) for installation and usage, and the [maintainer release guide](docs/RELEASING.md) for official publication.

## Runtime and architecture

Manifest V3, Chrome/Edge 120+, ES modules, no runtime/npm dependencies. Development targets Node.js 24 and PowerShell 7; neither is required by extension users.

The Firefox Desktop 142+ target uses the same modules in a nonpersistent background event page. `scripts/firefox-manifest.mjs` derives its manifest from the Chromium manifest; `build-release.ps1 -Browser firefox` produces a separate unsigned package. `browser-api.js` selects the native Promise namespace. Firefox notification payloads use basic notifications, append ratings to the body, and serialize delivery with a minimum one-second gap. Closed notification targets remain bounded/TTL-pruned on Firefox to handle close-before-click ordering. The preview checks `permissions.contains` because Firefox does not implement `notifications.getPermissionLevel`. See [Firefox development and verification](docs/FIREFOX.md).

- `service-worker.js` registers listeners synchronously, gates entry points on initialization and restores alarms at worker start.
- `queue.js` serializes storage mutations. Discovery runs outside the queue; commits re-read settings and user marks. Changes to country, tracking or enabled stores discard an in-flight result.
- `promotions.js` manages campaigns, scan states and notification eligibility. Known deadlines or confirmed source evidence end an offer; a missing result alone does not.
- `actions.js` stores claimed/ignored games, campaign hiding and snooze independently of history.
- `scheduler.js` maintains one regular alarm and at most one follow-up for quiet hours, reminders, snooze, expiry or an upcoming offer's start. Selecting no stores pauses checks.
- `_locales/en` and `_locales/ru` localize interface and notifications independently of parsing language.

## Store providers and limits

`providers/index.js` runs selected providers with independent settled results. Each store reports success, completeness and last successful check. Failed sources preserve stale offers; disabled stores are not queried. Successful bounded discovery does not guarantee full store-wide coverage.

**Steam:** two paginated search strategies, up to six pages of 100 results each, with featured offers as a limited fallback. Up to 100 previously known missing offers are verified against StoreBrowse purchase options. App details/reviews are cached for seven days; imminent deadlines refresh hourly, other deadlines/negative results after six hours. Country changes clear metadata. Requests omit credentials except the existing age-gate deadline fallback, which may reuse browser cookies.

**Epic Games Store:** the anonymous regional `freeGamesPromotions` feed runs alongside Browse's `searchStoreQuery` at `store.epicgames.com/graphql`. The catalog query uses `onSale: true`, `priceRange: "[0,0]"`, region restrictions and at most five pages of 40 offers. Its persisted-query hash was observed on 27 October 2026 and may need maintenance if Epic changes the storefront. Catalog offers require a positive original price, a zero final price, a matching full discount, no personal voucher and a valid product link. Applied percentage-discount rules must provide a future deadline; their missing start time stays unknown (0). Catalog categories supply the content type, including offer-specific DLC links.

The weekly feed skips offers with an explicitly numeric zero original price, including upcoming promotions for permanently free games. These entries do not generate warnings or make the scan incomplete. Missing or invalid original prices still produce an incomplete result; paid-to-free offers require a positive integer original price in minor currency units.

If the direct catalog fails or is incomplete, a bounded anonymous `POST https://api.egdata.app/search/v2/search` supplies a third-party fallback. It searches discounted offers in ascending regional final-price order, at most five pages of 40, stopping after the zero-price segment. EGData records must have desktop platform tags and a public game/DLC category, pass country whitelist/blacklist checks, and match their price record's offer/namespace. Only active, dated, simple 100% discount rules for that offer and pricing region qualify. Old/undated prices, mobile SKUs and internal test products are excluded. Currency formatting uses the returned currency's minor units. EGData is an indexed mirror and can lag behind Epic; its source is recorded as `epic-egdata` in diagnostics.

The weekly feed remains independent and authoritative when the same offer is found in multiple sources. Current feed giveaways require valid dates, a PERCENTAGE promotion with `discountPercentage: 0`, positive original price, current zero price and a valid product link. Future feed windows remain in `upcomingPromotions`, separate from current cards, counts and notifications. Their start schedules a fresh availability check. Stable IDs and campaign identities do not change when switching between feed, catalog and fallback. Partial results retain successful pages; absent results alone never expire known offers. A successful fallback restores scan completeness while the direct-catalog failure remains visible in diagnostics. `coverageLimited` remains true for every bounded source. Genre/platform metadata is decoded from shared Epic tag IDs for the weekly feed, direct catalog and EGData fallback. `epicTags.js` contains a local genre/desktop-platform mapping, verified against Epic product and Browse pages and the public EGData tag taxonomy on 27 October 2026; no extra metadata requests are needed. Unknown/feature/event tags are ignored, and Windows support does not imply Linux support. EGData platform tags also exclude mobile-only catalog entries.

**GOG:** public homepage section configuration plus one bounded discounted-zero catalog query. Up to three public `GIVEAWAY_SECTION` records are fetched. Product identity/title/slug and valid end date are required; the claim destination is GOG's homepage. Zero-price catalog entries without giveaway terms produce an incomplete result, never a fabricated giveaway. The section schema was confirmed on 31 October 2026 with the live A New Beginning: Final Cut giveaway for US/RU; `sectionSchemaLiveVerified: true` records that development-time validation, not whether each scan contains an offer. The ordinary product price remains nonzero during this homepage giveaway; explicit giveaway terms are authoritative. The live section supplies Windows/Mac platforms but no genres, so genre metadata remains unknown rather than inferred from tags. No account-status or authenticated claim endpoint is called.

The initial [source audit](docs/SOURCE_AUDIT.ru.md) and [implementation report](docs/MULTISTORE_IMPLEMENTATION.ru.md) preserve dated evidence. Microsoft Store/Xbox, itch.io, IndieGala and Ubisoft remain future work.

## Identity and compatibility

Product name: **Free Games Watcher**. Repository: `Grim1313/Free-Games-Watcher`. The npm package uses lowercase `free-games-watcher`; local build archives use `Free-Games-Watcher-Chrome-<version>.zip` and `Free-Games-Watcher-Firefox-<version>.zip`. Published Firefox downloads use `Free-Games-Watcher-Firefox-<version>.xpi`.

Store IDs remain `app:<id>` / `sub:<id>` for Steam, `epic:<namespace>:<offerId>` for Epic, and `gog:<productId>` for GOG. Campaign identity is independent of HTML, provider metadata and artwork. A new cycle needs a previously confirmed end or elapsed known deadline.

Storage schema 3 preserves schema-2 campaign and delivery records. Missing store lists select all three stores; explicitly saved selections, including an empty list, are preserved. The rename deliberately retains internal alarm names (`steam-promo-check`, `steam-promo-followup`), notification prefix (`steam-promo-watch`), storage keys and the backup format marker (`steam-promo-watch`). These are compatibility identifiers, not visible branding. Changing them requires a separate migration.

Backups export version 3 and accept versions 1, 2 and 3. One JSON file contains saved settings, personal marks and optional `history`; full export is selected by default. History combines current and archived entries with canonical store/offer/type IDs, deduplicates and keeps up to 400 most recent records. Export/import are serialized with storage mutations. Input is limited to 5 MiB of UTF-8, 2,000 marks and 400 history records, with validated identities, timestamps, campaign fields and safe store URLs/artwork. Invalid files write nothing, even when history is unchecked. Runtime caches, delivery maps, notification links and the receiving installation's import guard are not exported. The filename remains `free-games-watcher-backup.json`.

Import previews creation date, country, personal marks and history count, allows history to be unchecked, and requires explicit confirmation. Settings/marks are replaced; selected history is merged with local records taking precedence for duplicate IDs, then capped by recency. Imported records remain outside `latestPromotions` until ordinary discovery, are marked read/stale, and carry a local `importedAt` guard. Campaign assignment retains that guard for the same campaign and clears it for a confirmed new cycle. It suppresses automatic new/retention/reminder notifications without fabricating delivery timestamps. Imported pending snoozes for new archive records are disabled; a new explicit snooze can still request an alert. Normal history-retention rules continue to apply on later scans.

There is no `key` in the manifest. Unpacked installations can change ID when their folder moves. Installed store copies must be updated through the existing store listing, not a newly created item. Product/repository renaming does not itself migrate browser storage between extension IDs.

## Filtering, delivery and resource limits

The settings notification test creates a new image notification with a random ID for every explicit click. Its fictional Starfall Courier sample includes bundled artwork, a sample $19.99 to $0 price, a deadline 24 hours ahead, and a Steam-style 94% rating with 12,345 reviews. The title and artwork identify it as a test. It uses only local assets/translations, checks browser notification permission, and opens notification settings when clicked. It does not fetch store data, write giveaway delivery/link records, or use campaign deduplication. Shared helpers format Steam rating headers and retry unsupported image notifications as basic notifications without losing their text. The button is disabled only while its request is pending and shows local progress/success/error feedback. Browser acceptance does not guarantee a visible OS banner (for example, Do Not Disturb).

Individual giveaway alerts, reminders and the settings preview say `Скидка 100% до dd.mm.yyyy` / `100% off until dd.mm.yyyy`, using the device-local deadline date. Unknown deadlines omit the date. Exact times remain available in popup/history.

Steam review summaries prefer fresh appreviews data, with a fallback to the English review tooltip in already-fetched search results. The fallback stores the reported percentage and total without fabricating positive/negative vote counts. GOG `reviewsRating / 10` and `reviewsCount` are stored separately as `gogRating` (out of five) and `gogRatingCount`; they are never converted to a positive-review percentage. Popup and history use these store-specific summaries. Missing ratings render no score.

Steam ratings and review-count filters apply only to Steam. Genres match English names case-insensitively; GOG's `Role-playing` and Steam/Epic's `RPG` are treated as the same genre in both directions, preserving original metadata and saved filters. Any selected genre/platform may match within its group; both groups must pass when set. Unknown metadata does not pass an explicitly selected filter. Empty lists disable these filters. Steam uses official appdetails genres, not community tags; platform flags must be enabled. GOG maps `osx` to `mac`.

Reduced store responses in `tests/fixtures/steam-gog-filter-metadata.json` cover metadata normalization, cache reuse, combined filters, counts and notification gating. Giveaway terms in these fixtures are synthetic.

Claimed/ignored marks last until restored; hiding applies only to the current campaign. Snooze requests a fresh alert after checking availability again. Notifications respect filters, personal marks and quiet hours. Individual alerts and reminders include Steam review percentages or GOG ratings out of five plus their counts in `contextMessage`, localized to the selected language. Unknown ratings and batch summaries omit this field; image-to-basic fallback preserves it. Up to three individual alerts plus one summary are issued per batch. Delivery is persisted per successful group; OS errors do not erase a valid scan. Deterministic notification IDs reduce interruption duplicates; image failures fall back to basic notifications. Browser acceptance does not prove native OS display.

Default check interval: 3 hours; reminders: 3 hours before a known end; quiet hours off (23:00–08:00 if enabled); history: 30 days. Limits: 400 recent/archive records, 500 metadata/delivery records and 2,000 personal marks. No persistent polling loop or remote backend.

## Interface

Popup, settings and history support EN/RU and system light/dark themes. Popup artwork and history artwork use one shared 120×56 frame, centered `object-fit: cover`, safe store-specific image URLs and a neutral fallback. Header/capsule candidates are bounded to two; gallery screenshots are excluded. Compact mode removes artwork. Dates expose exact deadlines as well as relative labels.

Settings sections share one form to preserve drafts. Validation reveals the invalid field's section. History becomes stacked records on narrow screens. Storage-driven rerenders preserve open menus, keyboard focus and popup scroll position.

Popup cards show the store link, claim button and three SVG action buttons in one row. Localized tooltips appear on hover and keyboard focus. The New badge is a native button that marks the offer read. Stable focus keys preserve the selected action when that badge disappears; activating the badge returns focus to the card title. History retains its existing action menus.

Cards use a one-line title (full title on hover), a fixed 56 px cover/information block, and one action row. The information block reserves rows for the deadline, rating, and store/type/original-price metadata. Epic uses a short label with its full name in a tooltip. Original prices are struck through, with their meaning in a tooltip. A stale availability indicator shares the rating row, so missing metadata or stale state cannot add a row. Compact view hides artwork and uses a 38 px information block. `scripts/check-card-layout.mjs` checks native popup geometry at 100% and 125%, both languages/themes and both density modes.

## Development checks

Run commands from the repository root. Node.js 24 and PowerShell 7 are the development baseline. Module tests and packaging require no npm dependency installation:

```powershell
npm test
npm run pack
npm run pack:firefox
npm run test:release
```

Packaging copies only production files into `dist/Free-Games-Watcher` or `dist/Free-Games-Watcher-Firefox` and creates a versioned ZIP for the selected browser. It validates required archive entries and the manifest version, and restricts cleanup to resolved build outputs inside `dist`. Firefox ZIPs are unsigned. `test:release` checks signed-download validation and failure handling using offline fixtures; it does not publish anything.

### Browser checks

Install the pinned development dependencies from `package-lock.json` with `npm ci`. Their versions are declared in `package.json`; no development dependencies are shipped in the extension. Chromium checks also need a matching Playwright browser:

```powershell
npm ci
npx playwright install chromium
npm run test:browser
npm run test:backup
npm run test:notifications
npm run test:cards
node scripts/browser-smoke.mjs --popup-scales
```

To reuse a separate Playwright installation, set `PLAYWRIGHT_MODULE` to its `playwright/index.mjs` and `PLAYWRIGHT_BROWSERS_PATH` to the matching browser directory. Card layout checks open an isolated browser window and require a desktop session.

The fixture suites use isolated extensions and profiles under `dist`. They cover UI actions, backup import/export, both locales and themes, source failures, notification delivery and popup geometry. Test bootstrap files and fixtures are never shipped. Reports and screenshots are local outputs under `dist`, excluded from Git.

Firefox setup, browser selection and runtime scenarios are documented in [Firefox development and verification](docs/FIREFOX.md). The [Tests workflow](.github/workflows/test.yml) runs module and release-script tests, packages both targets, lints Firefox, validates changelog extraction and checks Firefox's minimum supported major, ESR and stable channels. CI does not sign or submit browser-store packages.

### Optional live and native checks

```powershell
npm run test:multistore:live
npm run audit:sources
npm run audit:sources:browser
node scripts/check-test-notification.mjs --native
node scripts/check-gog-native-notification.mjs
node scripts/check-gog-native-notification.mjs --steam
```

Live tools query store services and are optional, not CI dependencies. Production-worker live checks disable OS notifications. Store responses vary with time and region; passing fixture tests does not establish current giveaway availability. Recorded positive GOG discovery evidence is documented in [GOG live validation](docs/GOG_LIVE_VALIDATION.ru.md).

Native notification checks use isolated profiles and synthetic or recorded offers. They accept interactive commands on stdin: `send`, `status` and `close`; the GOG/Steam check also accepts `reminder`, and its Steam mode supports `large`. These checks clear their own notifications on exit. Inspect the actual OS banner separately: browser API acceptance does not prove that the operating system displayed it.

## Release documentation

The [maintainer release guide](docs/RELEASING.md) describes version preparation, AMO review, signed-file verification and GitHub publication. User-facing changes are recorded in [CHANGELOG.md](CHANGELOG.md).
