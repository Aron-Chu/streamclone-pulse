# Track A — KPI Skeleton Ship (post-audit polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `…` ellipsis loading state on analytics KPI tiles with a shape-reserving `Skeleton`, using existing primitives (no new kit), without regressing the layout contract or the `analytics-hub-metrics-honesty` spec copy.

**Architecture:** Touch only `KpiCard.tsx` (and one honesty probe if needed). Switch its loading branch from a text node to a shared `Skeleton` element that matches the KPI tile's content footprint. Reuse `src/ui/primitives/Skeleton`; if its API doesn't fit, call the hub-local duplicate in `streampulse-web/src/ui/components/hub/primitives.tsx`. No new file. No layout-contract change.

**Tech Stack:** React 19, TypeScript, Playwright (capture + specs), existing `Skeleton` primitive. No new dependencies.

**Owner:** streamclone-pulse (`streampulse-web`). Branch from `main` (separate from Track B).

---

## Global Constraints

These are copied verbatim from `docs/website-portal/audits/2026-08-12-portal-ui/PRODUCT-GATE.md` and `FINDINGS.md`. Every task below implicitly obeys them.

- **GC-1 (gate):** Public-analytics CTA posture stays. No `/setup` `/login` `/dashboard` hero CTA restore.
- **GC-2 (gate):** No agent/chat chrome from Beautiful UI.
- **GC-3 (gate):** No analytics layout contract changes (don't move/resize/rename tiles in the command-header grid).
- **GC-4 (gate):** No new shared primitives (`ElapsedLoader`, `StatusRow`, `TraceList`, `LiveTicker`, shared `MobileNav`).
- **GC-5 (gate):** Hub live data is optional enhancement, not critical path; no invented numbers on empty/error.
- **GC-6 (audit):** `analytics-hub-metrics-honesty.spec.ts` expects "Live viewers now" historically — UI currently uses "Live pool sum now". Do **not** change UI copy in this plan; do not regress the spec.
- **GC-7 (audit):** Capture matrix must stay 12/12 (`landing-design-audit.spec.ts` + `analytics-design-audit.spec.ts`).
- **GC-8 (process):** Branch hygiene — Track A and Track B land on separate branches from `main`. Do not touch `streampulse-sdlc/.cursor/plans/portal_ui_kit_61d7df98.plan.md`.
- **GC-9 (process):** A2 (motion restraint) is a no-code note already captured in the spec; this plan does **not** include implementation steps for it.

---

## Pre-flight: read these before Task 1

The implementer must read these files in this order. Their content shapes every step below.

1. `docs/website-portal/audits/2026-08-12-portal-ui/FINDINGS.md` — F-06 row.
2. `docs/website-portal/audits/2026-08-12-portal-ui/PRODUCT-GATE.md` — exit criteria 1–4.
3. `docs/website-portal/audits/2026-08-12-portal-ui/REAUDIT.md` — Capture matrix and "Specs run this re-audit" table.
4. `streampulse-web/src/ui/components/analytics/KpiCard.tsx` — current loading branch (search for `…` or `loading`).
5. `streampulse-web/src/ui/primitives/Skeleton.tsx` — API surface.
6. `streampulse-web/src/ui/components/hub/primitives.tsx` — hub-local Skeleton if shared one doesn't fit.
7. `streampulse-web/tests/e2e/analytics-design-audit.spec.ts` — honesty probes that already exist for `containsFallback*`, `mobileNavToggleVisible`, etc.

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `streampulse-web/src/ui/components/analytics/KpiCard.tsx` | Replace `…` text in the loading branch with a `Skeleton` element that reserves the KPI tile's content footprint |
| Read-only reference | `streampulse-web/src/ui/primitives/Skeleton.tsx` | Shared skeleton primitive; reuse, don't extend |
| Read-only reference | `streampulse-web/src/ui/components/hub/primitives.tsx` | Hub-local Skeleton; only if shared one doesn't fit |
| Modify (conditional) | `streampulse-web/tests/e2e/analytics-design-audit.spec.ts` | Only if a probe needs to assert the skeleton is present during loading — keep the probe DRY with existing loading-state assertions |
| Evidence | `docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/2026-08-12T-track-A/` | New dated folder for post-ship captures |

No new files. No new dependencies. No package.json change.

---

## Task 1: Locate and confirm the loading branch in `KpiCard.tsx`

**Files:**
- Read: `streampulse-web/src/ui/components/analytics/KpiCard.tsx`

**Why this is its own task:** the rest of the plan assumes we know exactly which conditional renders `…` and which fields drive it. A 2-minute confirm step prevents wasted edits.

- [ ] **Step 1: Open `KpiCard.tsx` and grep for `…`**

  Run: `grep -n '…\|loading\|isLoading\|isPending' streampulse-web/src/ui/components/analytics/KpiCard.tsx`

  Expected: at least one match — a ternary or `&&` that renders `…` while loading.

- [ ] **Step 2: Capture the surrounding lines**

  Read the 5 lines before and after each match. The implementer records in their head:
  - Which prop drives the loading branch (likely `isLoading` or a similar boolean).
  - Which JSX elements render in the ready branch (so the skeleton can match their footprint).
  - Whether the loading branch is inside a wrapping element with stable height/width.

- [ ] **Step 3: Confirm the shared `Skeleton` API**

  Read `streampulse-web/src/ui/primitives/Skeleton.tsx` from top to bottom.

  Record: props it accepts (`width`, `height`, `className`, `as`, etc.), whether it supports arbitrary children, and whether it has a default aria attribute.

  If the API doesn't fit a "this tile is loading" use case (e.g., it requires hardcoded pixels that don't track CSS Grid track sizing), note the gap and proceed to Task 2 with the hub-local duplicate instead.

