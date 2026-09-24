# StreamPulse Extension UX Handoff

**Audience:** lower-thinking Astra / focused implementation agent  
**Date:** 2026-09-19  
**Owning repo:** `C:\Users\Aron\streamclone-pulse`  
**Scope:** Chrome MV3 extension UI and its immediate supporting code only

## Current Checkpoint (Supersedes Historical Status Below)

- After user reloaded the extension again: refreshed Twitch and confirmed current single-line Hub CTA and shortened bookmark copy. Open My Moments successfully created the extension settings tab at options/index.html#moments; no prior navigation error. Browser policy blocks inspection of extension-owned pages, so hosted library contents/save persistence remain unverified. Installed recap checks: Next clips enables Previous clips; with spike markers enabled, ArrowRight + Enter moved selection from 07:18 to 07:23 (next rendered bucket at full range), and bookmark timestamp became 07:23:00. Keyboard zoom revealed minus/Reset/plus at 1.5x; Reset restored Full stream. Screenshot inspected. These checks cover installed offline recap, not live/VOD parity or a native wheel gesture. No new build, account writes, tests, or publication in this continuation.

- Post-merge continuation: PR #142 is MERGED as 4adb6340de04056c39e513f7ab8a92b8e910c7e6, with all PR checks passing. The hourly monitor was deleted. Hosted health still reports v0.2.41; sampled xQc clip responses still lack videoId/vodOffsetSeconds. Exact hosted clip locking is therefore NOT verified. Release-v2 is armed and signer metadata is active, but this session has neither the configured signer public-key reference nor the matching identity in native Windows ssh-agent. No release tag, image publication, or production mutation performed.
- Installed Chrome check after refreshing xQc: recap, ten clips, full-stream rail and 24 past streams render. Open My Moments still reports "Could not open settings. Try again." However Chrome displays the obsolete two-line Analytics Hub CTA, while current source and dist have the single-line CTA. This is evidence of installed-build mismatch, not proof of a current-source navigation regression. Requested confirmation that Chrome loads C:\Users\Aron\streamclone-pulse\dist and reloads that extension; refresh Twitch after confirmation, then retry My Moments and wheel/bucket interactions. Browser control cannot claim chrome://extensions, so the loaded folder has not been independently verified. No account writes or new test loops performed.

- Latest continuation: installed Chrome keyboard selection verified adjacent 12:40 bucket and matching bookmark timestamp. Simplified recap bucket conversion and removed rematching of raw selections to ranked moments. Removed obsolete standalone clip wrapper, shortened redundant Hub/bookmark copy, and increased Terser compression passes to three. Latest CWS gate PASSES at 582,802 raw / 168,299 gzip (ONE byte spare; no useful headroom). Snapshot test-results/cws-wheel-buckets-20260919; development dist restored. Three headless wheel/clip-pin/neighbor-bucket checks pass in 7.2s. Full unit run had 1,343 passes and one old subtitle assertion; updated that assertion and all three CTA tests pass.
- User explicitly approved a scoped backend commit/PR. Created isolated worktree C:\Users\Aron\streampulse-backend-clip-offsets from origin/master; committed only metadata model, Helix mapping, and regression test as 001ba89, Aron-Chu only. PR https://github.com/Aron-Chu/streampulse-backend/pull/142 is OPEN, mergeable, checks queued/running at creation. All metadata package tests pass in isolated checkout. Original dirty backend work left untouched. NOT merged/deployed. Exact hosted clip pinning still awaits normal image-only release and cache refresh; no production bypass or release-status change authorized/performed.

- Latest requests: vertical wheel over clip rail now advances horizontally using a non-passive listener; Ctrl-wheel/native horizontal gestures remain untouched and vertical scrolling is released at rail boundaries. Fixed adjacent recap bucket selection by disabling the 90-second snap in RecapTimelineChart and using exact offset matching in recap selection keys. Regression covers spike markers enabled, keyboard selection, pointer selection, and bookmark timestamp.
- Clip links now pin matching exact VOD buckets in live and recap paths while retaining clip navigation. New optional videoId/vodOffsetSeconds metadata is threaded from Twitch Helix through backend ClipCard (sibling backend source edited; NOT deployed). Missing/mismatched offsets report unavailable, never infer from clip creation time. Backend helix/api tests passed, extension typecheck/build and 26 focused unit tests passed, offline/VOD wheel+clip-pin checks passed in 6s, adjacent-bucket test passed in 2s. All processes exited.
- RELEASE REGRESSION: latest CWS is 584,380 raw / 168,677 gzip, 377 gzip bytes over unchanged cap. Earlier passing size reports are superseded. Development dist restored. Remaining: trim size, deploy backend metadata through normal ops process, verify real clips after cache refresh. No upload/deploy performed.

