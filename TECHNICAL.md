# Free Games Watcher — technical details, 2.1.1

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

**GOG (experimental):** public homepage section configuration plus one bounded discounted-zero catalog query. Up to three public `GIVEAWAY_SECTION` records are fetched. Product identity/title/slug and valid end date are required; the claim destination is GOG's homepage. Zero-price catalog entries without giveaway terms produce an incomplete result, never a fabricated giveaway. The positive section schema was inferred from GOG's public component and tested with synthetic fixtures. No active live section was available on 26 October 2026, so positive live validation remains outstanding. The `sectionSchemaLiveVerified: false` diagnostic records this limitation. No account-status or authenticated claim endpoint is called.

The initial [source audit](docs/SOURCE_AUDIT.ru.md) and [implementation report](docs/MULTISTORE_IMPLEMENTATION.ru.md) preserve dated evidence. Microsoft Store/Xbox, itch.io, IndieGala and Ubisoft remain future work.

## Rename, identity and compatibility

Product name: **Free Games Watcher**. Repository: `Grim1313/Free-Games-Watcher`. The npm package uses lowercase `free-games-watcher`; release archives use `Free-Games-Watcher-<version>.zip`.

Store IDs remain `app:<id>` / `sub:<id>` for Steam, `epic:<namespace>:<offerId>` for Epic, and `gog:<productId>` for GOG. Campaign identity is independent of HTML, provider metadata and artwork. A new cycle needs a previously confirmed end or elapsed known deadline.

Storage schema 3 preserves schema-2 campaign and delivery records. Legacy settings select Steam only; fresh settings select all three stores. The rename deliberately retains internal alarm names (`steam-promo-check`, `steam-promo-followup`), notification prefix (`steam-promo-watch`), storage keys and the backup format marker (`steam-promo-watch`). These are compatibility identifiers, not visible branding. Changing them requires a separate migration.

Backups export version 2 and accept versions 1 and 2. They contain normalized settings and personal marks, not full history, caches or delivery records. Import validates the format, size (1 MiB), ID syntax and mark count (2,000), previews the country/count, and requires confirmation in the interface. Failed validation writes nothing. The exported filename is `free-games-watcher-backup.json`.

There is no `key` in the manifest. Unpacked installations can change ID when their folder moves. Installed store copies must be updated through the existing store listing, not a newly created item. Product/repository renaming does not itself migrate browser storage between extension IDs.

## Filtering, delivery and resource limits

The settings notification test creates a new basic notification with a random ID for every explicit click. It uses only the extension icon/local translations, checks browser notification permission, and opens notification settings when clicked. It does not fetch Steam artwork, write giveaway delivery/link records, or use campaign deduplication. The button is disabled only while its request is pending and shows local progress/success/error feedback. Browser acceptance does not guarantee a visible OS banner (for example, Do Not Disturb).

Steam ratings and review-count filters apply only to Steam. Genres match English names case-insensitively; GOG's `Role-playing` and Steam/Epic's `RPG` are treated as the same genre in both directions, preserving original metadata and saved filters. Any selected genre/platform may match within its group; both groups must pass when set. Unknown metadata does not pass an explicitly selected filter. Empty lists disable these filters. Steam uses official appdetails genres, not community tags; platform flags must be enabled. GOG maps `osx` to `mac`.

Steam/GOG filtering was checked on 27 October 2026 using live metadata for Portal 2 and The Witcher 3 (Steam), Stardew Valley and The Witcher 3 (GOG). Reduced responses in `tests/fixtures/steam-gog-filter-metadata.json` exercise discovery, normalization, storage, Steam cache reuse, combined filters, counts and notification gating. A separate live Steam Stardew Valley enrichment check confirmed RPG filtering with each of Windows, Mac and Linux. Giveaway terms in these tests are synthetic: GOG's live homepage still had no active giveaway section, so this verifies metadata/filtering, not a live GOG claim or positive giveaway schema.

Claimed/ignored marks last until restored; hiding applies only to the current campaign. Snooze requests a fresh alert after checking availability again. Notifications respect filters, personal marks and quiet hours. Up to three individual alerts plus one summary are issued per batch. Delivery is persisted per successful group; OS errors do not erase a valid scan. Deterministic notification IDs reduce interruption duplicates; image failures fall back to basic notifications. Browser acceptance does not prove native OS display.

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

No npm install is required. Packaging copies only manifest, source, locales, license and icons into `dist/Free-Games-Watcher`, then builds `dist/Free-Games-Watcher-2.1.1.zip`. It validates required archive entries and version and restricts cleanup to resolved build outputs inside `dist`.

