# Free Games Watcher — technical details, 2.2.0

## Runtime and architecture

Manifest V3, Chrome/Edge 120+, ES modules, no runtime/npm dependencies. Development uses Node.js 24 LTS and PowerShell 7; neither is required by extension users.

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

## Rename, identity and compatibility

Product name: **Free Games Watcher**. Repository: `Grim1313/Free-Games-Watcher`. The npm package uses lowercase `free-games-watcher`; release archives use `Free-Games-Watcher-<version>.zip`.

Store IDs remain `app:<id>` / `sub:<id>` for Steam, `epic:<namespace>:<offerId>` for Epic, and `gog:<productId>` for GOG. Campaign identity is independent of HTML, provider metadata and artwork. A new cycle needs a previously confirmed end or elapsed known deadline.

Storage schema 3 preserves schema-2 campaign and delivery records. Legacy settings select Steam only; fresh settings select all three stores. The rename deliberately retains internal alarm names (`steam-promo-check`, `steam-promo-followup`), notification prefix (`steam-promo-watch`), storage keys and the backup format marker (`steam-promo-watch`). These are compatibility identifiers, not visible branding. Changing them requires a separate migration.

Backups export version 3 and accept versions 1, 2 and 3. One JSON file contains saved settings, personal marks and optional `history`; full export is selected by default. History combines current and archived entries with canonical store/offer/type IDs, deduplicates and keeps up to 400 most recent records. Export/import are serialized with storage mutations. Input is limited to 5 MiB of UTF-8, 2,000 marks and 400 history records, with validated identities, timestamps, campaign fields and safe store URLs/artwork. Invalid files write nothing, even when history is unchecked. Runtime caches, delivery maps, notification links and the receiving installation's import guard are not exported. The filename remains `free-games-watcher-backup.json`.

Import previews creation date, country, personal marks and history count, allows history to be unchecked, and requires explicit confirmation. Settings/marks are replaced; selected history is merged with local records taking precedence for duplicate IDs, then capped by recency. Imported records remain outside `latestPromotions` until ordinary discovery, are marked read/stale, and carry a local `importedAt` guard. Campaign assignment retains that guard for the same campaign and clears it for a confirmed new cycle. It suppresses automatic new/retention/reminder notifications without fabricating delivery timestamps. Imported pending snoozes for new archive records are disabled; a new explicit snooze can still request an alert. Normal history-retention rules continue to apply on later scans.

There is no `key` in the manifest. Unpacked installations can change ID when their folder moves. Installed store copies must be updated through the existing store listing, not a newly created item. Product/repository renaming does not itself migrate browser storage between extension IDs.

## Filtering, delivery and resource limits

The settings notification test creates a new image notification with a random ID for every explicit click. Its fictional Starfall Courier sample includes bundled artwork, a sample $19.99 to $0 price, a deadline 24 hours ahead, and a Steam-style 94% rating with 12,345 reviews. The title and artwork identify it as a test. It uses only local assets/translations, checks browser notification permission, and opens notification settings when clicked. It does not fetch store data, write giveaway delivery/link records, or use campaign deduplication. Shared helpers format Steam rating headers and retry unsupported image notifications as basic notifications without losing their text. The button is disabled only while its request is pending and shows local progress/success/error feedback. Browser acceptance does not guarantee a visible OS banner (for example, Do Not Disturb).

Individual giveaway alerts, reminders and the settings preview say `Скидка 100% до dd.mm.yyyy` / `100% off until dd.mm.yyyy`, using the device-local deadline date. Unknown deadlines omit the date. Exact times remain available in popup/history.

Steam review summaries prefer fresh appreviews data, with a fallback to the English review tooltip in already-fetched search results. The fallback stores the reported percentage and total without fabricating positive/negative vote counts. GOG `reviewsRating / 10` and `reviewsCount` are stored separately as `gogRating` (out of five) and `gogRatingCount`; they are never converted to a positive-review percentage. Popup and history use these store-specific summaries. Missing ratings render no score.

