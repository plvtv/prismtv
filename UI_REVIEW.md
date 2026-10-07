# PrismTV UI review — 6 October 2026

## Product and implementation

PrismTV serves people browsing free live television, classic films, and English lessons on desktop, phone, tablet, and TV browsers. Discovery, quick playback, captions, and locally saved favourites are its central flows.

The app uses semantic HTML, plain ES modules, one CSS stylesheet, and a pinned hls.js CDN script. There is no framework or build pipeline. Its five views are Home, Browse, Movies, Learn English, and My List; buttons switch sections rather than using a routing framework.

| Area | Existing implementation |
| --- | --- |
| Application and navigation | `js/app.js`: boot, indexes, preferences, filters, search, navigation, Random, sharing |
| Reusable UI | `js/ui.js`: channel cards, rows, hero, grid, toasts |
| Live player | `js/player.js`: source failover, diagnostics, captions, fullscreen, related channels |
| Movies | `js/movies.js`: lazy film rows, browsing, search, playback, progress persistence |
| Learning | `js/learn.js`: courses, lessons, levels, custom-link form, YouTube playback |
| Data | `js/data.js`, `sources.js`, `config.js`, `paid.js`: index merging, source adapters, policies, IndexedDB cache |
| Persistence | `js/store.js`: localStorage favourites and watch history |
| Integrations | `bridge.js`, `health.js`, `autocc.js`, `serve.py`: local relay, mpv, health checks, automatic captions |
| Device interaction | `js/mobile.js`: overlay history and swipe fullscreen |
| Deployment and data snapshots | `tools/`, `.github/workflows/`, `data/`: public-site generation and film/YouTube snapshots |

The design system already has a coherent near-black palette, violet accent, Inter typography with Noto fallbacks for Indian scripts, shared spacing/radius tokens, SVG symbol icons, consistent cards, focus styling, and reduced-motion CSS. Artwork comes from external channel/film sources. Existing loading skeletons, playback diagnostics, toasts, lazy images, lazy movie rows, and a 12-hour data cache are worth keeping. Backup directories and the local stream-health file are operational artifacts, not runtime UI components.

## Prioritized findings and solutions

Recommendations were summarized before editing. The implementation retains the brand, content sources, business rules, storage formats, view structure, integrations, and playback architecture.

| Priority | Problem → why it matters → solution | Result |
| --- | --- | --- |
| Critical | At 768px the header extended to approximately 969px, clipping Preferences despite the document reporting no overflow → essential controls were unreachable → use the existing bottom navigation through tablet widths and compact desktop header controls. | Implemented |
| Critical | At 320px search displayed only a few characters → discovery was difficult → place search on a full-width second header row below 480px. | Implemented |
| Critical | Dialogs had modal ARIA but no shared focus containment or return path → keyboard users could reach background controls or lose their place → shared dialog helper makes the background inert, locks scrolling, wraps focus, and restores the opener or refreshed card. | Implemented |
| Critical | `/` intercepted text entry; the live-player Space shortcut intercepted button activation → form and keyboard actions failed → scope shortcuts to suitable targets. | Implemented |
| Critical | Mobile player actions occupied a single crowded row → source selection and buttons could overflow → source selector gets a full row and remaining controls wrap; captions menu stays within the viewport. | Implemented |
| Critical | Boot failure only instructed a reload and inserted error text as HTML → recovery was inconvenient and error rendering unnecessarily trusted text → safe text rendering and a retry button. | Implemented |
| High impact | Tertiary text was too dim → supporting information was difficult to read → brighten the shared text token without changing the accent palette. | Implemented |
| High impact | “See all” appeared primarily on hover → browsing options were easy to miss → make row actions consistently visible. | Implemented |
| High impact | Hero rotation had only temporary hover/focus pausing → users could not explicitly stop it → accessible pause/resume control and selected-slide state. | Implemented |
| High impact | My List used a filter-related empty message; a small index could have no qualifying hero → next steps were unclear or home appeared unfinished → view-specific guidance, fallback featured channels, and an empty-home message. | Implemented |
| High impact | The phone grid often fell to one oversized column; film search shared a cramped action row → scanning and searching were inefficient → two channel columns and a dedicated full-width film-search row. | Implemented |
| Polish | Hero typography and height dominated the screen → channel rows were pushed down → reduce hero height/title scale, stop the floating logo animation, and allow long titles to wrap. | Implemented |
| Polish | Some controls were small and Preferences could exceed a short screen → touch selection and settings were awkward → 44px targets on coarse pointers and a scrollable bounded Preferences panel. | Implemented |
| Polish | Navigation state and result changes lacked complete accessible feedback → screen-reader context was weaker → current-view attributes, pressed states, polite result/player status regions, and a skip link. | Implemented |
| Polish | JavaScript carousel scrolling explicitly requested smooth motion; skeleton animation reused the live-indicator keyframe name → reduced-motion preferences and animation consistency were undermined → shared motion-aware scroll behaviour and a separate skeleton keyframe. | Implemented |
| Optional | Large first-load indexes and external artwork remain potential performance costs → slow connections may wait → separately profile fetching, image payloads, and rendering before changing data adapters or dependencies. | Deferred |
| Optional | Movie and learning modules duplicate some row-building logic → future maintenance could benefit from shared utilities → defer a larger refactor until functional changes justify it. | Deferred |

