# Re-audit — 2026-08-12 portal UI (post minimal work)

Evidence root: `docs/website-portal/audits/2026-08-12-portal-ui/reaudit-captures/`  
Harness: `landing-design-audit.spec.ts` + `analytics-design-audit.spec.ts` with `AUDIT_EVIDENCE_DIR`.

## Gate exit criteria

| Criterion | Result | Evidence |
|---|---|---|
| 1. empty/error `containsFallback* === false` | **PASS** | `landing-phase-empty` / `landing-phase-error` honesty-probes.json |
| 2. 390px reachable Analytics + Docs | **PASS** | `mobileNavToggleVisible: true` in landing-sequence honesty-probes |
| 3. landing `a.sc-skip` present | **PASS** | `hasSkipLink: true`, `skipHref: "#demo"` |
| 4. Layout / honesty specs | **PARTIAL** | live-wire + live-activity + `check:analytics-overlap` green; hub-ux + metrics-honesty have **pre-existing dirty-tree assertion drift** (see below) |

## Capture matrix

- Landing first-paint → ready, empty, error, viewport/zoom/reduced-motion: **12/12** design-audit tests passed (landing + analytics harness).
- Analytics phases empty / error / zero-live included in the same run.

## Approved finding closure

| ID | Done criterion | Status |
|---|---|---|
| F-01 | No FALLBACK ticker on empty/error | **Closed** |
| F-03 | Landing mobile drawer at ≤960 | **Closed** |
| F-04 | `.sc-skip` on landing | **Closed** |
| F-06 partial | Ticker Skeleton/EmptyState; live-rail empty copy when pool empty | **Closed** |
| F-07 prototype | Status banners wrapped in `hub-status-strip` in place | **Shipped as prototype** (no new primitive) |
| F-05 partial | No invented Live counts; hub still polled (documented) | **Closed for honesty**; critical-path deferral remains |

## Specs run this re-audit

```text
PASS  landing-design-audit.spec.ts (all)
PASS  analytics-design-audit.spec.ts (all)
PASS  analytics-hub-live-wire-ticker.spec.ts
PASS  analytics-live-activity.spec.ts
PASS  check:analytics-overlap
PASS  tests/landingTickerHonesty.test.ts
FAIL  analytics-hub-ux.spec.ts (7) — assertion/snapshot drift vs dirty hub WIP
FAIL  analytics-hub-metrics-honesty.spec.ts (3) — expects "Live viewers now"; UI uses "Live pool sum now"
```

These hub-ux / KPI honesty failures match **uncommitted analytics work already in the worktree before this audit pass**, not the landing ticker / skip / mobile-nav / status-strip changes. Do not treat them as regressions introduced by F-01–F-07.

## Performance / motion notes

- Landing still initiates `/v1/public/hub` shortly after paint (poll); first-paint capture remains renderable with delayed hub mock.
- Reduced-motion + 200% zoom captures present under reaudit-captures matrix folders.
- Forced-colors smoke not automated in this harness; visual capture matrix covers motion off/on.

## Follow-ups (out of this pass)

- Align `analytics-hub-metrics-honesty` copy with current KPI labels (or restore labels) as a separate dirty-tree hygiene PR.
- Update hub-ux snapshots / burst-bar / bucket diagnostics expectations after hub P1 lands.
- PRD §5 rewrite to public-analytics posture (docs-only).