Steam ratings and review-count filters apply only to Steam. Genres match English names case-insensitively; GOG's `Role-playing` and Steam/Epic's `RPG` are treated as the same genre in both directions, preserving original metadata and saved filters. Any selected genre/platform may match within its group; both groups must pass when set. Unknown metadata does not pass an explicitly selected filter. Empty lists disable these filters. Steam uses official appdetails genres, not community tags; platform flags must be enabled. GOG maps `osx` to `mac`.

Steam/GOG filtering was checked on 27 October 2026 using live metadata for Portal 2 and The Witcher 3 (Steam), Stardew Valley and The Witcher 3 (GOG). Reduced responses in `tests/fixtures/steam-gog-filter-metadata.json` exercise discovery, normalization, storage, Steam cache reuse, combined filters, counts and notification gating. A separate live Steam Stardew Valley enrichment check confirmed RPG filtering with each of Windows, Mac and Linux. Giveaway terms in these tests are synthetic: GOG's live homepage still had no active giveaway section, so this verifies metadata/filtering, not a live GOG claim or positive giveaway schema.

Claimed/ignored marks last until restored; hiding applies only to the current campaign. Snooze requests a fresh alert after checking availability again. Notifications respect filters, personal marks and quiet hours. Individual alerts and reminders include Steam review percentages or GOG ratings out of five plus their counts in `contextMessage`, localized to the selected language. Unknown ratings and batch summaries omit this field; image-to-basic fallback preserves it. Up to three individual alerts plus one summary are issued per batch. Delivery is persisted per successful group; OS errors do not erase a valid scan. Deterministic notification IDs reduce interruption duplicates; image failures fall back to basic notifications. Browser acceptance does not prove native OS display.

Default check interval: 3 hours; reminders: 3 hours before a known end; quiet hours off (23:00–08:00 if enabled); history: 30 days. Limits: 400 recent/archive records, 500 metadata/delivery records and 2,000 personal marks. No persistent polling loop or remote backend.

## Interface

Popup, settings and history support EN/RU and system light/dark themes. Popup artwork and history artwork use one shared 120×56 frame, centered `object-fit: cover`, safe store-specific image URLs and a neutral fallback. Header/capsule candidates are bounded to two; gallery screenshots are excluded. Compact mode removes artwork. Dates expose exact deadlines as well as relative labels.

Settings sections share one form to preserve drafts. Validation reveals the invalid field's section. History becomes stacked records on narrow screens. Storage-driven rerenders preserve open menus, keyboard focus and popup scroll position.

Popup cards show the store link, claim button and three SVG action buttons in one row. Localized tooltips appear on hover and keyboard focus. The New badge is a native button that marks the offer read. Stable focus keys preserve the selected action when that badge disappears; activating the badge returns focus to the card title. History retains its existing action menus.

## Development checks

```powershell
npm test
npm run pack
pwsh -File scripts/get-release-notes.ps1
```

No npm install is required. Packaging copies only manifest, source, locales, license and icons into `dist/Free-Games-Watcher`, then builds `dist/Free-Games-Watcher-2.2.0.zip`. It validates required archive entries and version and restricts cleanup to resolved build outputs inside `dist`.

Browser checks use a separately installed Playwright/Chromium. Set `PLAYWRIGHT_MODULE` to an existing `playwright/index.mjs` and `PLAYWRIGHT_BROWSERS_PATH` to the matching browser directory:

```powershell
npm run test:browser
npm run test:backup
node scripts/browser-smoke.mjs --popup-scales
npm run test:multistore:live
npm run audit:sources
npm run audit:sources:browser
```

The fixture browser suite stages an isolated extension/profile in `dist/browser-check`. It covers UI/actions, backup export/import, both locales/themes, source failures and native popup geometry. Test bootstrap files are never shipped. Live tools perform anonymous requests and are optional, not CI dependencies; production-worker live checks disable OS notifications. Reports/screenshots are saved under `dist`.

The focused notification check uses an isolated profile, blocks external requests and tests repeated clicks, pending requests, permission denial, failure/retry, artwork decoding and feedback layout. `node scripts/check-test-notification.mjs --native` enables an optional headed OS check; it accepts `send`, `status` and `close` on stdin and clears its own test notifications on exit. On 31 October 2026, real Windows banners from two successive button clicks were visually verified with the fictional artwork, title, complete rating/count, discount deadline and sample price. Evidence: `dist/test-notification-check/verified-windows-demo.png` and `native-result.json`.

