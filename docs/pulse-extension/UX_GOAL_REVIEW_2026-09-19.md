# Extension UX Goal Review

Review scope: current working tree and focused local checks. No claim of installed Chrome parity or hosted end-to-end account verification.

## Latest Checkpoint

Latest release/PR continuation supersedes the size failure below: CWS gate passes at 582,802 raw / 168,299 gzip, one byte under cap. Removed obsolete bucket-to-moment matching and standalone clip wrapper; three Terser passes; redundant Hub/bookmark copy trimmed. Development dist restored. Three headless wheel/clip-pin/neighbor-bucket checks pass in 7.2s. Installed Chrome selects 12:40 independently with matching bookmark timestamp. Backend exact timestamp work is isolated in approved PR https://github.com/Aron-Chu/streampulse-backend/pull/142 (001ba89), with three files and all metadata package tests passing. GitHub checks started. PR not merged/deployed; hosted pinning still requires release and cache refresh.

Wheel/selection follow-up supersedes size evidence below: clip rail now handles vertical wheel with passive:false, preserving Ctrl-wheel and releasing scrolling at boundaries. Adjacent chart bucket clicks no longer snap to ranked recap moments within 90 seconds. Clip links pin the exact matching VOD bucket via optional videoId/vodOffsetSeconds; missing metadata produces a notice rather than a guessed timestamp. Backend Helix/ClipCard mapping and tests added in the sibling backend, not deployed. Focused units 26 passed; backend helix/api passed; offline/VOD wheel+clip pin 2 passed in 6s; spike-neighbor keyboard+mouse selection 1 passed in 2s. Typecheck/build pass. Latest CWS size gate FAILS at 584,380 raw / 168,677 gzip (377 gzip over cap); development dist restored. Exact hosted clip pinning requires backend deployment and metadata cache refresh.

Carousel visual follow-up: user reload verified in dedicated Chrome tab 1182019988; Open My Moments now exists, resolving the stale-installed-panel finding. Current screenshot exposed a white native scrollbar and bulky clip cards. Shared carousel now uses 232px-bounded thumbnails, borderless compact cards, quieter navigation, hidden native scrollbar, and reduced-motion-aware hover lift. Settings untouched. Clip API tests: 7 passed; offline/VOD headless checks: 2 passed in 3.7s. Screenshot inspected with mocked placeholder thumbnails. CWS gate: 583,243 raw / 168,160 gzip, passing. Development build restored. New visual changes require reload; hosted account and final design acceptance remain unverified.

Installed Chrome evidence: secondary xQc tab 1182019950 initially stayed at Loading Pulse. Navigated that tab to its existing xQc URL and opened Twitch Chat layout; Pulse then loaded Replay ready, Full stream, and ten last-stream clip links. Clicking Next clips enabled Previous clips after scrolling, confirming actual installed carousel navigation against hosted data. Full-stream view has no zoom button row. Main fullscreen playback tab was untouched. The installed recap still lacks the newly added My Moments controls, so this does NOT prove current-build parity. Asked user to reload latest dist and refresh this secondary tab. No account writes were attempted.

Release revalidation: all 1,343 unit tests pass across 176 files. CWS size gate passes at 583,447 raw / 168,191 gzip bytes (109 gzip bytes spare). Store snapshot test-results/cws-bookmark-context-20260919 passes closed-shadow navigation in 2.5s. Development dist restored. Packaging generated a ZIP but validation FAILED on release-notes 0.2.1 still marked unreleased; other reported checks passed. Status was intentionally not changed and nothing was uploaded.

Current headless My Moments workflow passed in 19.0s: notes persist, consent gates history, clearing history preserves bookmarks, retry/deletion/account switching work in the mocked scenario, and layouts fit 1440/390/320px. All test processes exited. Hosted account and installed visual acceptance remain open.