- [ ] **Step 4: Commit nothing yet**

  This task is information-gathering only. Move to Task 2.

---

## Task 2: Add a probe to assert skeleton presence during loading (test-first)

**Files:**
- Modify: `streampulse-web/tests/e2e/analytics-design-audit.spec.ts`

**Why test-first:** A1's done criteria requires "KPI loading state reserves layout shape" — without an automated check, future refactors can silently remove the skeleton and reintroduce layout shift. A probe locks the behavior.

**Consumes:** existing honesty probes (`containsFallback*`, `mobileNavToggleVisible`) — keep the new probe in the same shape.

**Produces:** A new `hasKpiSkeleton` probe emitted in the loading-phase honesty JSON.

- [ ] **Step 1: Locate the loading-phase probe block**

  In `streampulse-web/tests/e2e/analytics-design-audit.spec.ts`, find the section that captures the analytics loading phase. The pattern is typically `await page.goto('/analytics'); const loadingState = await captureHonesty(page, 'loading');`.

- [ ] **Step 2: Add the probe query**

  Add a new line inside the honesty probe loop (or wherever `containsFallbackEmote` is computed):

  ```ts
  const kpiTiles = page.locator('[data-testid^="kpi-"], .kpi-tile, .sc-kpi-card');
  const hasKpiSkeleton = await kpiTiles.first().locator('[data-skeleton], .sc-skeleton, .skeleton').count() > 0;
  ```

  Use whichever selector best matches `KpiCard.tsx`'s actual DOM. If `KpiCard` has no `data-testid` yet, add one in Task 3 step 2 — do not add the testid in this step.

- [ ] **Step 3: Add `hasKpiSkeleton` to the honesty-probes JSON payload**

  ```ts
  await captureHonesty(page, phase).then((probe) => ({ ...probe, hasKpiSkeleton }));
  ```

  Match the existing capture-helper signature — read the function once before editing.