## Verification and limits

Browser checks used Chromium with a controlled cached dataset, deterministic API responses, and intentionally unavailable media sources. This isolates interface behaviour from network availability and geography. It does not certify external content or streaming availability.

- Home, Browse, My List, Movies, and Learn English checked at 320, 375, 768, 1024, and 1440px, including header bounds while search is focused.
- Desktop and phone screenshots reviewed. Phone section spacing, two-column grids, full-width film search, tablet navigation, long titles, and short-screen Preferences were checked.
- Search/no-results feedback, category filtering/reset, 60-channel paging, saved-channel display, hero pause/pressed state, and form feedback passed.
- Live, movie, and lesson dialogs checked for keyboard containment and dismissal; the live player checked for opener focus restoration. Refreshed movie/lesson cards have a replacement-card focus fallback.
- Touch live-player layouts and visible button bounds checked at all five widths; visible player buttons meet the 44px target after animation settles.
- Space activation of player buttons, Back dismissal/background release, reduced-motion CSS and scroll behaviour, and an empty hero passed.
- An initial index-loading failure followed by retry from a populated cache successfully revealed the main app.
- No uncaught JavaScript runtime errors in the normal controlled checks. The deliberate boot-failure case logs its expected diagnostic; deliberately blocked external resources generate expected network errors.
- JavaScript syntax checks and `git diff --check` passed. No runtime dependencies or build steps were added.

Real HLS/MP4 playback, third-party embeds, captions recognition/translation, geoblocking, mpv, LAN sharing, and measured LCP/CLS/INP still require integration checks on the target device and network. Safari/iOS, TV-browser behaviour, actual screen-reader announcements, and a full WCAG 2.2 AA conformance audit were not tested. External source links and their availability were preserved rather than independently validated.

## Follow-up: card favourites and row recovery

Channel cards now have a separate save button with an accessible channel-specific label and pressed state. Saving never activates playback. Changes stay synchronized with other copies of the card and the hero action. Removing a card in My List updates the list and count immediately and preserves keyboard focus. Saved custom learning streams can also be resolved after a reload.

Failed film rows, New lessons, custom YouTube-channel rows, and custom channel-playlist rows now retain their heading and show a “Try again” action. Retry fetches only the affected row, exposes a loading state, and returns focus when appropriate without stealing it from another action. Failed shared film-data promises are cleared so retries perform fresh requests. Successful empty responses show an empty message rather than masquerading as connection failures.

Focused Chromium checks passed for direct saves without playback, persistence after reload, keyboard removal, card-control geometry at all five widths, repeated film failures followed by successful retry, isolated row replacement, recovery from a rejected cached YouTube-film request, and lesson-feed recovery. JavaScript syntax and diff checks also passed. These checks use controlled responses; the integration limitations above still apply.

### Casting follow-up

Added Cast buttons to live, movie and lesson players. Controls stay within the existing dialog focus boundary; Escape dismisses the casting panel first. Added Google Cast media loading, conditional native AirPlay/Remote Playback pickers, and ephemeral LAN browser receiver pairing with a QR/link. Direct streams support remote play/pause/stop, receiver autoplay fallback, HLS relay retry, reconnect messages and disconnect. Embedded providers retain their own receiving-page controls.

Validation: six Python tests cover media validation, owner/receiver permissions, load/pause/stop revisions, offline/expired sessions, status/disconnect and device limits. Two-page Chromium integration verifies pairing, device selection, original stream URL transfer, stop/disconnect, Escape and panel bounds at 320/375/768/1024/1440px. Physical Chromecast/AirPlay receivers and provider playback restrictions require hardware verification.

Additional browser checks passed with mocked platform/media APIs: Chromecast live and buffered media requests, native picker invocation, embedded-source guidance, receiver tap-to-play fallback and phone layout. The live HTTP endpoint also rejected a cross-origin create request with 403. These validate the integration, not actual receiver hardware playback.

### Chromecast controls follow-up

Added current TV/status feedback with receiver media/volume/session listeners, movie seeking and time display, volume/mute, specific errors and retry/source selection, resume to the matching local video, and SDK session recovery after refresh. Fullscreen stage controls keep Cast visible and preserve keyboard focus after closing its panel. Live broadcasts hide movie seeking; unrelated local videos cannot receive a restored movie's position.

Six JavaScript protocol/state tests and six Python LAN pairing tests pass. The Playwright fixture verifies no-device and source failures, pause status, volume/mute, seeking near the movie end, refresh recovery, mismatched-video resume prevention, resume position, live seeking suppression, panel bounds at 320/768/1440px, fullscreen panel placement and focus return. Device APIs are mocked; actual Chromecast hardware and native iOS fullscreen remain unverified.