Follow-up: renamed the live stream link to Stream analytics to distinguish it from the top Hub action. Fixed a live-to-VOD bookmark lookup regression: sender contextVodId is now separate from backend filtering, so a stream-scoped bookmark created before its VOD exists is still found on replay. Strict numeric context parsing and existing exact sender-page authorization remain. Focused bookmark/parser/authorization tests: 34 passed; rebuilt headless VOD save/reload/library test: 1 passed in 7.8s. Typecheck and development build passed. The CWS measurements below predate this follow-up and require revalidation before packaging.

Store dropdown event ordering is fixed and its closed-shadow navigation test passes (all eight presets, Analytics Hub, Supporter). Live/VOD zoom tests verify actual 24px tools and 44x24px Reset, correcting a CSS minimum override. Latest typecheck and 10 focused unit checks pass. Store navigation: 1 passed in 2.4s; live/VOD zoom: 2 passed in 3.7s.

Latest CWS size is 583,402 raw / 168,176 gzip bytes, passing unchanged caps with 124 gzip bytes spare. Verified snapshot: `test-results/cws-navigation-verified-20260919`. `dist/` is restored to development. Runtime dependency audit has zero findings; development has two moderate Vitest/mocker findings for GHSA-82fw-gwwq-j7x9. No forced major upgrade was performed.

User reported reloading. Chrome inspection still shows fullscreen video with Pulse hidden; playback was left untouched. Installed visual parity and the real hosted My Moments path remain unverified. No browser test loop is running.

## Screenshot Follow-Up: Live and VOD Zoom Parity

The user's screenshots exposed a missed VOD path: `RecapTimelineChart.tsx` explicitly hid zoom buttons when `sidebarFill` was true. Replaced its duplicate controls with the shared `ChartViewportControls` used by live Pulse. Both now keep the rail full width, hide the button row at Full, and reveal compact minus/Reset/plus below it once zoomed. Reset returns keyboard focus to the rail.

Latest verification: typecheck and build passed. Three headless packaged tests for live/VOD zoom-in, zoom-out, Reset-to-Full, rail width stability and offline stream clips passed in 5.2 seconds. The VOD fixture extends to one hour to exercise zoom above the five-minute minimum. Subpixel browser rounding is allowed within 0.005px in the width assertion.

## Remaining Findings

Latest size status supersedes older measurements below: the CWS release artifact now passes the unchanged size budget at 583,483 raw / 168,192 gzip bytes. The development artifact remains larger and is restored in `dist/`. See Release CSS Optimization below for verification scope.

1. Release size gate remains failing: 603,100 raw / 173,507 gzip bytes against 588,500 raw / 168,300 gzip caps. Do not raise the gate to hide growth. Full unit suite: 1,325 pass, one failure (this gate).
2. My Moments works in the packaged mocked workflow, but the user's hosted account/link/bookmark path still needs direct verification. A green mock does not close the original live report. The earlier pending timeout was caused by a 15-second test covering three five-second link waits.
3. Analytics navigation is still duplicated: `AnalyticsHubCta.tsx` is at the top, while `LiveStatsBand.tsx` retains Open full analytics. The former opens the hub and the latter is stream-specific, but their distinction is not clear enough on the narrow sidebar.
4. Clip carousel now covers live and completed stream windows, including offline recaps and VOD Pulse. Missing boundaries resolve from stream history using the requested stream ID or start time, otherwise the latest completed stream. A missing requested stream does not fall back to unrelated clips. Late end-time updates trigger a reload. Results exclude missing/out-of-window timestamps, deduplicate, sort by views and cap at ten. Pagination is not exhausted, so this is not a complete clip archive. Loading, empty and retry states remain visible.
5. Tenure badges remain local previews. Shared Twitch chat delivery is unreleased. Their visual design changed to faceted milestones; acceptance of the appearance remains the user's judgment.

## Goal Status

