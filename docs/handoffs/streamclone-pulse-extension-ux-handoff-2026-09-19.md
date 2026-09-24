# StreamPulse Extension UX Handoff

Date: 2026-09-19
Owner repo: `C:\Users\Aron\streamclone-pulse`
Audience: lower-thinking Astra continuing the extension UX work

## Executive Summary

The extension work is in a heavily modified working tree. Do not reset, clean, stash, or broadly reformat it. The current request is to finish and polish the Chrome MV3 extension experience around:

- Free Moments and reliable My Moments navigation.
- Full-stream chart defaults on each new activation.
- Zoom controls that remain useful at every supported range.
- VOD jump points that can optionally pin/highlight on the chart.
- A restored, themed Analytics Hub CTA near the top of the extension surface.
- Reduced and more honest status chrome; avoid redundant "Synced" messaging when Live already communicates health.
- Better motion, button sizing, focus states, and reduced-motion behavior.
- A truthful, better-looking supporter badge preview with more tenure steps.

This file is a handoff and decision record. It is not proof that the installed Chrome extension matches the checkout or that hosted Twitch flows are green.

## Verified Current State

### Repository and build

- Owning repository is `streamclone-pulse`; extension source is under `src/`, with shared Pulse packages under `packages/`.
- Extension traffic must go through the service worker. Content scripts must use `chrome.runtime.sendMessage`; do not add direct backend `fetch` calls to content scripts.
- Default hosted backend is `https://api.streampulse.stream`. `localhost:8090` is Streamclone watch-only, not the Pulse BFF. A local BFF, when explicitly used, is `http://localhost:8081`.
- The working tree contains extensive existing modifications and untracked files across extension, packages, portal, tests, screenshots, and audit logs. Treat them as user-owned.
- `npm run typecheck` passed.
- Focused Vitest command passed: 4 files, 22 tests:
  - `tests/popupNavigation.test.ts`
  - `tests/settingsHost.test.ts`
  - `tests/parseBackgroundRequest.test.ts`
  - `tests/savedMoments.test.tsx`
- Earlier focused extension test batch passed: 8 files, 106 tests, including Analytics Hub, Moments, chart viewport, supporter recognition, chart-window hydration, and popup navigation coverage.
- Latest focused regression batch passed: 5 files, 18 tests, including `tests/libraryPeek.test.tsx`, Analytics Hub, chart controls, VOD pin preference, and Saved Moments.
- `npm run build` passed and wrote a dirty local build provenance record. Chrome still needs an extension reload and a hard refresh of the Twitch tab after source changes.
- `git diff --check` passed for the service-worker change and this handoff file.

### Current service-worker diff

`src/background/service-worker.ts` currently contains broader dirty-tree work for My Moments, settings-host navigation, supporter account messages, health caching, sender authorization, paginated bookmarks, and a final `return true` from the asynchronous `chrome.runtime.onMessage` listener. The listener change is technically appropriate for async responses, but it is not by itself proof that `View My Moments` is fixed in installed Chrome.

This work is in the dirty working tree. It has not been committed, and no commit was requested. Re-read the exact diff before changing it.

### Current implementation signals

- `src/ui/SavedMoments.tsx` exists and has real save/list/edit/export-oriented behavior.
- `src/background/myMoments.ts`, `src/background/myMomentsStore.ts`, `src/shared/myMoments.ts`, and related account/bookmark files are present.
- `src/options/MyMomentsPage.tsx` and settings-host files are present.
- `src/ui/ChartViewportControls.tsx`, `src/ui/ChartPositionRail.tsx`, viewport math, and chart interaction tests are present.
- `src/ui/PastVodsSection.tsx` and VOD navigation helpers are present.
- `src/ui/AnalyticsHubCta.tsx` exists and has current dirty styling changes.
- `src/ui/library/LibraryPeek.tsx` now uses a dedicated themed `View library` CTA with a small hover arrow motion, rather than an inline hard-coded action-chip style.
- Supporter/badge files exist, including `src/ui/SupporterBadge.tsx`, `src/ui/supporterFinish.ts`, and options-side supporter cosmetic controls.
- There are dedicated tests for chart controls, VOD jump/chart pin preference, My Moments, settings navigation, supporter access, supporter recognition, and motion/accessibility contracts.

## Product Decisions To Preserve Unless New Evidence Contradicts Them

### Moments

- Moments should remain a free core utility, not a Supporter-only gate.
- A connected Pulse account is needed for hosted/account-linked bookmarks; subscription status should not hide the basic action.
- Prefer one clear `My Moments` destination plus contextual `Bookmark` actions. Avoid duplicate front-page buttons that all appear to do the same thing.
- Signed-out and unavailable states should explain the next action instead of emitting a generic failure.
- Keep save behavior idempotent where possible to avoid duplicate bookmarks.
- Overlay saves need correct VOD identity and offset data, not only a live stream id.

