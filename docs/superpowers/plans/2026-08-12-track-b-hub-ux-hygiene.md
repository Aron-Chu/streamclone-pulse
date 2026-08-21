# Track B — Hub-UX & Metrics-Honesty Spec Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the pre-existing spec failures called out in `docs/website-portal/audits/2026-08-12-portal-ui/REAUDIT.md` — `analytics-hub-ux.spec.ts` (7 snapshot/assertion drift failures) and `analytics-hub-metrics-honesty.spec.ts` (3 copy-alignment failures) — without masking any real regression. End state: both specs pass; capture matrix still 12/12; no analytics layout-contract change.

**Architecture:** Reconcile the dirty worktree to a known baseline first (Task 1). Only then align spec-to-UI copy and refresh snapshots, with a hard rule that every snapshot diff is reviewed against the surviving dirty-tree changes. Re-run the full capture matrix to prove parity.

**Tech Stack:** Playwright (spec + snapshots), git, existing test harness. No new dependencies.

**Owner:** streamclone-pulse (`streampulse-web`). Branch from `main` (separate from Track A).

---

## Global Constraints

Copied verbatim from the spec and the audit. Every task below implicitly obeys them.

- **GC-1 (gate):** No analytics layout contract changes.
- **GC-2 (gate):** No new shared primitives.
- **GC-3 (process):** B1 blocks B2 and B3. Do not bypass.
- **GC-4 (process):** Track B is one PR. Split only if B1 surfaces a meaningful revert that needs its own review.
- **GC-5 (process):** Track B does not merge into main until B1 is committed and the surviving dirty-tree changes are recorded in the PR description.
- **GC-6 (audit):** `analytics-hub-metrics-honesty.spec.ts` historically expected "Live viewers now"; UI ships "Live pool sum now". B2 picks one direction — **do not** silently change both, and **do not** silently revert UI copy without product sign-off.
- **GC-7 (process):** Do not touch `streampulse-sdlc/.cursor/plans/portal_ui_kit_61d7df98.plan.md`.
- **GC-8 (audit):** Capture matrix stays 12/12 after Track B.

---

## Pre-flight: read these before Task 1

1. `docs/website-portal/audits/2026-08-12-portal-ui/REAUDIT.md` — "Specs run this re-audit" table and the paragraph below it.
2. `docs/website-portal/plans/2026-08-12-post-audit-next-steps.md` — §2 (Track B).
3. `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` — full read.
4. `streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts` — full read.
5. `streampulse-web/src/ui/components/analytics/LiveChannelsMatrix.tsx` and `HubTopEmotesTable.tsx` — to find current "Live pool sum now" copy.
6. The existing snapshot files in `streampulse-web/tests/e2e/__snapshots__/` or wherever Playwright stores them (locate by reading the spec — usually `toHaveScreenshot` calls reveal the path).

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Read-only | `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` | Identify each failing assertion/snapshot and the drift it represents |
| Read-only | `streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts` | Same for copy |
| Read-only | `streampulse-web/src/ui/components/analytics/LiveChannelsMatrix.tsx` | Locate current "Live pool sum now" copy (or its current equivalent) |
| Read-only | `streampulse-web/src/ui/components/analytics/HubTopEmotesTable.tsx` | Same |
| Modify | `streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts` | B2 — align spec copy |
| Modify (conditional) | `streampulse-web/src/ui/components/analytics/LiveChannelsMatrix.tsx` | B2 — only if product direction is "revert UI copy" |
| Modify (conditional) | `streampulse-web/src/ui/components/analytics/HubTopEmotesTable.tsx` | B2 — same |
| Modify | `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` | B3 — refresh snapshots/assertions |
| Create (snapshots) | wherever Playwright stores them | B3 — updated snapshot files |
| Evidence | `docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/2026-08-12T-track-B/` | B4 — fresh dated capture folder |
| Modify (text only) | GitHub PR description | Document B1's surviving dirty-tree changes |

No new files except snapshots and capture evidence. No package.json change. No new primitive.

---

## Task 1: B1 — Reconcile dirty worktree to a known baseline

**Files:**
- Read-only: git working tree
- Modify: nothing in code — this task is a git workflow + a PR-description stub

**Why first (and blocking):** the failing specs assert against UI state that may include dirty-tree-only changes. Without knowing which dirty changes are intended to land, fixing the specs can mask a real regression — exactly the failure mode this track was created to prevent (REAUDIT.md).