| Request | Current result |
| --- | --- |
| Free Moments vs subscription | Core bookmarks remain free with a linked account for hosted actions; no Supporter paywall added. |
| View My Moments | Destination and mocked workflow work; hosted verification still outstanding. |
| Full stream startup | Implemented, with prior bounded browser coverage; not changed in this pass. |
| Zoom controls outside Full | Controls remain available while zoomed, even if a caller asks to hide them. Moved immediately below the chart, before Saved Moments. Reset is explicitly labelled. Reset retains the selected range preset. |
| All zoom ranges | Prior mocked coverage exists; current focused control checks pass. No new exhaustive sweep performed. |
| VOD jump pins and setting | Implemented; focused preference tests pass. |
| Analytics Hub top and motion | Top CTA and reduced-motion-aware styles exist; duplicate secondary entry noted above. |
| Synced clutter | Healthy live header uses Live chart. Historical VOD sync labels represent a different data state and remain. |
| Animated black panel background | Implemented across the panel. Off/Still/Rain and intensity live in settings. Front-page Pause/Resume removed. |
| Sidebar top highlight | Removed; Supporter finish is a small title-side Pulse signature. |
| Tenure choices | New, 3, 6, 12, 24-month local previews exist at native 18px size. |
| Stream clips carousel | Horizontal scroll/snap, previous/next buttons, keyboard arrows, safe Twitch links and reduced-motion scroll behaviour. Live and completed-stream windows; offline recap covered by packaged test. |

## Earlier Focused Verification

- 23 focused unit tests passed: clips, ChartViewportControls, VOD pin preference, SavedMoments, AnalyticsHubCta.
- Typecheck and required extension build passed.
- One headless packaged test passed in 3.4 seconds: ranked carousel results, scrolling, background settings, removal of front-page rain controls, reduced motion and narrow layout.
- All invoked test processes exited. No headed browser loop was started.
- Reload extension and hard-refresh Twitch to use the latest `dist/` build.

## Pulse Layout Pass

Pulse-only section styling now uses unframed divider bands instead of nested rounded containers. Settings styling is unchanged. The clips section has compact 28px controls, count, consistent two-line title space, no duplicated card-section margins, contained horizontal scrolling, hover/pressed/focus states and reduced-motion support. Packaged live/VOD zoom and offline carousel checks passed again in 5.3 seconds, including 1280px/720px viewport overflow checks. Inspected the generated carousel screenshot; mock clips have no artwork, so actual thumbnail rendering still needs installed verification. Typecheck/build pass. Content size increased to about 607kB raw; the existing size gate remains open.

## Installed Chrome Check

User confirmed reloading extension and Twitch. The inspected xQc tab was playing fullscreen with Pulse hidden. Do not claim installed visual parity yet or disrupt playback. Asked the user to exit fullscreen and expose Pulse. A subsequent rebuilt artifact includes the theme-variable correction, late-end-time clip reload fix and Pulse layout pass; that artifact requires another reload when installed checking resumes.

Other remaining release work: broader Pulse design consolidation, bundle reduction, hosted My Moments verification, and installed live/VOD visual review. No release-ready claim. No test sessions left running after the checks above.

## Bundle Investigation

Measured rendered module costs without changing the installed artifact. Largest application modules are Overlay, PulseOverviewChart and LiveStatsBand; the curated extension chart entry is already in use. An in-memory Oxc minification comparison increased gzip size and was not adopted. Removed only statically unreferenced style entries from ChatActivityInspector, LiveStatsBand, Overlay, RecapTimelineChart and StreamRecapSection. Retained dynamically referenced status-pill styles. This saves 3,781 raw bytes from the preceding build without removing features. Build/typecheck pass; all 1,325 functional unit tests pass. Remaining budget excess: 14,600 raw / 5,207 gzip bytes. No limits changed and no stylesheet/chunk relocation used to conceal total payload growth.

## Clip Identity Follow-Up