### Chart range and zoom

- New chart activations should start at `Full stream`.
- Existing stored range values may explain a one-hour startup. Inspect migration/hydration code before changing persistence semantics.
- Favor session-local chart range changes unless the user explicitly asks for a persistent preference.
- Zoom must work across every supported duration/preset, including very short and multi-hour streams.
- The zoom chrome should be compact at rest and progressively disclose reset/scale context as the viewport changes.
- Keep keyboard access, visible focus, pointer targets, and reduced-motion support.

### VOD jump markers

- When a user jumps to a VOD moment, the chart may show a selected marker or pin at that offset.
- Add a clear setting/toggle to disable those jump markers.
- The marker should be transient or scoped to the active VOD session unless persistence is clearly useful.
- Do not claim synchronized playback when the source VOD identity or offset is not trustworthy.

### Analytics Hub CTA and status

- Restore one prominent Analytics Hub entry near the top of the extension surface.
- Reuse the earlier themed button treatment if it is still available in the current source/history; it should look native to the extension, not like a portal link pasted into the overlay.
- Use restrained motion: hover/press lift, a short entrance transition, and reduced-motion fallback. Avoid continuous attention-seeking animation.
- `Live` is the primary active-state affordance. A separate always-green `Synced` label is likely redundant unless it conveys a distinct backend condition.

### Badge preview

- The current preview appears local/cosmetic rather than a released Twitch chat badge. Keep that limitation explicit in copy.
- Do not imply that equipping changes Twitch chat unless the backend/chat delivery exists.
- Replace the two-state tenure concept with a coherent family such as 1, 3, 6, 12, and 24 months.
- Keep a stable Peak silhouette and vary the tenure treatment without unreadable tiny detail.
- Inspect the 24-month artwork for miter/overlap problems at small sizes.
- Consider naming the current accent-line behavior `Supporter accent` if it remains only an overlay finish.

## What Remains Unverified

- The installed Chrome extension may not match the current checkout or latest `dist/`.
- Account linkage and Supporter entitlement for the current browser user are unknown.
- Hosted save, reopen, edit, export, and watched-history capture are not proven end to end.
- VOD playback resolution and archive availability are not proven for live Twitch data.
- Zoom and pan have focused mocked coverage, but not every real installed-extension interaction combination.
- Visual approval is incomplete: prior screenshot inspection was unavailable or timed out.
- Browser URL policy previously rejected extension-settings inspection. Do not bypass that through raw browser commands or alternate surfaces.
- There may be long-running Node/Chrome processes from previous work. Do not start another broad Playwright run without a timeout and explicit scope.

## Safe Continuation Plan

1. Read only the focused files before editing:
   - `src/ui/AnalyticsHubCta.tsx`
   - `src/ui/ChartViewportControls.tsx`
   - `src/ui/PulseOverviewChart.tsx`
   - `src/ui/SavedMoments.tsx`
   - `src/ui/PastVodsSection.tsx`
   - `src/ui/Overlay.tsx`
   - `src/ui/theme.ts`
   - `src/background/service-worker.ts`
   - relevant tests under `tests/`
2. Inspect the exact current diff for those files. Do not overwrite unrelated dirty work.
3. Make small, focused edits:
   - finish the top Analytics Hub CTA and motion;
   - keep the My Moments library CTA on the same visual language as the Hub CTA;
   - confirm Full-stream initialization/migration;
   - make zoom controls dynamically disclose reset/context;
   - wire VOD jump marker preference;
   - repair My Moments navigation and truthful empty/error states;
   - improve badge preview states and labels.
4. Run bounded checks only:
   - focused Vitest files first;
   - `npm run typecheck`;
   - `npm run build`.
5. Do not run an open-ended Playwright command. If browser proof is necessary, use one named spec with a hard timeout and terminate it on failure.
6. Tell the user exactly when a fresh build is ready:
   - `chrome://extensions` -> Reload Streamclone Pulse.
   - Hard-refresh the Twitch tab.
7. Report remaining hosted/installed-extension gaps honestly.

## Suggested Focused Validation

```powershell
npm test -- --run `
  tests/savedMoments.test.tsx `
  tests/settingsHost.test.ts `
  tests/popupNavigation.test.ts `
  tests/ChartViewportControls.test.tsx `
  tests/chartViewport.test.ts `
  tests/vodJumpChartPinPreference.test.ts

npm run typecheck
npm run build
```

If a test file is absent in the current checkout, remove only that file from the command and note it. Do not regenerate the entire test matrix.

## Important Process Note

The prior work spent many hours in browser/Playwright activity. That was not a productive proof boundary for this task. The next agent should favor source inspection, focused Vitest, typecheck, and a single bounded browser check only when it answers a specific question. Never leave a watcher or browser loop running indefinitely.