- [ ] **Step 1: Capture the current dirty state**

  Run from repo root:

  ```bash
  git status --porcelain
  git diff --stat
  ```

  Expected output: a list of modified/untracked files in `streampulse-web/` (most likely). Capture this in a temp file `track-b-dirty-baseline.txt` for the PR description.

- [ ] **Step 2: Categorize each dirty change**

  For each modified file, classify into one of three buckets:

  - **KEEP** — change is intended to land (e.g., already reviewed in another PR, or part of an in-progress feature that's known).
  - **STASH** — change is WIP that should not be in this branch's diff (e.g., someone's scratch).
  - **COMMIT-FIRST** — change is a small, isolated fix that should land as its own commit *before* the spec work begins (e.g., a rename the spec was failing on).

  Use `git log -p -- <file>` and recent chat/PR context to decide. If unsure, default to STASH.

- [ ] **Step 3: Apply the categorization**

  ```bash
  # For STASH items:
  git stash push -- <file-or-dir>

  # For COMMIT-FIRST items:
  git add <file>
  git commit -m "chore: isolate <reason> before Track B hygiene"

  # For KEEP items: leave them dirty on this branch — they will be in the same PR.
  ```

  Expected: `git status --porcelain` now lists only KEEP items plus the spec files this plan will modify.