## Release procedure

1. Update manifest/package version, localized branding and the matching `CHANGELOG.md` section. Run unit/browser/package checks.
2. Commit with the maintainer's configured Git identity and push the branch. Wait for the `Tests` workflow.
3. For a release attributed to the maintainer, create a **draft release in GitHub's UI under that account**, with the intended tag, title and changelog text, before pushing the tag.
4. Push the matching `v2.2.0` tag. The `Release` workflow validates version, runs tests and builds the ZIP. When a draft exists, it updates notes/assets but leaves it unpublished and keeps its author. Without an existing release, the workflow retains its automatic publication behavior.
5. Verify the completed workflow and ZIP, then publish the draft from the maintainer's account and mark it latest. GitHub Actions supplies the archive; no locally built ZIP needs uploading.

The workflows use `actions/checkout@v7`, `actions/setup-node@v7`, Node 24 and `windows-latest`. A branch push runs validation, not publication. Manual dispatch takes an existing tag. Reruns can update an existing release asset; inspect the selected revision before retrying. Chrome Web Store publication is separate.

## GOG live validation, 31 October 2026

A New Beginning: Final Cut (`gog:1207659150`) was discovered anonymously in both US/RU by the production MV3 worker. Popup/history presence, loaded artwork, the homepage claim destination and the exact deadline (2 November 2026, 14:00:59 UTC) were verified. Both scans completed successfully. The reduced real response in `tests/fixtures/gog-a-new-beginning.json` covers parsing, expiration at the deadline, storage and duplicate-notification prevention. GOG requires its own account/consent flow to claim; no game was claimed during verification. Details: [GOG live validation](docs/GOG_LIVE_VALIDATION.ru.md).

## Validation record

Version 2.2.0 consolidates store-specific ratings, compact card geometry, themed store labels, complete offline notification previews, and optional history transfer with backup format 3. Storage schema, existing extension identity and permissions are unchanged. Imported campaign guards preserve historical discovery/delivery dates and prevent automatic duplicate alerts until a confirmed new giveaway cycle.

Release validation passed: 160 module tests, 162 general browser checks, 11 backup UI checks, 12 notification checks, and 16 native popup layout scenarios at 100% and 125% scale. The packaged ZIP contains 50 files, including the offline notification artwork, and its manifest reports version 2.2.0.

Backup/history transfer, 31 October 2026: 160 module tests passed, including v1/v2 compatibility, optional history, canonical deduplication, local-record precedence, malformed/oversized input with atomic rejection, safe URL normalization and real scanner suppression followed by new-campaign notification eligibility. `node scripts/check-backup-ui.mjs` passed 11 end-to-end scenarios using actual settings controls and downloaded files: export choices, preview/cancel, unchecked history, merge/reimport, legacy import and invalid-file recovery. Eight screenshots cover EN/RU, light/dark and 1100/360 px widths under `dist/backup-ui-check`. No release was published.

Native Windows Steam banners, 31 October 2026: visually verified individual alerts and reminders in an isolated headed Chrome for Testing 151 profile. The original verbose header clipped the review count. The compact header now shows `Steam: 86% · 49 353 отзывов` in full; counts below 100,000 retain all digits, while larger counts use localized compact notation. A stress case (`Steam: 100% · 12,3 млн отзывов`) also fits. These are synthetic notification fixtures using Graveyard Keeper artwork, not live rating or giveaway claims. Full popup/history tooltips are unchanged. Run `node scripts/check-gog-native-notification.mjs --steam`; stdin commands are `send`, `reminder`, `large`, `status` and `close`. Screenshots and native API records are in `dist/steam-native-notification`. All 152 module tests passed, including English/Russian formatting, reminders, missing counts, summaries and image-to-basic fallback. Test notifications were cleared and the isolated browser closed; no Windows settings were changed and no release was published.

