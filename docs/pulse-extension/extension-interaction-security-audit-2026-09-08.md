# Extension interaction and security audit — September 8, 2026

## Implementation follow-up

Implemented after the initial audit: preference migration now preserves valid existing ranges; delayed viewer history is explicit in the status badge; the duplicate header promotion and its animation were removed; sidebar zoom buttons are visible; a strongest-loaded-moment shortcut appears beneath the metrics; and Saved moments offers an on-demand, channel-scoped list with exact stream/offset analytics links. Saving has failure/retry states, pagination, deduplication, and stale-channel response guards. This is a private backend bookmark flow, not local-only storage or verified replay playback.

Playback now falls back from failed archive discovery and reports unexpected errors. Delayed discovery cannot initiate a jump after the surface changes, and seek completion cannot write a stale notice. Removed 76 unused overlay style definitions to keep the content bundle below its existing size budget.

The chart failures were reconciled against current behavior: overview/detail chat paths are intentional; zoom preserves the selected timestamp; hiding markers preserves selection until explicit clearing. Settings and picker screenshots were visually reviewed and refreshed for the changed layout. A regression verifies that the featured shortcut is above the chart, selects the inspector, and exposes Save moment.

Still unverified: an authenticated hosted bookmark round trip, actual Twitch playback after the latest fixes, and the rebuilt extension in the user's Chrome. An unauthenticated request to the hosted bookmark endpoint returned 401. Browser policy rejected `chrome://extensions`; no reload workaround was attempted. The installed Chrome checks require the user to reload the extension manually. Local isolated test-browser coverage continues independently. The historical results below describe the original audit, not the final implementation gate.

Final local verification: all 48 checks in the five audited mocked-browser specs passed, all 1,172 unit tests passed, typecheck/build passed, and the unchanged content budget passed at 576,177 raw / 167,091 gzip bytes. A subsequent read of the installed extension on Twitch still showed the removed Analytics Hub promotion and lacked the new featured/saved controls, proving it had not picked up this build. Work is blocked only on the manual installed-extension reload and subsequent real-service/playback verification; no release sign-off is claimed.

Scope: installed Chrome extension 0.2.1 on a live Twitch channel, plus the current dirty working tree tested in isolated mocked Chromium. These are different builds. Existing uncommitted work was preserved; no store package, commit, deployment, or installed-extension reload was performed.

## Assessment

The core interaction coverage is encouraging, but this is not release sign-off. Seven browser checks remain unresolved after correcting one obsolete selector. A successful real playback jump was not verified. Local regression results do not establish hosted data correctness or store-candidate readiness.

## Verified and repaired

- Recap tail detection read nonexistent `ExtensionRollup.viewers` instead of `viewerCount`. This failed typecheck and could discard a viewer-only active tail. Corrected the field and added a regression preserving positive viewer measurements while excluding trailing zero/missing samples.
- Backend requests now enforce `redirect: 'error'` and `credentials: 'omit'`, including against caller overrides. This prevents enrollment headers from following redirects and excludes ambient browser cookies. This is defensive hardening; no credential disclosure was observed. A redirecting API deployment will now fail rather than silently follow.
- Already-aborted upstream requests now use the cancellation path rather than being misclassified as timeout. Added regression coverage.
- Updated the hover test to assert the current preview readout. Hover followed by Enter now passes.

## Interaction evidence

In installed Chrome, chart hover left the measured plot geometry unchanged and displayed a bucket preview. Chart expansion, settings open/back, Test connection, moment selection, and emote-list expansion were exercised. Test connection reported Connected. Jump in player was activated, but a successful seek was not established; it must not be counted as a passed playback test. No appearance preferences were changed.

Mocked browser coverage passed for chart locking/clearing, keyboard bounds and focus, wheel zoom without page scroll, panning, range changes, emote search/provider filtering/selection budget, lifecycle cleanup, settings handoff, and bounded requests. These checks use controlled fixtures rather than authoritative live playback or billing.

## Outstanding browser checks

The initial five-spec run produced 39 passes and eight failures. After the hover test correction, that individual test passed. The other seven were not silently accepted or baselined:

- Two tests expect zoom buttons that the sidebar currently intentionally hides. Reconcile intended sidebar zoom affordances and their tests.
- One recap test expects a single chat path but observes two. Verify whether these represent valid coverage segments before changing rendering or assertions.
- One spike-marker test expects hiding markers to clear the pinned selection. Current controls preserve selection. Decide and document the intended behavior before changing either side.
- Three screenshot comparisons differ, including internal settings height and narrow picker/settings layouts. Review responsive appearance and approve actual visual changes before updating baselines.

## Product improvements recommended

1. Reduce duplicated analytics calls to action and header/control height. On the narrow layout, the chart and controls consume most of the initial viewport and ranked moments appear below it. Put one strongest moment close to the live metrics, with the rest expandable.
2. Distinguish connection health from series freshness. A general Synced label can coexist with Viewer timeline delayed; users need a clear explanation of which data is current.
3. Make the moment action outcome explicit: confirmed VOD jump, opening analytics, unavailable replay, or failure with recovery. Avoid a player-jump label whose effect the user cannot see.
4. Finish a free Save moment → Saved moments → exact timestamp flow before adding more settings or paid controls. The selected-moment component inspected here has no Save action.
5. Preserve existing chart-range preferences during default migrations. New defaults should not overwrite a deliberate prior choice.
6. Profile loading cost before optimizing bundles. The build reports chunks over 500 kB; examine deferred settings/recap code and shared dependencies. Request-budget tests passed, so there is no measured polling storm to justify speculative polling rewrites.

## Security review

Reviewed message sender and channel checks, privileged settings routing, backend URL restrictions, navigation/image URL validation, trusted-context credential storage, request timeouts/cancellation and response-size limits. These provide useful existing boundaries. Production dependency audit reported zero known vulnerabilities. This was a targeted client review, not a penetration test or a backend authorization assessment.

## Validation

- `npm test -- --run`: 154 files, 1,164 tests passed.
- `npm run typecheck`: passed after the recap correction.
- `npm run build`: passed after the source fixes; local dist rebuilt, large-chunk warning remains.
- Five mocked browser specs: 39 passed / 8 failed initially; corrected hover case separately passed, leaving seven unresolved checks.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Narrow changed-path `git diff --check`: passed.

Local logs: `audit-extension-full-unit.log`, `audit-extension-e2e.log`, `audit-extension-hover-recheck.log`, `audit-extension-build.log`, and `audit-extension-dependencies.json`. These are working-session evidence, not a clean release artifact. Browser screenshot differences require review before replacing baselines.

To exercise rebuilt source in the installed extension, reload it in Chrome Extensions and hard-refresh Twitch. Release still requires a clean, identified candidate, required CI, resolved browser failures, and real playback/failure-recovery verification.
