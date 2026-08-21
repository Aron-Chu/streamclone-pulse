# Track A — implementation notes (2026-08-13)

Findings from executing `docs/superpowers/plans/2026-08-12-track-a-kpi-skeleton.md`
in the `track-a/kpi-skeleton` worktree at base `d57dfb91`.

## Plan file-map is stale vs the actual tree

The plan's predicted file map does not match what is tracked in git:

| Plan says | Reality in worktree (master `d57dfb91`) |
|---|---|
| `streampulse-web/src/ui/components/analytics/KpiCard.tsx` | `streampulse-web/src/ui/components/analytics/primitives/KpiCard.tsx` (component moved under `analytics/primitives/`) |
| `streampulse-web/tests/e2e/analytics-design-audit.spec.ts` contains honesty probes (`containsFallback*`, `captureHonesty`) | **Tracked version has no honesty probes.** Honesty probes (`hasSkipLink`, `mobileNavToggleVisible`, `containsFallback*`) live in `tests/e2e/landing-design-audit.spec.ts` — which is **not tracked in git at all** |
| `streampulse-web/tests/e2e/landing-design-audit.spec.ts` | Not tracked (untracked local file in main checkout) |
| `tests/e2e/helpers/designAuditCapture.ts`, `hubUxMock.ts` `hubDelayMs` | Untracked / dirty-local in main checkout, not in the worktree |
| Capture harness env `AUDIT_EVIDENCE_DIR` + `honesty-probes.json` per phase | Real harness: `writeCaptureArtifact` + `auditOutputDir(testInfo, ...)`; `honesty-probes.json` written by the landing spec into `test-results/...`; copied by `streampulse-web/scripts/copy-design-audit-captures.mjs` |

All audit docs (`docs/website-portal/audits/2026-08-12-portal-ui/*`) are **untracked
local files in the main checkout** — they do not exist in the worktree.

## What this means for the Track A ship

- The 12/12 capture matrix and the `hasKpiSkeleton` honesty probe are defined by
  **untracked local specs**. The plan assumed they were committed. Committing Track A
  against the tracked (2-test) specs is still valid and self-consistent, but the
  evidence folder will be produced by the untracked harness, not by this branch's specs.
- The untracked specs are the maintainer's own local harness; it is out of scope to
  commit them as part of Track A (that would violate "no new files" and is a separate
  harness-track decision).
- `hasKpiSkeleton` cannot be observed by this branch's tracked specs. The done-criteria
  check for it is documented in the final report instead.

## Skeleton primitive choice

- Shared primitive: `src/ui/primitives/Skeleton.tsx` — accepts `width`/`height` (any
  unit), spreads `className`, default `aria-hidden`, styled by `.sc-skeleton`
  (`src/ui/primitives/primitives.css`), which is loaded globally via `ui/primitives/index.ts`.
- Hub-local duplicate: `src/ui/components/hub/primitives.tsx` `Skeleton` — but its
  `hx-skel` CSS is scoped under `.hubx`, so it would not render styled inside the
  analytics command header. **Shared primitive chosen.** No new file, no new primitive.

## Fix-loop findings (review round 2026-08-13)

- The analytics `KpiCard` primitive (`analytics/primitives/KpiCard.tsx`) is **dead
  code** — nothing imports it. The real KPI-loading ellipses are in
  `HubCommandHeader.tsx` (`AnimatedCompact` for the 2 primary stats + 3 peak
  values). The plan's F-06 targets the KPI header, so the implementation correctly
  targets `HubCommandHeader`, not the dead primitive. The initial KpiCard change was
  reverted.
- The header mounts **only after the hub payload arrives**; KPI values then stay in
  the loading state until a later poll tick. So the loading-phase probe must sample
  at the header-mounted loading phase, not the 150ms first paint.
- KPI skeleton dimensions must match the ready number footprint: primary values
  `clamp(1.85rem, 2.6vw, 2.55rem)` (line-height 1) → skeleton `2.2rem` tall / `4rem`
  wide; peak values `1.05rem` × `1.15` → `1.21rem` tall / `3.5rem` wide.
- Vite dev servers serve stale modules for files changed after server start (no HMR
  pickup in this environment); verification must run against a fresh server.