- [ ] **Step 4: Run the spec to verify the new probe fails**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-design-audit.spec.ts -g "loading"
  ```

  Expected: FAIL or warning — the probe value is `false` because `KpiCard` still renders `…`. (If the test framework passes the probe as data rather than asserting, the failure manifests as the probe value being logged as `false`. Either is acceptable; the contract is "the value is observable and currently false".)

- [ ] **Step 5: Commit**

  ```bash
  cd streampulse-web
  git add tests/e2e/analytics-design-audit.spec.ts
  git commit -m "test(analytics): probe KPI skeleton presence during loading"
  ```

---

## Task 3: Replace `…` with `Skeleton` in `KpiCard.tsx`

**Files:**
- Modify: `streampulse-web/src/ui/components/analytics/KpiCard.tsx`

**Consumes:** Task 1's information (which branch renders `…`, what the ready branch's footprint is).

**Produces:** A loading-state `Skeleton` that reserves layout shape; UI copy unchanged.

- [ ] **Step 1: Add `Skeleton` import at the top of the file**

  If using the shared primitive:

  ```ts
  import { Skeleton } from '../../primitives/Skeleton';
  ```

  Path is relative; verify by reading one neighboring import in `KpiCard.tsx` (likely `../KpiCard` lives in `src/ui/components/analytics/`, primitives in `src/ui/primitives/`, so `../../primitives/Skeleton`).

  If using the hub-local duplicate:

  ```ts
  import { Skeleton } from '../hub/primitives';
  ```

- [ ] **Step 2: Add a `data-testid` to the KPI tile root element**

  Wrap or annotate the top-level JSX in `KpiCard.tsx` so the Task 2 probe can locate it. Pick a stable, specific value:

  ```tsx
  <article data-testid="kpi-card" className="sc-kpi-card ...">
  ```

  Use the existing element/className; do not introduce a new wrapper that would change the layout contract (GC-3).

- [ ] **Step 3: Replace the loading branch with a shape-reserving `Skeleton`**

  Before:

  ```tsx
  {isLoading ? (
    <span className="sc-kpi-card__loading">…</span>
  ) : (
    <span className="sc-kpi-card__value">{value}</span>
  )}
  ```

  After (shared primitive):

  ```tsx
  {isLoading ? (
    <Skeleton width="60%" height="1em" className="sc-kpi-card__loading" />
  ) : (
    <span className="sc-kpi-card__value">{value}</span>
  )}
  ```

  After (hub-local fallback if shared Skeleton API doesn't accept width/height props):

  ```tsx
  {isLoading ? (
    <Skeleton className="sc-kpi-card__loading" />
  ) : (
    <span className="sc-kpi-card__value">{value}</span>
  )}
  ```

  Choose width/height that visually match the ready branch's content footprint. If the ready branch renders a number plus a unit (e.g. `1.42k`), the skeleton should look roughly that wide. Do not exceed the tile's column track width.

- [ ] **Step 4: Verify no other copy changes leaked**

  Run: `git diff streampulse-web/src/ui/components/analytics/KpiCard.tsx`

  Expected: only the loading-branch JSX, the `data-testid`, and the import. The value-copy and the empty/error path are untouched.

- [ ] **Step 5: Run the spec from Task 2 to verify the probe passes**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-design-audit.spec.ts -g "loading"
  ```

  Expected: probe value is now `true`. The test passes (or, if the test framework logs the probe rather than asserting, the log now reads `hasKpiSkeleton: true`).

- [ ] **Step 6: Run the full 12-capture matrix**

  Run from `streampulse-web/`:

  ```bash
  npm run e2e:audit
  ```

  If the npm script is not present, run the two specs directly:

  ```bash
  npx playwright test tests/e2e/landing-design-audit.spec.ts
  npx playwright test tests/e2e/analytics-design-audit.spec.ts
  ```

  Expected: 12/12 green (6 landing phases + 6 analytics phases).