Browser checks use a separately installed Playwright/Chromium. Set `PLAYWRIGHT_MODULE` to an existing `playwright/index.mjs` and `PLAYWRIGHT_BROWSERS_PATH` to the matching browser directory:

```powershell
npm run test:browser
node scripts/browser-smoke.mjs --popup-scales
npm run test:multistore:live
npm run audit:sources
npm run audit:sources:browser
```

The fixture browser suite stages an isolated extension/profile in `dist/browser-check`. It covers UI/actions, backup export/import, both locales/themes, source failures and native popup geometry. Test bootstrap files are never shipped. Live tools perform anonymous requests and are optional, not CI dependencies; production-worker live checks disable OS notifications. Reports/screenshots are saved under `dist`.

The focused notification check uses an isolated profile, blocks external requests and tests repeated clicks, pending requests, permission denial, failure/retry and feedback layout. `node scripts/check-test-notification.mjs --native` enables an optional headed OS check; it accepts `send`, `status` and `close` on stdin and clears its own test notifications on exit. Two native API submissions were accepted in 47 ms and 16 ms; Windows banner visibility remains unverified.

## Release procedure

1. Update manifest/package version, localized branding and the matching `CHANGELOG.md` section. Run unit/browser/package checks.
2. Commit with the maintainer's configured Git identity and push the branch. Wait for the `Tests` workflow.
3. For a release attributed to the maintainer, create a **draft release in GitHub's UI under that account**, with the intended tag, title and changelog text, before pushing the tag.
4. Push the matching `v2.1.1` tag. The `Release` workflow validates version, runs tests and builds the ZIP. When a draft exists, it updates notes/assets but leaves it unpublished and keeps its author. Without an existing release, the workflow retains its automatic publication behavior.
5. Verify the completed workflow and ZIP, then publish the draft from the maintainer's account and mark it latest. GitHub Actions supplies the archive; no locally built ZIP needs uploading.

The workflows use `actions/checkout@v7`, `actions/setup-node@v7`, Node 24 and `windows-latest`. A branch push runs validation, not publication. Manual dispatch takes an existing tag. Reruns can update an existing release asset; inspect the selected revision before retrying. Chrome Web Store publication is separate.

## Validation record

Version 2.1.1, 30 October 2026: 139 module tests and 162 browser checks passed. Regression tests cover current/upcoming permanently free Epic entries, mixed and all-free feeds, invalid/missing prices, and successful scan status without extra notifications. Live US/RU feed checks skipped Idle Champions of the Forgotten Realms without warnings. A clean Chromium profile running the production worker completed all three store checks successfully in both regions, still found Mafia Hotel, and displayed the popup without the incomplete-check warning. Local release packaging passed validation.

Version 2.1.0, 27 October 2026: 136 module tests, 162 general browser checks and 12 focused notification-button checks passed. Local packaging validates the release manifest, required files and exclusion of development fixtures. The real Mafia Hotel response is covered by reduced Epic and EGData fixtures, including prices, deadlines, deduplication, source recovery, pagination, country restrictions and rejection of mobile/test/conditional offers. A clean Chromium profile running the production MV3 worker found five current Epic games in both US and RU: Mafia Hotel, GetHigh.EXE, Terraspace, Home and Sker Ritual. Mafia Hotel's original price was $1.99 / RUB 60.00 and its deadline was 1 November 2026 at 17:02 UTC. Popup/history presence and loaded artwork were checked. Run `node scripts/check-multistore-live.mjs --expect-epic-slug=mafia-hotel-eaea4c` while this giveaway remains active; reports and screenshots are in `dist/multistore-live`.

The exact filtered Epic GraphQL query returned five offers in the existing Chrome session, but direct anonymous Node and clean-extension requests returned HTTP 403. The authorized EGData fallback returned HTTP 200 without account credentials and supplied the three additional games. This is an Epic storefront access limitation, not a reason to disable certificate/network protections. Environment security settings were not changed. EGData request/price semantics are documented at [Find games](https://docs.egdata.app/docs/offer-search) and [Prices](https://docs.egdata.app/docs/price-availability).

Version 2.0.0: 106 module tests and 157 browser checks passed, and the release ZIP passed packaging validation. Before renaming, 40 additional display-scale checks passed at 100–200%. Live US/RU checks returned successful responses for all three stores, two current Epic games and one Steam DLC hidden by default; GOG returned an empty result. Positive GOG giveaway validation, native Windows notification visibility and older browser versions remain unverified. Current release-validation outputs are kept under `dist/release-2.0.0-*`.