- [ ] **Step 4: Run the failing specs and capture the new failure list**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-hub-ux.spec.ts
  npx playwright test tests/e2e/analytics-hub-metrics-honesty.spec.ts
  ```

  Expected: failure counts match REAUDIT.md's "7" and "3" (within ±1 if COMMIT-FIRST items resolved some drift). If the counts *dropped* without explanation, that's a signal a KEEP-vs-STASH decision was wrong — re-evaluate.

- [ ] **Step 5: Record baseline in PR description stub**

  Create `track-b-pr-description.md` (or the PR description in the GitHub UI later) with this section:

  ```markdown
  ## Track B — B1 worktree reconcile

  ### Surviving KEEP changes
  - <file>: <one-line reason>
  - <file>: <one-line reason>

  ### Stashed (not in this PR)
  - <file>: <one-line reason>

  ### Committed separately before this PR
  - <commit-sha>: <one-line reason>
  ```

  This is the contract reviewers will read to understand what baseline the spec fixes assert against.

- [ ] **Step 6: Commit nothing yet from this task**

  The `git stash` / `git commit` calls in step 3 already committed anything that needed committing. The PR-description stub is local. Move to Task 2 only after step 4's failure counts make sense.

---

## Task 2: B2 — Align metrics-honesty spec copy with the chosen direction

**Files:**
- Modify: `streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts`
- Modify (conditional): `streampulse-web/src/ui/components/analytics/LiveChannelsMatrix.tsx`
- Modify (conditional): `streampulse-web/src/ui/components/analytics/HubTopEmotesTable.tsx`

**Consumes:** Task 1's survived dirty-tree changes — the chosen direction must be consistent with what KEEP'd. If a KEEP change is itself a copy edit, that decides the direction.

**Produces:** Spec passes; UI and spec agree.

- [ ] **Step 1: Read the spec to find every copy assertion**

  In `streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts`, search for:

  ```bash
  grep -n 'Live viewers now\|Live pool sum now' tests/e2e/analytics-hub-metrics-honesty.spec.ts
  ```

  Also grep for `toHaveText`, `toContain`, `expect(...).toBe(`, etc. to find every assertion that pins a string.

- [ ] **Step 2: Read the UI to find the current copy**

  ```bash
  grep -rn 'Live viewers now\|Live pool sum now' streampulse-web/src/
  ```

  If neither string appears (renamed since), find what *is* there and treat that as the live copy. Note this in the PR description — it means the spec was drifted against an even older rename.

- [ ] **Step 3: Pick a direction (and record the reason)**

  **Direction A — Spec wins, revert UI copy.**

  ```bash
  # Replace the UI copy
  sed -i 's/Live pool sum now/Live viewers now/g' streampulse-web/src/ui/components/analytics/LiveChannelsMatrix.tsx streampulse-web/src/ui/components/analytics/HubTopEmotesTable.tsx
  ```

  Use this direction when:
  - The spec was reviewed and approved under the "Live viewers now" wording.
  - The UI change to "Live pool sum now" was uncommitted/scratch and not product-reviewed.

  **Direction B — UI wins, update spec.**

  ```bash
  # Replace the spec assertion
  sed -i 's/Live viewers now/Live pool sum now/g' streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts
  ```

  Use this direction when:
  - The UI copy "Live pool sum now" was product-reviewed and shipped intentionally.
  - The spec assertion was the unupdated one.

  Record the chosen direction and a one-line reason in `track-b-pr-description.md` under a new `## B2` section. If neither direction is obviously right, stop and ask the user — do not guess.

- [ ] **Step 4: Re-grep to confirm no stragglers**

  ```bash
  grep -rn 'Live viewers now\|Live pool sum now' streampulse-web/src/ streampulse-web/tests/
  ```

  Expected: exactly one of the two strings is present, in the right places.

- [ ] **Step 5: Run the spec**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-hub-metrics-honesty.spec.ts
  ```

  Expected: 0 failures. If still failing, the drift was broader than the copy string — Task 1's KEEP decisions may be wrong. Re-evaluate before proceeding.

- [ ] **Step 6: Run the audit honesty probe to confirm the copy is still honest**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-design-audit.spec.ts
  ```

  Read the honesty probe JSON. The chosen string must satisfy the probe's "honesty" criteria (whatever those are — re-read `analytics-design-audit.spec.ts` to find them). If the chosen direction makes the probe fail, the direction was wrong; revert.

- [ ] **Step 7: Commit**

  ```bash
  cd streampulse-web
  git add tests/e2e/analytics-hub-metrics-honesty.spec.ts
  # Add the UI files only if Direction A:
  git add src/ui/components/analytics/LiveChannelsMatrix.tsx src/ui/components/analytics/HubTopEmotesTable.tsx
  git commit -m "test(analytics): align metrics-honesty spec with <chosen-direction> copy"
  ```

---

## Task 3: B3 — Refresh `analytics-hub-ux.spec.ts` snapshots and assertions

**Files:**
- Modify: `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts`
- Create/update: snapshot files wherever Playwright stores them for this spec
- Modify (conditional, rare): the burst-bar / bucket-diagnostics code if a snapshot diff reveals an *unintentional* drift, not just a rename

**Consumes:** Task 1's KEEP decisions. Snapshot refresh is meaningless without knowing what the surviving UI should look like.

**Produces:** Spec passes; every snapshot diff is justified.

**Hard rule:** snapshot refresh that masks a real regression is worse than a red spec. The reviewer eyeball-diffs every snapshot.

- [ ] **Step 1: Enumerate the 7 failures**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-hub-ux.spec.ts --reporter=line
  ```

  For each of the 7 failing tests, record:
  - Test name.
  - Failure type (`toHaveScreenshot` mismatch, `toHaveText` mismatch, `toHaveValue` mismatch, etc.).
  - The line number in the spec.

  Save this list in `track-b-pr-description.md` under `## B3`.

- [ ] **Step 2: For each failure, decide: snapshot refresh or assertion refresh**

  - **Snapshot mismatch** (e.g., `toHaveScreenshot`): the UI changed intentionally (or at least, the dirty-tree KEEP changes shifted the layout/text). Run with `--update-snapshots` to regenerate, then eyeball the diff to confirm no unintended change.

    ```bash
    npx playwright test tests/e2e/analytics-hub-ux.spec.ts -g "<test-name>" --update-snapshots
    ```

  - **Text/value assertion mismatch**: update the assertion string to match the surviving UI, with a one-line justification in the PR description.

- [ ] **Step 3: Eyeball every regenerated snapshot**

  For each `--update-snapshots` run, open the diff in the snapshot file and verify:

  - The diff is consistent with the Task 1 KEEP changes (e.g., the KEEP rename of a component is reflected).
  - No unexpected element shifted (no new node, no removed node, no color/font regression).

  If a diff is bigger than expected, stop and investigate. The dirty-tree reconcile may have missed a file.

- [ ] **Step 4: Run the spec**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-hub-ux.spec.ts
  ```

  Expected: 0 failures. If still failing, the spec has assertions that don't have a clean survivor in the KEEP set — re-evaluate KEEP decisions before refreshing more.

- [ ] **Step 5: Document each refresh in the PR description**

  Append to `track-b-pr-description.md`:

  ```markdown
  ## B3 snapshot/assertion refreshes

  | Test | Refresh type | Justification |
  |---|---|---|
  | <test name> | snapshot | <one-line reason — e.g., "burst-bar label renamed from 'Burst' to 'Burst (5m)' per KEEP change in #123"> |
  | <test name> | assertion | <one-line reason> |
  ```

- [ ] **Step 6: Commit**

  ```bash
  cd streampulse-web
  git add tests/e2e/analytics-hub-ux.spec.ts
  git add <snapshot-files>
  git commit -m "test(analytics): refresh hub-ux snapshots for surviving dirty-tree changes"
  ```

  If a code file changed (rare; only when an "unintentional drift" was found and fixed in step 2), commit it with the snapshot:

  ```bash
  git add src/...
  git commit -m "fix(analytics): <describe the unintentional drift found and fixed>"
  ```

---

## Task 4: B4 — Re-run the full capture matrix into the dated Track B folder

**Files:**
- Create: `docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/2026-08-12T-track-B/`

**Consumes:** the same capture harness as Track A. Evidence of "specs that were red are now green" requires a fresh dated capture.

- [ ] **Step 1: Run the capture with the dated evidence dir**

  Same command as Track A Task 4, with `AUDIT_EVIDENCE_DIR=docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/2026-08-12T-track-B`.

  Expected: 12 capture folders.

- [ ] **Step 2: Re-run the two specs that drove this track**

  Run from `streampulse-web/`:

  ```bash
  npx playwright test tests/e2e/analytics-hub-ux.spec.ts
  npx playwright test tests/e2e/analytics-hub-metrics-honesty.spec.ts
  ```

  Expected: 0 failures each.

- [ ] **Step 3: Sanity-check the landing/analytics design audits**

  ```bash
  npx playwright test tests/e2e/landing-design-audit.spec.ts
  npx playwright test tests/e2e/analytics-design-audit.spec.ts
  npx playwright test tests/e2e/analytics-hub-live-wire-ticker.spec.ts
  npx playwright test tests/e2e/analytics-live-activity.spec.ts
  npx playwright test tests/e2e/check:analytics-overlap 2>/dev/null || npx playwright test --grep "analytics-overlap"
  ```

  Expected: all green. If `check:analytics-overlap` is a npm script (not a spec), run `npm run check:analytics-overlap`.

- [ ] **Step 4: Verify honesty probes in the new captures**

  Read the empty/error landing-phase probes and confirm `containsFallback* === false`. Read the analytics-loading probe and confirm `hasKpiSkeleton` (added by Track A) is either `true` (if Track A merged) or absent (if Track A hasn't merged yet — expected, since Track A is on a separate branch).

- [ ] **Step 5: Commit captures**

  ```bash
  git add docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/2026-08-12T-track-B/
  git commit -m "docs(audit): Track B capture evidence (hub-ux hygiene)"
  ```

---

## Task 5: PR description and review checklist

**Files:**
- Modify: GitHub PR description (text only)

- [ ] **Step 1: Open the PR against `main`**

  Branch name convention: `track-b/hub-ux-hygiene`.

  Title: `test(analytics): resolve pre-existing hub-ux + metrics-honesty spec drift (Track B hygiene)`

- [ ] **Step 2: PR description template (assemble from `track-b-pr-description.md`)**

  ```markdown
  ## Track B — hub-ux & metrics-honesty hygiene

  Resolves the pre-existing spec failures called out in `docs/website-portal/audits/2026-08-12-portal-ui/REAUDIT.md`. Track B is hygiene, not feature work.

  ### B1 — worktree reconcile
  <paste the B1 surviving-changes table>

  ### B2 — metrics-honesty copy alignment
  Direction chosen: <A or B>
  Reason: <one-line>

  ### B3 — hub-ux snapshot/assertion refreshes
  <paste the B3 refreshes table>

  ### B4 — capture matrix
  See `reaudit-captures/2026-08-12T-track-B/`.

  ### Out of scope (deliberately)
  - Track A (KPI Skeleton) — separate PR.
  - PRD §5 rewrite — docs pass, different file.
  - Hub P1 work — different plan.

  ### Verification
  - `analytics-hub-ux.spec.ts`: 0 failures (was 7).
  - `analytics-hub-metrics-honesty.spec.ts`: 0 failures (was 3).
  - 12/12 capture matrix green.
  - No analytics layout-contract change.
  - No new shared primitive.
  ```

- [ ] **Step 3: Request review**

  Reviewer: spec author for both specs. Confirm they eyeball every snapshot diff in B3 and that they agree the B2 direction is correct.

- [ ] **Step 4: Merge only after CI green and reviewer approves**

  Do not merge if any spec that was green before Track B is now red. The whole point of this track is to *reduce* red without introducing new red.

---

## Done Criteria (recap from the spec)

Track B done when **all** are true:

- `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` — 0 failures (was 7).
- `streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts` — 0 failures (was 3).
- Capture matrix still 12/12 (stored in `reaudit-captures/2026-08-12T-track-B/`).
- No analytics layout-contract file touched.
- No new shared primitive added.
- Every B3 snapshot refresh has a one-line justification in the PR description.
- The B2 direction (UI-revert vs spec-update) is recorded with reason.