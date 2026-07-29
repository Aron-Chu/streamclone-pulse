# Phase 2a review — agent prompt

Date: 2026-07-28
Scope: independent review of Phase 2a implementation against locked decisions and Phase 1 audit findings.
Repo: `/mnt/c/Users/Aron/AppData/Local/Temp/streamclone-pulse-audit`

---

## What to do

You are reviewing a Phase 2a implementation of an "adaptive chart + hub IA" change set in the website portal. Your job is to read the code and tests, then independently verify that the implementation matches the **locked decisions** and resolves the **Phase 1 findings**. You have not seen the conversation that produced these changes — your verdict should be derived only from the source.

You will produce a short, blunt report (≤ 400 words). Verdicts:

- **PASS** — implementation matches every locked decision and Phase 1 finding.
- **PASS WITH NITS** — matches in substance; flag nits that should be addressed but do not block.
- **FAIL** — at least one locked decision is violated, missing, or contradicted.

If you find any FAIL condition, name the file:line and quote the offending code.

---

## Context to read first (do not skip)

1. `docs/website-portal/phase1-audit-2026-07-28.md` — the Phase 1 findings the implementation must address.
2. `docs/website-portal/phase2-audit-2026-07-28.md` (if it exists) — the locked decisions (Phase 2a) and the audit narrative.
3. `docs/website-portal/analytics-command-center-layout.md` and `analytics-figma-parity-requirements.md` — the hub IA spec and parity constraints.

If any of those files is missing, say so and base your review only on the source.

## Source files that changed

- `streampulse-web/src/ui/components/hub/HubActivityChart.tsx`
- `streampulse-web/src/ui/components/hub/hub.css`
- `streampulse-web/src/ui/components/analytics/FigmaGlobalActivityPanel.tsx`
- `streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx`
- `streampulse-web/src/ui/components/hub/lib/hubChartActivityModel.ts` (if changed)
- `streampulse-web/tests/hubActivityChartDetailLayer.test.tsx` (new)
- `streampulse-web/scripts/phase2-after-capture.mjs` (new — Playwright capture)

Reference points that should NOT have been touched by Phase 2a:

- `streampulse-web/src/ui/motion/useAnalyticsMotion.tsx` — the GSAP wrapper. The Phase 2a change set should *consume* its `motionEnabled` flag, not modify the hook itself.
- Anything under `docs/pulse-extension/` — extension-release tracking, out of scope.

## Locked decisions — verify each one against the source

Confirm that **every** decision below is implemented as written. Quote the file:line that proves it. If you cannot find proof, mark the decision as **MISSING**.

1. **No `buildCalmEnvelope` / averaged resting envelope.** The smooth/calm path should still be the smoothed line (`buildCalmPath` / analogous), not an averaged envelope of detail. Verify by grep: `buildCalmEnvelope`, `envelope`, `averagedResting`. None of these should appear as new symbols introduced by Phase 2a.
2. **Detail layer = linear segments, same raw points, same X/Y domains, opacity crossfade only.** The detail layer should:
   - Use a path builder that emits straight segments between consecutive points (no curve interpolation).
   - Use the same raw data points as the smooth layer, with identical X/Y scales.
   - Crossfade via opacity only — no path morph, no domain swap.
