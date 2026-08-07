# Extension Restrained Motion Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task.

**Goal:** Repair the narrow extension layout and add restrained, stable motion across chart, dock, route, and dropdown interactions.

**Architecture:** Keep Twitch host geometry untouched. Animate extension-owned wrappers and branch content, stabilize the existing Shadow DOM select portal, and make plotted hover styling state-aware through CSS variables.

**Tech stack:** React, TypeScript, inline React styles, Shadow DOM CSS, Vitest, Vite.

## Files And Responsibilities

- `src/ui/sevenTvEmoteReveal.ts`: six-item reveal page contract.
- `tests/sevenTvEmoteReveal.test.ts`: reveal pagination regression coverage.
- `src/ui/SevenTvEmotePanel.tsx`: plotted row state and Show more/Show less presentation.
- `src/ui/LiveStatsBand.tsx`: compact metric grid and animated chart viewport.
- `src/ui/PulseThemedSelect.tsx`: stable menu anchoring, typography, and menu motion.
- `src/ui/theme.ts`: plotted hover, branch entry, dropdown, and reduced-motion styles.
- `src/ui/Overlay.tsx`: mode and route-content entry classes/keys.
- `src/content/mount.tsx`: shell class support only if required; do not animate host rectangles.

## Task 1: Lock The Six-Emote Contract

1. Update `tests/sevenTvEmoteReveal.test.ts` to expect six-item pages and remaining-count behavior.
2. Run `npm test -- tests/sevenTvEmoteReveal.test.ts` and confirm the new expectation fails against page size three.
3. Change `EMOTE_PICKER_PAGE_SIZE` to six and update stale three-item comments or labels.
4. Rerun the focused test and expect it to pass.

## Task 2: Preserve Plot Colors On Hover

1. Add a plotted-state class and CSS custom properties to plotted rows in `SevenTvEmotePanel.tsx`.
2. Update `theme.ts` so plotted row hover retains its plot-colored border/background.
3. Remove the generic border override and inset left edge from chart legend hover; retain only restrained elevation/scale.
4. Run `npm test -- tests/chatActivityEmotes.test.ts tests/chartThemeColors.test.ts` and expect all tests to pass.

## Task 3: Repair Live Now And Animate Chart Resizing

1. Change the compact metrics style in `LiveStatsBand.tsx` to a tight, stable three-column row.
2. Wrap the chart in an explicit-height viewport with a 180 ms transition and hidden overflow.
3. Ensure the chart still receives the intended final numeric height and remains usable during resize.
4. Run `npm run typecheck` and expect no errors.

## Task 4: Stabilize And Restyle The Themed Select

1. Remove capture-phase scroll repositioning from `PulseThemedSelect.tsx`; preserve initial placement and resize updates.
2. Keep the portal inside the extension Shadow DOM.
3. Apply the extension font, 11 px readable type, consistent line height, chevron transition, and restrained menu entry animation.
4. Run `npm test -- tests/colorSchemeControl.test.ts` and expect the select positioning tests to pass.

## Task 5: Add Restrained Mode And Route Entry Motion

1. Add short mode-entry classes to collapsed, mini, and expanded Overlay branches.
2. Key or classify the expanded content using existing channel/VOD/offline identity so changed route content receives an entry animation without changing fetch behavior.
3. Add CSS keyframes in `theme.ts` using small opacity and translate changes only.
4. Confirm existing reduced-motion rules cover every new class.
5. Do not animate fixed host rectangles in `mount.tsx`.

## Task 6: Verify The Extension

1. Run focused tests for reveal, emote plotting/theme, select positioning, and Overlay helpers.
2. Run `npm test`; expect every suite to pass.
3. Run `npm run typecheck`; expect no TypeScript errors.
4. Run `npm run build`; expect a successful Vite extension build.
5. Run `git diff --check --` for only the files changed by this plan.
6. Inspect scoped status/diff and confirm unrelated worktree changes were not reverted or modified.

Do not commit; the user has not authorized commits.
