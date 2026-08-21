# Post-audit next steps — 2026-08-12 portal UI

**Owner:** streamclone-pulse (`streampulse-web`)
**Source evidence:** [`docs/website-portal/audits/2026-08-12-portal-ui/`](../../website-portal/audits/2026-08-12-portal-ui/) — `FINDINGS.md`, `PRODUCT-GATE.md`, `REAUDIT.md`
**Status:** Plan approved (brainstorming → approved by user). No code shipped from this plan yet.
**Companion plan:** [`streampulse-sdlc/.cursor/plans/portal_ui_kit_61d7df98.plan.md`](../../../../streampulse-sdlc/.cursor/plans/portal_ui_kit_61d7df98.plan.md) (closed; do not edit).

## Gate constraints (must hold)

From `PRODUCT-GATE.md` — these are non-negotiable in this pass:

- Public-analytics CTA posture stays (no `/setup` `/login` `/dashboard` hero CTA restore).
- No agent/chat chrome from Beautiful UI.
- No analytics layout contract changes.
- No new shared primitives (`ElapsedLoader`, `StatusRow`, `TraceList`, `LiveTicker`, shared `MobileNav`).
- Hub live data is optional enhancement, not critical path; no invented numbers on empty/error.

## Two tracks

This plan splits the post-audit work into two intentionally separated tracks. They land on **separate branches from `main`** and ship as **separate PRs** so the polish pass cannot mask or be masked by dirty-tree drift.

- **Track A — Next approved UI polish.** Audit-approved work that survives the gate.
- **Track B — Dirty-tree hub-ux / KPI honesty assertion drift.** Hygiene PR that resolves pre-existing spec failures called out in `REAUDIT.md`. Not part of the polish pass.

---

## §1 Track A — ranked UI polish

Ranking axes (in order): **severity → impact → evidence strength → gate fit**.
Gate fit is the new axis — anything that violates `PRODUCT-GATE.md` is dropped, not merely deferred down.

### A1 — Replace KPI `…` ellipsis with shared `Skeleton` (F-06 portion)

| | |
|---|---|
| **Severity** | S3 → S1 (loading comprehension matters once you notice the layout shift) |
| **Surface** | Analytics — `KpiCard` and any other KPI-shaped tile in `streampulse-web/src/ui/components/analytics/` |
| **Owner repo** | streamclone-pulse |
| **Files (predicted)** | `streampulse-web/src/ui/components/analytics/KpiCard.tsx`; possibly a probe in `streampulse-web/tests/e2e/analytics-design-audit.spec.ts` |
| **Why now** | `Skeleton` already exists in `src/ui/primitives`; gate explicitly prefers reuse over new kit. Hub-local `Skeleton` duplicate is fine to call from analytics if the shared one doesn't fit; no new primitive. |
| **Done when** | KPI loading state reserves layout shape (no jump on ready); `tests/analytics-hub-metrics-honesty.spec.ts` is **not regressed** (copy stays "Live pool sum now"); 12/12 capture matrix stays green; capture stored under `reaudit-captures/` with a dated suffix. |
| **Out of scope** | Chart skeleton, moments skeleton — these are part of F-06's already-closed partial work (ticker Skeleton/EmptyState, live-rail empty). Don't expand scope. |

### A2 — Motion restraint decision note (F-08)

| | |
|---|---|
| **Severity** | S3 polish |
| **Surface** | Landing |
| **Owner repo** | streamclone-pulse |
| **Files** | none this pass |
| **Decision** | **Defer with documented reason.** Current motion signatures (emoteRain, chatBackdrop, tickers, extensionTour, signalGraph) coexist. Reduced-motion already kills rain/chat; that's sufficient for accessibility. |
| **Reopen condition** | (a) a reduced-motion complaint with reproduction, (b) a perf trace showing motion-attributable CLS/INP regression on landing, or (c) a future audit surfaces a different attention-split finding. Any reopen must cite a capture. |
| **Done when** | This note exists in the plan (this paragraph) and `FINDINGS.md` F-08 row remains "Deferred" in the audit summary table. No code change. |