- User confirmed reload and authorized dedicated test tabs. Chrome review tab 1182019988 now shows Moment bookmarks / Open My Moments: the earlier stale-panel blocker is resolved. Hosted account save still not tested. User rejected carousel appearance. Inspected installed screenshot: white native scrollbar, heavy card border, oversized footer. Changed shared live/offline/VOD carousel to bounded 232px previews, borderless cards, compact typography/body, dark image fallbacks, hidden native scrollbar, quiet ghost controls, subtle hover lift with reduced-motion override. Settings unchanged. Focused clip API tests: 7 passed. Offline/VOD browser checks: 2 passed in 3.7s, with size/no-border/scrollbar/reduced-motion assertions. Inspected mocked screenshot (placeholder thumbnails). CWS gate passes 583,243 raw / 168,160 gzip. Development dist rebuilt after gate. User needs reload for this latest visual change; broad release acceptance remains open.

- New installed evidence: secondary Chrome xQc tab 1182019950 now shows Replay ready, Full stream (zoom buttons hidden), and ten last-stream clips. Next clips scrolls and enables Previous clips. Initial Loading Pulse cleared after refreshing this secondary tab and opening Twitch Chat layout. Main fullscreen playback remains untouched. Installed recap lacks the new My Moments controls, so latest-build parity remains unproven. Requested reload from C:\Users\Aron\streamclone-pulse\dist and refresh of this secondary tab; no hosted account writes performed.

- Release revalidation after the contextVodId fix: all 1,343 unit tests pass (176 files); CWS bundle budget passes at 583,447 raw / 168,191 gzip bytes, only 109 gzip bytes spare. Current store snapshot is test-results/cws-bookmark-context-20260919; its closed-shadow navigation smoke passed in 2.5s. Development dist was rebuilt afterward.
- npm run package:cws built the ZIP but validation FAILED because release-notes 0.2.1 remains unreleased. Other reported package checks passed. Do not upload or relabel this as release-ready; leave status unchanged until release acceptance. No publication performed.
- Current headless My Moments workflow passed in 19.0s: note reload, opt-in history capture, history-to-bookmark, clearing history without deleting bookmarks, responsive widths, refresh-token path, unavailable/retry, deletion, account isolation, and no credentials in public local storage. This remains mocked backend evidence, not the user's hosted account. All test processes exited.

- Follow-up: live chart action now says Stream analytics, distinct from the top Analytics Hub. Added regression assertion. Found and fixed live-to-VOD bookmark filtering: LIST_BOOKMARKS carries a validated contextVodId for sender authorization, separately from backend filters. When streamId exists, SavedMoments filters only by that stream so older bookmarks without vodId remain visible and deduplicated. VOD-only records still filter by vodId. Focused authorization/parser/bookmark tests: 34 passed; headless VOD save/reload/library workflow: 1 passed in 7.8s. Typecheck and development build passed. These edits postdate the preserved CWS snapshot; rerun the release artifact gate before packaging.