- [ ] **Step 7: Run the metrics-honesty spec explicitly**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-hub-metrics-honesty.spec.ts
  ```

  Expected: same failures as before this plan (3 known failures, copy-related). No *new* failures. The "Live pool sum now" copy must still be present in the DOM (GC-6).

- [ ] **Step 8: Commit**

  ```bash
  cd streampulse-web
  git add src/ui/components/analytics/KpiCard.tsx
  git commit -m "feat(analytics): KPI loading state reserves layout via Skeleton"
  ```

---

## Task 4: Re-run audit captures into the dated Track A folder

**Files:**
- Create: `docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/2026-08-12T-track-A/` (folder + contents)

**Consumes:** the same capture harness from `baseline-captures/`. Run with `AUDIT_EVIDENCE_DIR` set.

**Why a fresh dated folder:** REAUDIT.md's exit criteria require post-minimal-work captures. Track A's ship needs its own evidence folder so reviewers can compare.

- [ ] **Step 1: Determine the capture command**

  Read `streampulse-web/package.json` `scripts` field. Find the audit capture command (likely `e2e:audit:capture` or similar — if absent, look in the audit folder for a `run-audit.sh` or a doc).

- [ ] **Step 2: Run the capture with the dated evidence dir**

  Run from repo root:

  ```bash
  AUDIT_EVIDENCE_DIR=docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/2026-08-12T-track-A \
    ./path/to/audit-capture.sh
  ```

  (Replace `./path/to/audit-capture.sh` with whatever the project actually uses. If the capture is an npm script, prepend `npm run` and pass the env var.)

  Expected: 12 capture folders under `2026-08-12T-track-A/`.

- [ ] **Step 3: Sanity-check the honesty probes in the new captures**

  Read `reaudit-captures/2026-08-12T-track-A/landing-phase-empty/honesty-probes.json` and confirm:

  - `containsFallbackEmote === false`
  - `containsFallbackMover === false`
  - `containsFallbackCount === false`

  Read `reaudit-captures/2026-08-12T-track-A/analytics-loading-phase/honesty-probes.json` and confirm:

  - `hasKpiSkeleton === true` (the new probe)

- [ ] **Step 4: Commit the captures**

  ```bash
  git add docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/2026-08-12T-track-A/
  git commit -m "docs(audit): Track A capture evidence (KPI Skeleton ship)"
  ```

---

## Task 5: PR description and review checklist

**Files:**
- Modify: GitHub PR description (text only, no code)

- [ ] **Step 1: Open the PR against `main`**

  Branch name convention: `track-a/kpi-skeleton`.

  Title: `feat(analytics): KPI loading state reserves layout via Skeleton (Track A polish)`

- [ ] **Step 2: PR description template**

  ```markdown
  ## Track A — KPI Skeleton ship

  Implements A1 from `docs/website-portal/plans/2026-08-12-post-audit-next-steps.md`.

  ### Change
  - `KpiCard.tsx`: loading branch renders `Skeleton` (shared primitive) instead of `…`.
  - `analytics-design-audit.spec.ts`: new probe `hasKpiSkeleton` asserts skeleton presence during loading.

  ### Why
  - F-06 (audit): "Loading KPIs/chart/moments reserve layout shape".
  - Gate allows reuse over new kit; `Skeleton` already exists in `src/ui/primitives`.

  ### Out of scope (deliberately)
  - A2 motion restraint — no-code note only, in the spec.
  - F-02 demo fixtures — parked.
  - F-05 critical-path deferral — parked.
  - Track B (hub-ux / metrics-honesty drift) — separate PR.

  ### Verification
  - 12/12 capture matrix green: see `reaudit-captures/2026-08-12T-track-A/`.
  - `hasKpiSkeleton === true` in `analytics-loading-phase/honesty-probes.json`.
  - `containsFallback* === false` preserved on empty/error.
  - `analytics-hub-metrics-honesty.spec.ts` failure count unchanged (3 known, copy-related, GC-6).
  - No new shared primitive.
  - No analytics layout-contract change.
  ```

- [ ] **Step 3: Request review**

  Reviewer: engineer who owns the analytics layout (per the spec's ownership table). Confirm they eyeball:

  - The `data-testid="kpi-card"` placement (does not change layout).
  - The skeleton width/height match the ready-branch footprint.
  - The probe in the spec is observable in the JSON, not asserted in a brittle way.

- [ ] **Step 4: Merge only after CI is green and reviewer approves**

  Do not merge with the metrics-honesty spec still failing for *new* reasons. The 3 pre-existing failures are not in this PR's scope (GC-6, GC-8).

---

## Done Criteria (recap from the spec)

Track A done when **all** are true:

- 12/12 capture matrix passes (stored in `reaudit-captures/2026-08-12T-track-A/`).
- `analytics-hub-live-wire-ticker.spec.ts`, `analytics-live-activity.spec.ts`, `check:analytics-overlap` stay green.
- No new shared primitive added.
- No `streampulse-web/src/ui/components/analytics/` layout-contract file touched.
- No PRD-restore work.
- `landingTickerHonesty.test.ts` stays green.
- `hasKpiSkeleton === true` in the loading-phase honesty probe.
- `analytics-hub-metrics-honesty.spec.ts` failure count is exactly 3 (no new failures).