### A3 (parked) — F-02 demo fixture relabel

| | |
|---|---|
| **Severity** | S0 honesty |
| **Owner repo** | streamclone-pulse |
| **Files (predicted)** | `streampulse-web/src/ui/components/landing/landingData.ts`, `streampulse-web/src/ui/components/landing/LiveSignalScrollGraph.tsx` |
| **Why parked** | Gate allows ("demo/fixture paths are labeled as demo **or** gated off when hub is empty/error") but does not request it. The already-shipped empty/error honesty probes (`landing-phase-empty` / `landing-phase-error`) catch the worst class — Live-dot on invented ticker counts. Demo `LiveSignalScrollGraph` fixtures only show when data is present; the trust risk is lower. |
| **Reopen condition** | A future audit proves the demo graph is presented as live when data is real **and** fixture copy looks live; or a user reports confusion. |

### A3 (parked) — F-05 critical-path hub fetch deferral

| | |
|---|---|
| **Severity** | S1 |
| **Owner repo** | streamclone-pulse |
| **Files (predicted)** | `usePublicHubData` call sites in `Landing.tsx`; possibly a one-shot fetch trigger on idle/scroll |
| **Why parked** | Gate explicitly says "Prefer deferring hub fetch until after first paint when practical; do not add an elapsed hub loader on landing." That is a *preference*, not a *requirement* — the honesty portion of F-05 is closed. The deferral has non-trivial tradeoffs (cache freshness vs first-paint cleanliness; SSR/SSG implications). |
| **Reopen condition** | A spike documents the tradeoffs and the cost is acceptable. Spike output, not a memory, gates reopening. |

### Track A done criteria (overall)

- 12/12 capture matrix (`landing-design-audit.spec.ts` + `analytics-design-audit.spec.ts`) passes.
- `analytics-hub-live-wire-ticker.spec.ts`, `analytics-live-activity.spec.ts`, `check:analytics-overlap` stay green.
- No new shared primitive added.
- No `streampulse-web/src/ui/components/analytics/` layout-contract file touched.
- No PRD-restore work.
- Reaudit evidence stored in `reaudit-captures/` with dated suffix.
- `landingTickerHonesty.test.ts` stays green.

---

## §2 Track B — dirty-tree hub-ux / KPI honesty assertion drift

Per `REAUDIT.md`, the following spec files fail *before* this audit pass and are **not** regressions from F-01–F-07:

- `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` — 7 failures (assertion/snapshot drift vs dirty hub WIP).
- `streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts` — 3 failures (expects "Live viewers now"; UI uses "Live pool sum now").

**This is hygiene, not feature work. Ship as one PR** (split only if B1 surfaces a meaningful revert that needs its own review).

### B1 — Reconcile worktree to main (no code change)

| | |
|---|---|
| **Severity** | S2 |
| **Owner repo** | streamclone-pulse |
| **Files** | none (git operation only) |
| **Why first** | Without knowing which dirty-tree changes survive to main, the assertion fixes in B2/B3 can mask a real regression. The audit's 7-failure spec is the canary; we must know what it's *supposed* to assert against. |
| **Done when** | `git status` of `streampulse-web` reviewed; surviving dirty changes identified; the rest stashed or committed; the surviving set is recorded in the PR description so a clean reaudit can re-run against a known baseline. |

### B2 — `analytics-hub-metrics-honesty.spec.ts` copy alignment

| | |
|---|---|
| **Severity** | S2 |
| **Owner repo** | streamclone-pulse |
| **Files** | the spec itself; possibly `streampulse-web/src/ui/components/analytics/LiveChannelsMatrix.tsx` or `HubTopEmotesTable.tsx` if the UI copy is reverted |
| **Pick one direction** | (a) Revert UI copy to "Live viewers now" — preserves spec contract; requires product sign-off because the copy has shipped in some form. (b) Update spec to "Live pool sum now" — preserves shipped UX; requires audit-honesty probe to confirm the new copy is still honest. |
| **Done when** | Spec passes locally; chosen direction recorded in PR description with reason; if UI copy reverted, captures match the new copy. |