- Live and VOD share the full-width chart rail. Minus/plus/Reset appear only while zoomed. Actual rendered tools now verify at 24px, Reset 44x24px; a CSS minimum previously overrode inline dimensions.
- Clip carousel covers live, offline last-stream recaps, and VODs with stream-scoped boundaries. Loading, empty, retry, scrolling, and reduced-motion states have focused mocked coverage.
- My Moments is free with a linked account. Fixed VOD sender authorization, recap access, and account-change rehydration. Mocked save/reload/library workflows pass; the user's hosted-account issue is NOT yet verified resolved.
- Fixed a real store-build dropdown event-order bug: document outside-pointer handling now runs after shadow capture. Closed-shadow store test passes all eight presets plus Analytics Hub and Supporter navigation.
- Latest CWS artifact passes unchanged bundle caps: 583,402 raw / 168,176 gzip bytes (124 gzip bytes spare). Snapshot: test-results/cws-navigation-verified-20260919. Development build restored in dist; development size does not pass the release gate.
- Latest checks: typecheck passed, 10 focused unit checks passed, store navigation 1 passed in 2.4s, live/VOD zoom 2 passed in 3.7s. Earlier full suite: 1,340 passed before the final select/dimension fixes. Earlier eight focused UX browser checks passed in 21.3s. Runs are headless and bounded; no test process left running.
- Runtime dependency audit: zero findings. Development audit: two moderate Vitest/mocker findings for advisory GHSA-82fw-gwwq-j7x9. No forced major upgrade performed.
- User reported reloading extension and Twitch. Latest inspection still shows fullscreen video on xQc; Pulse sidebar is hidden. Leave playback untouched. Installed visual parity and hosted account verification remain open.
- Rain controls are in Settings, not the front page; rain spans the Pulse background. Tenure preview is local-only. Duplicate analytics wording and final visual acceptance remain open. Do not claim the full redesign or release is finished.
- Store tests can target the snapshot with PULSE_EXTENSION_DIST_DIR; use PULSE_EXTENSION_HEADLESS=1 and PULSE_EXTENSION_BROWSER_CHANNEL=chromium. Do not run development shadow locators against closed-shadow CWS builds.

The sections below are historical evidence, not instructions to repeat old audits or reintroduce removed controls.

## Mission

Latest follow-up: see [UX goal review](UX_GOAL_REVIEW_2026-09-19.md). Front-page Pause/Resume rain was removed; settings own Off/Still/Rain. Zoom controls now precede Saved Moments and remain visible while zoomed. A bounded live-stream clips carousel uses the existing metadata endpoint. The review distinguishes implemented UI from unresolved hosted verification and the bundle-size gate.

## Latest Verified Checkpoint (2026-09-19, Banner Pass)

### User Correction: Panel Background and Recognition

- User clarified that rain belongs across the black Pulse container, not in a separate header banner. `OverlayMain` now owns the backdrop and pause state; the absolute decorative layer spans the panel viewport. Content remains interactive, section fills are translucent, and settings/Chat do not show the running background.
- Removed both header top borders and the separate header fill. The former Sidebar accent is now **Pulse signature**, a small coloured Peak mark beside the title. Existing entitlement/equip behaviour is preserved.
- Controls now read **Personalise your Pulse background**, **Panel title**, and **Save background**. New profiles default to Rain; explicit saved Still/Off preferences remain respected. Use Rain in settings if the previous turn saved Still.
- Replaced outline/crown tenure art with filled, faceted milestones: teal, blue, violet, gold, rose. The white pulse remains consistent; milestones differ in colour and silhouette. Preview uses true 18px size and remains local-only.
- Typecheck/build passed; all 22 focused unit checks passed across the initial run and the corrected native-size assertion. Headless panel check passed in 3.2s and Supporter settings/responsive check in 1.9s. No test process remains running. Prior bundle-size release gate is still outstanding.

This section supersedes older speculative status below. Do not repeat earlier broad audits.

