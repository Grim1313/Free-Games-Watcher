# Firefox Desktop

This is the Firefox port of Free Games Watcher 2.2.1. The Chromium and Firefox packages share all provider, filtering, history, backup and interface code. Firefox uses an MV3 module event page instead of a service worker. It shares the product version with Chrome; storage schema and backup format remain compatible.

## Build and temporary installation

Requirements for development: Node.js 24, PowerShell 7, and Firefox Desktop 142 or later.

```powershell
npm ci
npm test
npm run pack:firefox
npm run lint:firefox
npm run test:firefox
```

Outputs:

- `dist/Free-Games-Watcher-Firefox/manifest.json`: load this generated manifest, not the Chromium manifest at the repository root.
- `dist/Free-Games-Watcher-Firefox-2.2.1.zip`: unsigned Firefox package, with manifest at archive root.
- `dist/Free-Games-Watcher-Chrome-2.2.1.zip`: existing Chromium target from `npm run pack`.

In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the generated manifest (or the Firefox ZIP). Alternatively, `npm run start:firefox` starts an isolated development profile. The extension ID is `free-games-watcher@grim1313`; keep it for future signed builds and updates.

Temporary add-ons are removed at browser shutdown. Export settings, marks and history before removing a test installation; use the same loaded directory and **Reload** while developing. An unsigned ZIP/XPI cannot be permanently installed in ordinary release Firefox. Mozilla signing and AMO submission have deliberately not been run. No signature/security preferences need to be changed for temporary installation.

## Functional scope and differences

- Steam, Epic (weekly feed, catalog and EGData fallback), GOG and upcoming Epic offers use the same providers.
- All filters, sorting, content exclusions, local marks, undo, reminder/quiet-hour scheduling, history, badge, EN/RU localization and themes share the production implementation.
- Backup v3 transfers settings, marks and optional history between browsers; v1/v2 imports remain accepted. Imported campaigns retain the existing notification-suppression rules. Browser storage is otherwise independent.
- Firefox supports basic native notifications. Rating text is appended to the message; the test retains its price, deadline and rating. Large notification artwork is unavailable. Popup/history artwork is unchanged.
- Notification submissions are serialized with a one-second minimum gap in Firefox. OS settings may suppress banners even when the browser accepts the request.
- Revoked host permissions appear in Settings → Diagnostics. **Restore site access** invokes Firefox's permission prompt directly from the user click.
- The popup adapts to Firefox's available panel width, including the narrower unpinned extension panel.
- This target is validated for desktop. Android has not been validated or offered as a supported target.

## Data transmission declaration

`browser_specific_settings.gecko.data_collection_permissions.required` declares `locationInfo` and `websiteContent`. The minimum Firefox version supports the built-in consent system. These declarations describe existing functional requests; the port adds no analytics, backend or account integration.

| Request | Data used outside the browser |
| --- | --- |
| Store discovery and metadata | Selected store country, language/public catalog parameters and game identifiers; normal HTTPS request metadata such as IP address and user agent |
| EGData fallback | Selected catalog country/language and public search/offer parameters; credentials omitted |
| Artwork | Public image URL requested from permitted store/CDN hosts; ordinary network metadata |
| Steam age-gate deadline fallback | The existing `credentials: include` request may send Steam's own cookies back to Steam; extension code does not read cookie values |
| Store links clicked by the user | Open the store in a normal tab; the store handles its own login and claim process |

`locationInfo` discloses the selected country, which need not be the user's actual location. No geolocation API is used. `websiteContent` discloses the existing cookie-bearing Steam fallback. There is no collection of unrelated browsing history. Local giveaway history, personal marks and backups are never uploaded by the extension. Backups are written only to a local download selected by the user.

This is the implementation's documented classification, not an assertion of AMO review approval. Validate the inventory and current Mozilla policy again before a future submission. No optional telemetry is declared or sent.

## Test commands and evidence

```powershell
npm run test:firefox          # real installed extension, deterministic stores
npm run test:firefox:live     # actual store requests, OS notifications disabled
npm run test:firefox:popup    # actual action popup, locales/themes/scaling
npm run test:firefox:package  # install the exact ZIP, without test injection
npm run test:backup:cross-browser # Chromium → Firefox → Chromium
node scripts/firefox-native.mjs  # headed, isolated preview: send / status / close
npm run test:browser
npm run test:backup
npm run test:notifications
```

`FIREFOX_BINARY` selects a Firefox executable; `FIREFOX_REPORT_DIR` selects an output directory. Selenium uses a separate profile and a fixed UUID only inside that profile. The shared test bootstrap and notification probes exist only in staged test copies, never in the packaged add-on. Firefox's internal background termination API is used only by tests to verify recovery; an in-place WebDriver installation checks updates. Normal extension code does not depend on Firefox internals. Popup layout checks open the actual action panel through a user click, as required by Firefox 142.

The fixture suite exercises real runtime messaging, storage, settings controls, all stores, filters, actions/undo, ratings, history, actual backup download/upload/confirmation, notification failure/retry/deduplication, quiet hours, reminders, snooze, alarms, event-page unload, in-place updates and permission revocation/restoration. Native OS visibility is a separate manual check; fixture delivery assertions do not claim that Windows displayed a banner.

Reports and screenshots are written to `dist/firefox-check/`, `dist/firefox-live/` and the selected per-version report directories. `results.json` contains the actual browser version and completed scenarios. A failed run writes `failure.json` and `failure.png` and exits nonzero.

### Local verification on 2026-11-08 (Windows)

| Check | Result |
| --- | --- |
| Node module suite | 168 passed |
| Firefox 142.0.1 | 41 functional scenarios, 24 actual popup layouts passed |
| Firefox ESR 153.6.0 | 41 functional scenarios, 24 actual popup layouts passed |
| Firefox 159.0.1 | 41 functional scenarios, 24 actual popup layouts passed |
| Popup layout matrix | EN/RU × light/dark × 100/125% scale × empty/two/many offers; no horizontal overflow or clipped action buttons |
| Chromium regression | 162 general checks, 11 backup checks, 12 notification checks, 16 card layouts passed |
| Chromium → Firefox → Chromium | 5 backup compatibility scenarios passed, including v1/v2 imports and v3 history/marks |
| Live stores in Firefox | US: 15 visible offers; RU: 2 visible offers; Steam, Epic and GOG requests succeeded |
| Unmodified Firefox ZIP | Installed in Firefox 159.0.1; background messaging, storage and all three pages verified |
| Mozilla web-ext lint | 0 errors, 0 notices, 0 warnings |

Live results are a dated snapshot, not a guarantee of complete store coverage: Steam reported its existing search-page budget limit. No active GOG giveaway was available in that snapshot; positive GOG behavior was verified with deterministic fixtures. Screenshots cover popup content, settings and history in both languages and themes. Actual popup panel bounds are independently checked through its live extension view.

The native Firefox notification API accepted a real preview. The Windows banner itself remains **visually unverified**: Computer Use stopped because URL-policy enforcement is unsupported for this Windows browser. No alternate OS automation was used to bypass that restriction. Notification formatting, queuing, denial, failure/retry, deduplication and click/close ordering were verified separately; OS banner visibility still needs a manual check.

The verification above was performed before GitHub publication. Mozilla signing and AMO submission are separate and were not performed.

## Reference documentation

- [Firefox background scripts and modules](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [NotificationOptions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/notifications/NotificationOptions)
- [Host permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)
- [Built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
