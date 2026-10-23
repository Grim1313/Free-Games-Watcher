# Technical details — 1.0.0

## Runtime and architecture

Manifest V3, Chrome/Edge 120+, ES modules, no runtime or npm dependencies. Development uses Node.js 24 LTS (current verified stable on 2026-10-23: 24.22.1; local preinstalled test runtime: 24.14.1). Node is not needed by extension users.

- `service-worker.js`: synchronous event registration, initialization gate, message routing and alarm restoration at every worker start.
- `queue.js`: serializes local read/modify/write operations. Network discovery is outside the queue; the commit re-reads current marks, filters and history. Results are discarded if tracking was paused or the region changed during a request.
- `promotions.js`: campaign lifecycle, complete/partial/error states, scan commits and notification eligibility.
- `actions.js`: claimed games, permanent ignores, campaign-only hiding and temporary snooze. These records are independent of disposable history and delivery state.
- `scheduler.js`: one regular check alarm and at most one follow-up alarm (quiet-hours end, reminder, snooze or known expiry). No persistent polling loop. Popup-relative dates refresh only while the popup is open.
- `_locales/en` and `_locales/ru`: manifest strings, interface and notifications. Interface language can be selected independently of the English parsing language.

## Discovery and limits

The selected country is applied consistently to search, featured offers, details, purchase verification and deadline lookups. Requests omit Steam credentials, except the existing age-gate deadline fallback, which may reuse browser cookies. No Steam account connection or API key is required.

Two search strategies paginate independently, up to six pages of 100 results each. Pagination stops at the reported result count. The old English-support filter is removed. Failed pages are reported, and invalid response shapes cannot masquerade as a successful empty result. Featured offers are a limited fallback, not a full catalog.

Previously active offers missing from search are verified in batches against StoreBrowse purchase options (up to 100 missing offers per check). A free-to-keep option recovers the offer. An explicit paid option or an elapsed known deadline ends it; missing/failed data keeps the old offer with a stale marker. A successful bounded search is called complete even if a search budget was reached; **this does not guarantee full Steam-wide coverage**. Coverage limitations are shown in diagnostics.

App details and review summaries are cached for seven days. Known imminent deadlines refresh hourly; other deadlines and negative deadline results refresh after six hours. Region changes invalidate metadata. Unconfirmed content types stay unknown instead of becoming games automatically.

## Identity, marks and delivery

Campaign identity is independent of provider, HTML, review counts, images and deadline corrections. A new campaign requires a previously confirmed end or elapsed known deadline. Legacy IDs and notification records are migrated once to schema 2 without resending everything.

- Claimed and ignored marks apply to the game until restored.
- Hide applies only to the current campaign.
- Snooze hides the game temporarily and requests a fresh alert when due, after checking availability again.
- Opening the popup does not clear unread marks. Users mark one or all entries explicitly.
- Notifications and reminders respect filters, personal marks and quiet hours.
- Up to three individual alerts plus one summary are issued per batch. The summary opens the extension's list.
- Successful groups are recorded individually. An OS delivery failure does not discard the scan; failed groups can be retried. Deterministic notification IDs reduce duplicates after interruption. Image failures fall back to basic notifications.
- The OS can suppress a notification even after the browser accepts it. The test-notification message explains this limitation.

Default interval: 3 hours; reminders: enabled, 3 hours before a known end; quiet hours: off (23:00–08:00 if enabled); archive: 30 days. Storage is bounded: 400 recent/archive records, 500 metadata and dedupe records, 2,000 personal marks. Personal marks are independent of archive clearing.

## Filters and transfer

Rating threshold and review-count threshold use Steam review totals. The explicit unrated policy applies when review data is unavailable. Genre matching is case-insensitive against Steam's English genre names; any selected genre/platform can match. Empty lists disable those filters. Unknown genre/platform metadata does not pass a selected filter.