- Added personal banner controls in Quick settings and full settings: title (40 characters), 7TV Off/Still/Rain, intensity, live preview, Save, and Reset. Preferences use Chrome sync storage; no subscription check was added.
- Pulse header uses the new backdrop and personal title. Supporter finish preview uses that same backdrop/title, with its existing paid accent entitlement unchanged.
- Default is Still. Six bounded static 7TV images use CSS movement only in Rain mode. Reduced motion disables movement; hidden/offscreen banners pause; the header offers Pause/Resume rain. Failed images are hidden. Two obsolete portal emote IDs returned 404 and were replaced with verified working IDs in the extension only.
- Main new code: `src/ui/PulseBanner.tsx`; preference normalization/get/set in `src/shared/storage.ts`. Integration: `Overlay.tsx`, `PulseSettingsPanel.tsx`, `SettingsWorkspace.tsx`, `StreamPulseTitleBlock.tsx`, `options/SupporterCosmeticControls.tsx`.
- IMPORTANT correction: the earlier My Moments `pending` failure was not evidence of a broken coordinator. The entire three-link workflow had a 15-second command timeout, while each link has a five-second cooldown. The existing workflow passed with a 45-second test timeout. The spec now explicitly documents/sets that timeout. No production account state-machine change was needed.
- Focused coordinator tests passed (11). Banner/settings/Supporter checks passed (22 tests). `npm run typecheck` and `npm run build` passed. `dist/` was rebuilt after the final source edits.
- Headless packaged banner test passed in 3.3 seconds: saves/reloads title, pauses/resumes rain, loads all six real CDN images, respects reduced motion, and has no header horizontal overflow at 1440/1000 viewport widths. Screenshots were successfully inspected this turn. This proves mocked extension behaviour, not installed Chrome/hosted account parity.
- Browser fixture now accepts `PULSE_EXTENSION_HEADLESS=1`. Use with `PULSE_EXTENSION_BROWSER_CHANNEL=chromium` to avoid visible test windows. Both browser processes from this turn exited; none was left running.
- Remaining release gate: `npm run check:bundle-budget` FAILS on the current dirty checkout: approximately 603,716 raw / 173,159 gzip bytes against 588,500 / 168,300 caps. Do not raise the caps. Attribution across the large existing dirty diff was not established; a focused bundle reduction is still needed before release.
- User must reload the extension and refresh Twitch to see this newly built banner. Earlier reloads predate this build.

Bounded banner verification command (PowerShell):

```powershell
$env:PULSE_EXTENSION_HEADLESS='1'
$env:PULSE_EXTENSION_BROWSER_CHANNEL='chromium'
npx playwright test tests/e2e/specs/pulse-banner.mocked.spec.ts --timeout=30000 --global-timeout=45000 --workers=1 --reporter=line
```

## Original Mission

Finish the extension UX pass around Moments, charts, VOD navigation, Analytics Hub entry points, and supporter badge preview. Preserve the existing dirty worktree. Do not start a broad exploratory Playwright loop. Work from focused source reads, focused tests, one build, and one short mocked browser smoke if needed.

## What The User Asked For

- Decide whether Moments and My Moments should be visible and useful without a Supporter subscription.
- Make bookmark/save, reopen, edit, export, and “View My Moments” behavior coherent.
- Treat a connected Pulse account as the likely requirement for hosted bookmarks; do not invent a paywall for core utility.
- Remove redundant “Synced” presentation when the live chart already communicates current state.
- Restore the Analytics Hub action near the top of the overlay, with the earlier visual treatment and restrained motion.
- Stop new activations from defaulting to a one-hour chart window; prefer Full stream.
- Keep zoom and pan correct across every supported duration and make the `-`, `+`, and Reset controls responsive and polished.
- When a VOD jump is made, optionally show/pin that offset in the chart; provide a setting to turn that behavior off.
- Make badge preview truthful and useful. Improve the rough finish and expand tenure concepts beyond only two states, including 3 months.
- Improve button sizing, motion, reduced-motion behavior, focus states, and general quality of life.

## Verified Repository Facts

- The extension and portal are owned by `streamclone-pulse`.
- Extension source is under `src/`; shared Pulse packages are under `packages/`.
- Content scripts must use background messages for HTTP; the service worker owns backend requests.
- Default hosted backend is `https://api.streampulse.stream`.
- `dist/` is a build artifact. Chrome does not hot-reload it.
- After source edits: run focused tests, then `npm run build`; only then ask the user to reload `chrome://extensions` and hard-refresh Twitch.
- Existing worktree is very dirty. It contains broad tracked edits, many untracked tests, audit logs, screenshots, and generated files. Do not reset, clean, checkout, or reformat unrelated files.
- A recent local build completed and wrote `dist/` plus build provenance.
- A recent focused Vitest run passed:
  - 8 files
  - 106 tests
  - included Analytics Hub CTA, Saved Moments, chart viewport/controls, popup navigation, supporter recognition, and chart hydration race coverage.
- Recent typecheck passed.
- A prior mocked browser audit covered zoom/reset behavior for all six chart presets on two-minute and six-hour streams.
- Browser-policy rejection and image-viewing limitations mean installed-extension parity and screenshot-based visual approval are not proven.

