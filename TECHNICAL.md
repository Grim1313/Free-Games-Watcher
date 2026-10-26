# Free Games Watcher — technical details, 2.0.0

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

**Epic Games Store:** anonymous regional `freeGamesPromotions` JSON. Current giveaways require valid dates, a PERCENTAGE promotion with `discountPercentage: 0`, positive original price, current zero price and a valid product link. Future windows remain in `upcomingPromotions`, separate from current cards, counts and notifications. Their start schedules a fresh availability check. Genre/platform metadata is not present in this feed and remains unknown.

**GOG (experimental):** public homepage section configuration plus one bounded discounted-zero catalog query. Up to three public `GIVEAWAY_SECTION` records are fetched. Product identity/title/slug and valid end date are required; the claim destination is GOG's homepage. Zero-price catalog entries without giveaway terms produce an incomplete result, never a fabricated giveaway. The positive section schema was inferred from GOG's public component and tested with synthetic fixtures. No active live section was available on 26 October 2026, so positive live validation remains outstanding. The `sectionSchemaLiveVerified: false` diagnostic records this limitation. No account-status or authenticated claim endpoint is called.

The initial [source audit](docs/SOURCE_AUDIT.ru.md) and [implementation report](docs/MULTISTORE_IMPLEMENTATION.ru.md) preserve dated evidence. Microsoft Store/Xbox, itch.io, IndieGala and Ubisoft remain future work.

## Rename, identity and compatibility

Product name: **Free Games Watcher**. Repository: `Grim1313/Free-Games-Watcher`. The npm package uses lowercase `free-games-watcher`; release archives use `Free-Games-Watcher-<version>.zip`.

Store IDs remain `app:<id>` / `sub:<id>` for Steam, `epic:<namespace>:<offerId>` for Epic, and `gog:<productId>` for GOG. Campaign identity is independent of HTML, provider metadata and artwork. A new cycle needs a previously confirmed end or elapsed known deadline.

Storage schema 3 preserves schema-2 campaign and delivery records. Legacy settings select Steam only; fresh settings select all three stores. The rename deliberately retains internal alarm names (`steam-promo-check`, `steam-promo-followup`), notification prefix (`steam-promo-watch`), storage keys and the backup format marker (`steam-promo-watch`). These are compatibility identifiers, not visible branding. Changing them requires a separate migration.

Backups export version 2 and accept versions 1 and 2. They contain normalized settings and personal marks, not full history, caches or delivery records. Import validates the format, size (1 MiB), ID syntax and mark count (2,000), previews the country/count, and requires confirmation in the interface. Failed validation writes nothing. The exported filename is `free-games-watcher-backup.json`.

There is no `key` in the manifest. Unpacked installations can change ID when their folder moves. Installed store copies must be updated through the existing store listing, not a newly created item. Product/repository renaming does not itself migrate browser storage between extension IDs.

## Filtering, delivery and resource limits

Steam ratings and review-count filters apply only to Steam. Genres match English names case-insensitively; any selected genre/platform may match. Unknown metadata does not pass an explicitly selected filter. Empty lists disable these filters.

Claimed/ignored marks last until restored; hiding applies only to the current campaign. Snooze requests a fresh alert after checking availability again. Notifications respect filters, personal marks and quiet hours. Up to three individual alerts plus one summary are issued per batch. Delivery is persisted per successful group; OS errors do not erase a valid scan. Deterministic notification IDs reduce interruption duplicates; image failures fall back to basic notifications. Browser acceptance does not prove native OS display.

Default check interval: 3 hours; reminders: 3 hours before a known end; quiet hours off (23:00–08:00 if enabled); history: 30 days. Limits: 400 recent/archive records, 500 metadata/delivery records and 2,000 personal marks. No persistent polling loop or remote backend.

## Interface

Popup, settings and history support EN/RU and system light/dark themes. Popup artwork and history artwork use one shared 120×56 frame, centered `object-fit: cover`, safe store-specific image URLs and a neutral fallback. Header/capsule candidates are bounded to two; gallery screenshots are excluded. Compact mode removes artwork. Dates expose exact deadlines as well as relative labels.

Settings sections share one form to preserve drafts. Validation reveals the invalid field's section. History becomes stacked records on narrow screens. Storage-driven rerenders preserve open menus, keyboard focus and popup scroll position.

## Development checks

```powershell
npm test
npm run pack
pwsh -File scripts/get-release-notes.ps1
```

No npm install is required. Packaging copies only manifest, source, locales, license and icons into `dist/Free-Games-Watcher`, then builds `dist/Free-Games-Watcher-2.0.0.zip`. It validates required archive entries and version and restricts cleanup to resolved build outputs inside `dist`.

Browser checks use a separately installed Playwright/Chromium. Set `PLAYWRIGHT_MODULE` to an existing `playwright/index.mjs` and `PLAYWRIGHT_BROWSERS_PATH` to the matching browser directory:

```powershell
npm run test:browser
node scripts/browser-smoke.mjs --popup-scales
npm run test:multistore:live
npm run audit:sources
npm run audit:sources:browser
```

The fixture browser suite stages an isolated extension/profile in `dist/browser-check`. It covers UI/actions, backup export/import, both locales/themes, source failures and native popup geometry. Test bootstrap files are never shipped. Live tools perform anonymous requests and are optional, not CI dependencies; production-worker live checks disable OS notifications. Reports/screenshots are saved under `dist`.

## Release procedure

1. Update manifest/package version, localized branding and the matching `CHANGELOG.md` section. Run unit/browser/package checks.
2. Commit with the maintainer's configured Git identity and push the branch. Wait for the `Tests` workflow.
3. For a release attributed to the maintainer, create a **draft release in GitHub's UI under that account**, with the intended tag, title and changelog text, before pushing the tag.
4. Push the matching `v2.0.0` tag. The `Release` workflow validates version, runs tests and builds the ZIP. When a draft exists, it updates notes/assets but leaves it unpublished and keeps its author. Without an existing release, the workflow retains its automatic publication behavior.
5. Verify the completed workflow and ZIP, then publish the draft from the maintainer's account and mark it latest. GitHub Actions supplies the archive; no locally built ZIP needs uploading.

The workflows use `actions/checkout@v7`, `actions/setup-node@v7`, Node 24 and `windows-latest`. A branch push runs validation, not publication. Manual dispatch takes an existing tag. Reruns can update an existing release asset; inspect the selected revision before retrying. Chrome Web Store publication is separate.

## Validation record

Version 2.0.0: 106 module tests and 157 browser checks passed, and the release ZIP passed packaging validation. Before renaming, 40 additional display-scale checks passed at 100–200%. Live US/RU checks returned successful responses for all three stores, two current Epic games and one Steam DLC hidden by default; GOG returned an empty result. Positive GOG giveaway validation, native Windows notification visibility and older browser versions remain unverified. Current release-validation outputs are kept under `dist/release-2.0.0-*`.