### B3 — `analytics-hub-ux.spec.ts` snapshot / assertion refresh

| | |
|---|---|
| **Severity** | S2 |
| **Owner repo** | streamclone-pulse |
| **Files** | the spec's snapshot files; any expected-text fixtures; possibly the burst-bar / bucket-diagnostics code if a snapshot reveals a real drift, not just an intentional rename |
| **Hard rule** | Reviewer must eyeball the snapshot diffs. Snapshot refresh that masks a regression is worse than a red spec — this is the failure mode that justified separating Track B from Track A in the first place. |
| **Done when** | Spec passes locally; CI green on `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts`; PR description lists every snapshot refresh with a one-line justification. |

### B4 — Re-run REAUDIT capture matrix

| | |
|---|---|
| **Severity** | S2 |
| **Owner repo** | streamclone-pulse |
| **Files** | capture evidence only |
| **Done when** | `REAUDIT.md` § "Specs run this re-audit" would now read all PASS (currently 7 FAIL). New evidence stored under `reaudit-captures/` with a later dated folder than `2026-08-12`. |

### Track B sequencing

```
B1 (reconcile) ──► B2 (copy) ──► B3 (snapshots) ──► B4 (reaudit)
                       └─────────► (parallel if B2 doesn't touch UI) ──┘
```

**Hard rule:** B1 blocks B2 and B3. Do not bypass.

### Track B done criteria (overall)

- `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` — 0 failures.
- `streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts` — 0 failures.
- Capture matrix from `REAUDIT.md` re-runs 12/12 + the additional 2 specs green.
- No analytics layout-contract file touched.
- No new shared primitive added.

---

## §3 Out of scope (recorded, not in this plan)

From `PRODUCT-GATE.md` and `REAUDIT.md`:

- PRD §5 rewrite to public-analytics posture — docs-only; flag for a separate docs pass.
- Hub P1 work — different plan; see `streampulse-sdlc/.cursor/plans/chart-truth_fix-then-go_5316135b.plan.md` and siblings.
- `ElapsedLoader` / `StatusRow` / `TraceList` / shared `MobileNav` / `LiveTicker` primitives — gate explicitly disallows this pass.
- Agent / chat chrome from Beautiful UI.
- Restoring three-PRD-hero CTA posture.
- Section reorder, Geist replacement, `Figma*` renames.
- Section order / inspector / peak-pin regressions in analytics.

---

## §4 Process + verification-before-completion

### Ownership

| Item | Owner |
|---|---|
| Track A A1 | Engineer who owns the analytics layout (avoid regression to layout contract). |
| Track A A2 | None — note only. |
| Track A parked | Whoever reopens (none this pass). |
| Track B B1 | Whoever owns the hub-ux worktree today. |
| Track B B2 / B3 | Same as B1; spec ownership transfers to the spec author on commit. |

### Branch hygiene

- Track A and Track B land on **separate branches from `main`**.
- Track B does **not** merge until B1 is committed.
- Track A can land independently; if Track A touches a shared file with Track B, Track A lands first and Track B rebases.

### Capture re-run

After Track A ships, re-run the same 12-capture matrix from `baseline-captures/`. Store evidence in `reaudit-captures/` with a dated suffix (e.g., `2026-08-12T-post-track-A/`). Gate criteria 1–4 from `PRODUCT-GATE.md` still hold:

1. empty/error honesty probes `containsFallback* === false`
2. mobile 390px has reachable Analytics + Docs
3. landing `a.sc-skip` present
4. analytics layout specs still green (`analytics-hub-ux`, live-wire, live-activity, overlap check) — Track A must not regress Track B's eventual green.

After Track B ships, repeat the capture matrix and overwrite the dated reaudit folder; the spec status table must read 7/7 PASS.

### No silent reopens

Any reopened finding must cite a capture, not a memory. If a finding on the parked list (A3) is reopened without a capture, treat it as a new finding and re-rank.

### Verification-before-completion

Before claiming any item done, run the relevant spec locally and confirm exit code 0 with the spec name visible in the output. The harness name matters — green-by-mistake is worse than red.