## Current Implementation Signals

### Moments

- `src/ui/SavedMoments.tsx` exists and has real save/list/notes/export-adjacent logic.
- `src/options/MyMomentsPage.tsx`, `src/background/myMoments.ts`, `src/background/myMomentsStore.ts`, and related account/bookmark files are present in the dirty worktree.
- The current evidence suggests Moments are intended as account-linked bookmarking, not Supporter-only functionality.
- Remaining risk areas:
  - signed-out overlay error handling may be too generic;
  - overlay saves may lack reliable VOD identity;
  - duplicate saves may be possible;
  - hosted playback/history availability is not proven;
  - “View My Moments” navigation may still be inconsistent.

### Chart range and zoom

- `src/ui/ChartViewportControls.tsx`, `src/ui/chartViewport.ts`, chart pan math, position rail, and related package components are already substantially implemented.
- Accessibility tree observations show a range label such as `Full stream`, a slider, and zoom buttons with disabled states at the boundary.
- Stored chart-window preferences currently recognize `15m`, `30m`, `60m`, `2h`, `4h`, and `full`.
- The one-hour startup is likely caused by persisted prior selection or legacy storage migration, not necessarily one hard-coded default. Verify the hydration and activation paths before changing behavior.
- Product direction for this pass: Full stream on each new activation, while keeping deliberate in-session zoom/range changes usable. Avoid silently overwriting a valid user preference unless the product decision is explicit.

### VOD chart cursor

- `src/ui/Overlay.tsx` owns `chartPinOffset` and jump behavior.
- `src/ui/LiveStatsBand.tsx` already accepts chart pin/selection callbacks.
- `src/ui/PastVodsSection.tsx` and VOD helpers already expose jump callbacks.
- A preference toggle is not yet confirmed. Add one shared preference, not a second local state system:
  - default: enabled;
  - label should explain “Show VOD jumps on chart”;
  - when disabled, VOD playback still seeks, but no chart pin/selection is created;
  - clear stale pins when changing VOD or leaving VOD context.

### Analytics Hub CTA

- `src/ui/AnalyticsHubCta.tsx` was recently restored toward the earlier single-button treatment.
- The intended shape is one prominent top-level action with:
  - accent/purple theme aligned to the extension;
  - “Open Analytics Hub” label;
  - short supporting description;
  - restrained entrance/hover motion;
  - reduced-motion support;
  - accessible title and `aria-label`.
- Avoid adding multiple overlapping “Open full analytics”, “Open analytics hub”, and “Synced” actions in the same small header.

### Synced state

- “Synced” is not automatically useful when the live chart already shows fresh data.
- Prefer a compact exceptional status treatment:
  - loading/backfill/stale/error states remain visible;
  - healthy live state can be quiet or omitted;
  - if retained, use it as a tooltip/secondary status, not a competing primary button.

### Supporter badge preview

- Badge preview appears local-only; there is no evidence that it is equipped, persisted, or injected into Twitch chat.
- Existing finish changes a thin accent line and Peak mark, which makes the purpose unclear.
- Two hard-coded tenure states are insufficient. A coherent preview family should include at least:
  - 1 month
  - 3 months
  - 6 months
  - 12 months
  - 24 months
- Keep this truthful: call it a preview/cosmetic accent unless shared Twitch badge delivery is actually implemented.
- Check small-size readability, especially the 24-month silhouette and any miter/overlap issue.

## Files To Read First

Read only these before editing:

```text
src/ui/Overlay.tsx
src/ui/SavedMoments.tsx
src/ui/ChartViewportControls.tsx
src/ui/ChartPositionRail.tsx
src/ui/AnalyticsHubCta.tsx
src/ui/LiveStatsBand.tsx
src/ui/PastVodsSection.tsx
src/ui/usePulsePreferences.ts
src/shared/storage.ts
src/options/MyMomentsPage.tsx
src/options/SupporterCosmeticControls.tsx
src/ui/supporterFinish.ts
src/ui/theme.ts
tests/savedMoments.test.tsx
tests/ChartViewportControls.test.tsx
tests/chartViewport.test.ts
tests/AnalyticsHubCta.test.ts
tests/usePulsePreferences.test.tsx
tests/e2e/specs/my-moments.mocked.spec.ts
tests/e2e/specs/chart-interactions.mocked.spec.ts
```