JSON backups include normalized settings and personal marks, not the archive, cached metadata or notification delivery records. Import validates format/version/size (maximum 1 MiB and 2,000 marks), previews country/count in the UI, and replaces settings and marks only after the user's confirmation. Failed validation writes nothing. Export a backup before replacing an unpacked installation with a different extension entry.

## Development checks

```powershell
npm test
npm run pack
```

No npm install is needed for the Node test suite or packaging. The archive includes only manifest, source, locales, license and icons. Its required entries and manifest version are checked after creation. GitHub CI and the release workflow run the tests; the release workflow also verifies that the tag matches the manifest. Local work does not create a tag, commit, release or push.

Optional browser tests use Playwright 1.62.1 with its Chromium and an isolated profile. Install it as test tooling outside the release, or set `PLAYWRIGHT_MODULE` to an existing `playwright/index.mjs` and `PLAYWRIGHT_BROWSERS_PATH` to its browser directory, then run:

```powershell
npm run test:browser
```

The script stages a test-only extension under `dist/browser-check`, supplies deterministic Steam responses, exercises real extension pages/storage/alarms/message routing, and saves screenshots plus `focus-results.json`. `focus-ui-checks.mjs` covers all settings sections, both locales/themes, text contrast, narrow layouts, cross-section validation, draft preservation, keyboard menus during storage updates, secondary actions with undo, and actual JSON export/import. `native-popup-checks.mjs` opens real toolbar popups with `chrome.action.openPopup()` and inspects their unmodified, content-driven size over CDP: 0/2/12 offers, EN/RU, both themes, collapsed/expanded status, list height and footer separation. It does not substitute a tab with an assigned viewport. `artwork-ui-checks.mjs` verifies header selection, capsule fallback after HTTP failure, missing artwork, no gallery requests, preserved links/details, both themes and narrow history layouts. Its wide SVG artwork fixture has edge marks to make cropping visible. The browser needs write access to `dist/browser-check/downloads` to complete the export check. Test bootstrap files are never copied into `src` or the release archive. Browser tests do not prove native Windows notification visibility or full live catalog coverage.

Optional anonymous live-source checks (do not invoke on every CI run):

```powershell
node scripts/check-live.mjs US
node scripts/check-live.mjs RU
```

These write timestamped reports under `dist/` and check actual Steam search, featured offers and metadata for up to three candidates. For systems using a trusted enterprise certificate store, Node's `--use-system-ca` can be used without disabling certificate verification.

## Local validation — 2026-10-23

- Node.js test suite: 85 passed, 0 failed. Covers migration, source errors, filtering, personal marks, concurrency, notification retries, reminders, quiet hours and backup validation.
- Isolated Chromium 151.0.7922.34 extension test on Node.js 24.14.1: 138 checks passed, no page JavaScript errors. Covers real UI/message/storage/alarm integration, both locales/themes and all seven settings sections, narrow layouts, text contrast, validation in inactive sections, draft preservation, menu/focus continuity, read/claim/undo/restore, snooze/hide/ignore, actual backup export/import, empty/error/partial states, pause/resume and region changes. Includes 24 native action-popup geometry checks in addition to the tab-based checks. An additional 40 headed Chromium checks passed at 100%, 125%, 150%, 175% and 200% display scale (EN/RU, light/dark, collapsed/expanded status). At 100% and 125%, two fully detailed DLC cards with long titles fit without list scrolling. Final screenshots were visually inspected. Results are saved in `dist/browser-check/focus-results.json`.
- Anonymous live Steam checks performed before the Focus redesign: US and RU both returned valid responses. Seven search pages per region found two DLC offers; metadata, platforms and deadlines were parsed. Both reports explicitly recorded limited search coverage. Default DLC filtering hides these offers. The redesign was tested with deterministic source fixtures; these live requests were not repeated.
- Local ZIP: built successfully with version 1.0.0; required files and exclusion of development/test files verified by the packaging script.
- Native Windows notification visibility and older browser versions were not tested interactively. Browser acceptance does not prove OS display; full Steam-wide discovery is not guaranteed.