3. **Press-drag commits on release.** While the pointer is held, the chart should *preview* the selection; the *commit* (state mutation, announcement, inspector open) happens only on pointer-up or pointer-cancel. Verify the press handlers (handlePointerDown / Move / Up / Cancel) and that there is no commit inside handlePointerMove.
4. **Pointer capture is deferred to horizontal intent (5–8 px threshold).** Verify that `setPointerCapture` is not called on pointer-down; it should be called only after the cumulative pointer movement exceeds a horizontal-intent threshold. Quote the threshold value and where it is enforced.
5. **`touch-action: pan-y`.** The chart's wrapper should set `touch-action: pan-y` only when selection is enabled (selectable mode) so vertical page scroll still works elsewhere. Verify the selector matches the selectable variant, not the rest state.
6. **`transitionInspector` fires only on mode changes** (range → preview → selected). Verify it is gated by comparing the *current mode* against the previous mode, not against every scrubbed bucket. Confirm there is no call site that fires `transitionInspector` from a per-bucket effect.
7. **Live Wire eyebrow = `"Live wire · Last 30m"`.** Find the eyebrow string and quote it. Confirm it matches exactly.
8. **Keyboard navigation:** ArrowLeft / ArrowRight ±1, Shift+Arrow ±5, Home / End, `aria-live="polite"`, **NO `role="application"`** on the wrapper. Verify all six.
9. **Reduced-motion:** The CSS should disable the `hx-bucket-cue-bounce`, `hx-bucket-cue-ring`, and `hx-chart-refresh-pulse` animations; Live Wire GSAP entry (`animateEnterHorizontal`) should not run when `motionEnabled === false` (this is already enforced inside `useAnalyticsMotion`, so verify the Live Wire feed gates on `motionEnabled` before invoking it).

## Phase 1 findings — verify each is addressed

Open `docs/website-portal/phase1-audit-2026-07-28.md` and look at the **Open Questions / Recommendations** sections. For each one, find the code that closes it. Examples (not exhaustive — pull your own list from the audit):

- "Detail layer not implemented" → check the new `<g className="hx-chart-detail-layer">` exists and mounts after the smooth paths.
- "Press-drag commits instantly" → check the press-up handler commits.
- "Pointer capture blocks page scroll on mobile" → check `touch-action: pan-y` + deferred capture.
- "`transitionInspector` runs on every scrub" → check the mode-change gate.
- "Live Wire eyebrow unclear" → check the eyebrow text.
- "Keyboard nav missing" → check ArrowLeft/Right/Shift/Home/End + aria-live.
- "Reduced-motion ignored" → check the CSS reduced-motion block.

## Tests and tooling

- Run `npx tsc --noEmit` from `streampulse-web`. Expect exit 0.
- Run `npx vitest run tests/hubActivityChartDetailLayer.test.tsx` from `streampulse-web`. Expect all tests passing.
- Run `npm run check:analytics-overlap`. Expect OK.
- Skim `tests/hubActivityChartDetailLayer.test.tsx` and judge: does it actually exercise the locked decisions (linear geometry param, opacity crossfade, press-drag commit, mode-change gate), or is it a smoke test that lets obvious regressions slip through? Be specific.

## Browser verification

There is no live browser verification in this review session — Chrome DevTools MCP is unavailable in the parent session, and Playwright MCP needs a `chrome` install. The implementation's prior Playwright capture (`scripts/phase2-after-capture.mjs`) was run against `http://127.0.0.1:5173/analytics`. If the dev server is running, you may attempt to reproduce the captures; otherwise state explicitly that browser verification was not performed.

If you do run a Playwright capture, the assertions to verify are:

- Wrapper has `tabindex="0"` only when `bucketSelectEnabled`.
- `.hx-chart-detail-layer` is present in the DOM after the smooth paths.
- The wrapper has computed `touch-action: pan-y` when in selectable mode.
- Pressing the wrapper does not block page vertical scroll on a mobile viewport.

## Output format

```
VERDICT: PASS | PASS WITH NITS | FAIL

LOCKED DECISIONS (one line each — PASS / MISSING + file:line):
1. …
2. …

PHASE 1 FINDINGS (one line each — addressed / not addressed + file:line):
- …

TOOLING: typecheck / vitest / overlap (PASS / FAIL with notes)

TESTS QUALITY (one paragraph): do the tests actually catch regressions, or are they hollow?

NITS (if any): …

FAILURES (if any): file:line — quoted code — why this violates the spec
```

Keep it under 400 words. Do not pad.