Use `rg` to locate existing contracts before adding new names:

```powershell
rg -n "defaultChartWindow|chartWindow|chartPinOffset|jumpToOffset|View My Moments|AnalyticsHubCta|supporterFinish|tenure|Synced" src packages tests
```

## Recommended Finish Order

1. **Reconstruct current state**
   - Inspect the files above and their focused diffs.
   - Identify which edits are already present and avoid replacing them wholesale.
   - Confirm the active default chart-window constant and every caller that persists it.

2. **Fix Moments truth and navigation**
   - Keep Moments available to signed-in free users.
   - Gate only hosted/account actions that truly require identity.
   - Make signed-out copy actionable: connect account, retry, or continue locally.
   - Make one canonical “View My Moments” destination.
   - Add duplicate-save protection using the existing bookmark identity contract.

3. **Add VOD jump-to-chart preference**
   - Add storage getter/setter and a default of enabled.
   - Expose the toggle in the existing settings surface.
   - Thread the preference into the existing jump path.
   - Test both enabled and disabled behavior.

4. **Make chart startup and controls predictable**
   - New activation starts at Full stream.
   - Preserve zoom during normal interaction and reset cleanly.
   - Keep `-`, `+`, Reset, slider, and rail bounded for short and long streams.
   - Use stable button dimensions, clear disabled states, focus-visible styles, and reduced-motion handling.
   - Avoid a control that grows unpredictably as the range changes; use a stable toolbar with an optional compact label.

5. **Finish Analytics Hub CTA**
   - Keep one top-level CTA near the top.
   - Reuse theme tokens, not a new unrelated color family.
   - Keep motion short and useful: subtle translate/opacity entrance, hover sheen, no looping distraction.
   - Add/retain regression tests for text, token usage, and reduced motion.

6. **Clarify badge preview**
   - Rename copy to make preview status explicit.
   - Implement 1/3/6/12/24 month visual variants with a stable base silhouette.
   - Ensure equip/selected state is visibly distinct from merely previewing.
   - Do not imply Twitch chat delivery unless the actual integration exists.

7. **Validate once**
   - Run focused Vitest for changed areas.
   - Run `npm run typecheck`.
   - Run `npm run build`.
   - Run one bounded mocked browser command only if a focused interaction needs it. Never leave Playwright running unattended.
   - Report exact commands, pass/fail, and any unverified live behavior.

## Suggested Acceptance Criteria

- A signed-in non-Supporter can see and use Moments without a misleading paywall.
- Signed-out users get an actionable account prompt instead of a generic failure.
- “View My Moments” opens one predictable page and does not silently fail.
- Re-saving the same moment does not create an accidental duplicate.
- A fresh overlay activation presents Full stream.
- Zoom works at every supported range; min/max controls disable correctly; Reset returns to the full range.
- A VOD jump seeks playback and, when enabled, pins the same offset in the chart.
- Disabling the VOD chart-jump setting leaves playback seeking intact and removes the chart pin side effect.
- Analytics Hub has one clear, themed CTA near the top with restrained accessible motion.
- Healthy live state is not represented by redundant “Synced” chrome.
- Badge preview communicates “preview” and offers 1, 3, 6, 12, and 24 month states without claiming shared Twitch delivery.

## Known Non-Goals / Do Not Do

- Do not inspect or modify backend/ops code for this UI pass.
- Do not add a new analytics stack or a second chart engine.
- Do not start another long-running browser audit.
- Do not retry the browser URL-policy-blocked installed-settings inspection through alternate surfaces.
- Do not claim production Twitch playback, hosted bookmark CRUD, or installed-extension parity without a direct successful observation.
- Do not clean the worktree, remove audit artifacts, or revert user changes.
- Do not commit or push unless explicitly requested.

## Handoff Status

The repository has enough existing implementation to finish this as a focused refinement pass. The highest-value next action is a narrow source/diff review followed by the VOD preference and Moments navigation fixes, then a single build and focused validation. The prior twelve-hour Playwright concern should be treated as a process failure: use bounded commands with explicit timeouts and stop conditions.