## Compatibility and scope

Uses longstanding `chrome.alarms` behavior and verifies/restores scheduled work rather than requiring the new Chrome 150 persistence option. Local tests cover midnight quiet intervals, interrupted checks, concurrent actions, migration, source failures, reminders, cache TTL and backup validation.

Steam login/library synchronization, automatic claiming, other stores and Free Weekend tracking are outside this release.

## Focus interface

- Shared theme tokens use system light/dark media queries. No runtime dependencies, remote fonts or additional permissions were added.
- The popup requests 410 × 600 CSS pixels on the root element, avoiding Chrome's initial action-popup viewport becoming its permanent size. The inner layout fits the available height, with its own scrollable offer list and persistent navigation/actions. The brand row and collapsed status row are both 41 CSS pixels high. Tighter card spacing keeps two complete offers visible at 100%/125%; scrolling remains available at 150% and above or for longer lists. Compact mode removes artwork; ratings, content type and base price remain available. Exact deadlines are exposed via title and accessible labels alongside relative time.
- Popup and history display 120 × 56 CSS-pixel artwork with `object-fit: contain`; the full title sits above the image and metadata. The UI tries sanitized explicit header/capsule URLs in order (at most two candidates), or a generated legacy header URL when no explicit cover exists. Failed/missing covers keep a neutral placeholder and the Steam link without shifting the row. Gallery screenshots are never candidates for these two screens. Notification artwork behavior is unchanged.
- Seven settings sections share one form, so switching sections preserves unsaved values. Hash links support direct navigation and browser history. Validation reveals the first invalid field before the browser focuses it; the save bar remains reachable on long sections.
- History keeps search, sorting, status filters, separate campaign/personal states, first discovery and last notification dates, and all original actions. Narrow layouts turn table rows into stacked records.
- Storage-driven rerenders preserve open menus, keyboard focus and popup scroll position. Escape closes an action menu and returns focus to its trigger.

## Release maintenance

Release preparation on 2026-10-23 rechecked all 85 unit tests and 138 browser checks successfully. The browser run needed write access outside the restricted execution sandbox for its test backup download. The rebuilt ZIP's 43 files were compared against the current sources by SHA-256; the release-notes extractor returned the eight intended bullets for 1.0.0. Publication itself remains untested until the user pushes the tag.

The `Tests` workflow runs unit tests, validates the release archive, and checks that the manifest version has an entry in `CHANGELOG.md` on every push and pull request. Both workflows use `actions/checkout@v7`, `actions/setup-node@v7`, and the latest available Node.js 24 LTS patch on `windows-latest`. The v7 migration does not affect these workflows: they use neither privileged fork checkout triggers nor npm registry authentication.

To publish 1.0.0 through GitHub Desktop:

1. Review and commit all release changes on `main`, including new source, locale, test and workflow files. Build outputs under `dist/` are intentionally ignored.
2. Push the commit and wait for the `Tests` workflow to pass.
3. In Desktop's **History**, right-click that release commit, select **Create Tag**, and enter `v1.0.0`.
4. Push the tag. The `Release` workflow checks the tag against `manifest.json`, runs tests, builds `steam-promo-watch-1.0.0.zip`, extracts the `1.0.0` changelog section, and publishes the release with its ZIP.
5. Verify the successful workflow and the named ZIP under the GitHub release's **Assets**.

`CHANGELOG.md` is maintained manually before committing. Its matching section becomes the release description automatically; commit messages do not generate that section. A branch push alone does not publish a release. Do not manually create a second release or attach the local ZIP when using this workflow.

For a failed publication, fix the reported problem first. For a transient failure, rerun the failed workflow; alternatively use **Actions → Release → Run workflow** with the existing tag. Manual dispatch checks out that tag, so changes made after tagging are not included. The workflow can update an existing release and replace its ZIP. Chrome Web Store publication is separate.