Native Windows GOG banners, 31 October 2026: visually verified both an individual alert and a reminder from production notification code in an isolated headed Chrome for Testing 151 profile. Windows truncated the original verbose context header; a dedicated compact translation (`GOG: 3,6/5 · 649 оценок`) now fits with rating and count visible. The title, deadline, extension icon and game artwork also rendered. The fixture is the recorded A New Beginning response, not a new claim or live count check. `scripts/check-gog-native-notification.mjs` accepts `send`, `reminder`, `status` and `close`; it disables automatic discovery and clears only its own notifications on exit. Screenshots and API records are in `dist/gog-native-notification`. No Windows notification settings were changed.

Local changes after 2.1.1, 31 October 2026: 147 module tests and 162 browser checks passed. Live US/RU scans recovered Steam ratings (Hexologic 96%, Asleep: Act 1 91%) and GOG A New Beginning 3.6/5 through the production worker. Native popup card checks cover 16 combinations of 100%/125% display scale, English/Russian, light/dark and normal/compact views, including long titles/prices, missing ratings and stale availability. No release or deployment was performed. Reports: `dist/rating-live-check`, `dist/card-layout-check`, `dist/rating-card-audit`.

Version 2.1.1, 30 October 2026: 139 module tests and 162 browser checks passed. Regression tests cover current/upcoming permanently free Epic entries, mixed and all-free feeds, invalid/missing prices, and successful scan status without extra notifications. Live US/RU feed checks skipped Idle Champions of the Forgotten Realms without warnings. A clean Chromium profile running the production worker completed all three store checks successfully in both regions, still found Mafia Hotel, and displayed the popup without the incomplete-check warning. Local release packaging passed validation.

Version 2.1.0, 27 October 2026: 136 module tests, 162 general browser checks and 12 focused notification-button checks passed. Local packaging validates the release manifest, required files and exclusion of development fixtures. The real Mafia Hotel response is covered by reduced Epic and EGData fixtures, including prices, deadlines, deduplication, source recovery, pagination, country restrictions and rejection of mobile/test/conditional offers. A clean Chromium profile running the production MV3 worker found five current Epic games in both US and RU: Mafia Hotel, GetHigh.EXE, Terraspace, Home and Sker Ritual. Mafia Hotel's original price was $1.99 / RUB 60.00 and its deadline was 1 November 2026 at 17:02 UTC. Popup/history presence and loaded artwork were checked. Run `node scripts/check-multistore-live.mjs --expect-epic-slug=mafia-hotel-eaea4c` while this giveaway remains active; reports and screenshots are in `dist/multistore-live`.

The exact filtered Epic GraphQL query returned five offers in the existing Chrome session, but direct anonymous Node and clean-extension requests returned HTTP 403. The authorized EGData fallback returned HTTP 200 without account credentials and supplied the three additional games. This is an Epic storefront access limitation, not a reason to disable certificate/network protections. Environment security settings were not changed. EGData request/price semantics are documented at [Find games](https://docs.egdata.app/docs/offer-search) and [Prices](https://docs.egdata.app/docs/price-availability).

Version 2.0.0: 106 module tests and 157 browser checks passed, and the release ZIP passed packaging validation. Before renaming, 40 additional display-scale checks passed at 100–200%. Live US/RU checks returned successful responses for all three stores, two current Epic games and one Steam DLC hidden by default; GOG returned an empty result. At that release, positive GOG giveaway validation was still pending; it was completed on 31 October 2026 (see the GOG validation record below). Native Windows notification visibility and older browser versions remain unverified. Current release-validation outputs are kept under `dist/release-2.0.0-*`.

### Compact popup cards

Cards use a one-line title (full title on hover), a fixed 56 px cover/information block, and one action row. The information block reserves rows for the deadline, rating, and store/type/original-price metadata. Epic uses a short label with its full name in a tooltip. Original prices are struck through, with their meaning in a tooltip. A stale availability indicator shares the rating row, so missing metadata or stale state cannot add a row. Compact view hides artwork and uses a 38 px information block. `scripts/check-card-layout.mjs` checks native popup geometry at 100% and 125%, both languages/themes and both density modes.