Fixed a live startup bug: missing live start metadata previously fell back to the latest completed broadcast. It now waits for live boundaries rather than showing unrelated clips. VOD ID travels through GET_CLIP parsing and the worker; history fallback must match every supplied stream ID, VOD ID and start time. Missing/conflicting identity returns no clips. Added tests for older-VOD resolution, live metadata gaps, conflicting identities, parser preservation and retryable API errors. Typecheck/build pass; packaged live/VOD zoom and offline carousel checks pass in 5.4 seconds. Chrome xQc remains fullscreen; no installed verification claimed. This change adds a small amount to the bundle, so the preceding exact size measurement is historical, not a new gate pass.

## VOD Bookmark and Clip Authorization Fix

Found and fixed missing SavedMoments controls in both recap render paths. The bookmark action appears after explicit moment selection; My Moments remains available before selection. Packaged tests exposed a second real defect: the worker's channel-only sender rule rejected bookmark and clip requests from `/videos/<id>` pages. These three operations now accept a trusted top-frame Twitch sender only when its exact numeric VOD ID matches the request (or the existing channel rule matches). Account management and deletion remain extension-page-only. Added denial tests for wrong VOD IDs, absent identity, iframes and foreign extension IDs.

The VOD adapter now derives completed-stream `endedAt` from reported VOD start/duration only; missing/invalid metadata is not inferred from chart coverage. This avoids unnecessarily relying on recent stream history for older VOD clips. Four packaged headless tests passed in 6.9 seconds: offline/VOD carousel loading and scrolling, plus offline/VOD bookmark selection, signed-out free-account guidance and My Moments navigation. This proves the packaged request path, not hosted account persistence. Latest content build is about 603.5kB raw; release-size reduction remains required.

## Successful Bookmark Persistence Check

Added `vod-bookmark-save.mocked.spec.ts`: disposable account link, authenticated save from VOD Pulse, exact stream/VOD/offset request validation, Twitch reload, saved-state hydration, one-write duplicate guard, and appearance in the account library. This passed in 8.1 seconds. An initial fixture failure was corrected by including the backend-required empty `notes` string; parser validation was not weakened. Also fixed SavedMoments to hydrate again after account/backend revision changes, retaining generation guards against stale responses. Nine focused unit tests, build and typecheck pass. Hosted real-account persistence remains unverified; this is packaged mocked evidence only.

## Release CSS Optimization

Replaced regex-only inline CSS compaction with Lightning CSS parsing/minification (pinned build dependency). Extracted the mount's base CSS into `overlayStyles.ts` without changing its cascade order; theme, mount and backdrop CSS remain inline in the content artifact, not moved outside the measured bundle. Removed unused zoom-detail/front-page pause selectors and an obsolete backdrop rule that repainted the new unframed sections. No feature removal or budget change.

- CWS artifact: 583,483 raw / 168,192 gzip bytes; original 588,500 / 168,300 caps pass, with only 108 gzip bytes headroom.
- All 1,340 unit tests pass with the CWS artifact present; typecheck passes.
- Snapshot: `test-results/cws-size-verified-20260919/`. This is size/unit verified, not a release-ready package.
- Restored normal development `dist/` after snapshotting CWS. Development content is about 599kB and remains over the same gate; distinguish targets when interpreting results.
- Eight headless development UI tests pass in 21.3s: live/VOD zoom, offline/VOD clips, backdrop/reduced motion, recap library navigation, authenticated VOD bookmark save/reload.
- Store builds use closed shadow roots. The initial development-locator browser run against CWS was stopped after identifying this mismatch, not counted as passing. Use the existing packaged-shadow-navigation test for store verification.
- Installed the Playwright-pinned Chromium revision after dependency reconciliation; retained existing browser revisions. All invoked sessions exited.
- Installed Chrome visual parity, hosted account verification, broader release gates and final design acceptance remain open. Dependency installation reported two moderate audit findings; inspect before release without blindly applying force upgrades.
