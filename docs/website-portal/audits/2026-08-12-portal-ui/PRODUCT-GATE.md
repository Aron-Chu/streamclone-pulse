# Product decision gate — 2026-08-12 portal UI audit

Decisions for the audit-first plan. Implementation must follow these written outputs.

## Context

| Source | Posture |
|---|---|
| PRD §5 (`website-portal-requirements.md`) | 3 hero CTAs → `/setup`, `/dashboard`, `/login`; stats band; static-first; Lighthouse ≥90 |
| Shipped routes (`streampulse-web/src/routes/index.tsx`) | `/setup` → `/analytics`; `/login` → `/analytics`; landing CTAs → `/docs#extension` + `/analytics` |
| Hub design | Public no-login analytics |

## Gate outputs

### 1. CTA / auth posture

**Decision: update product docs to match shipped public-analytics posture** (do not restore three PRD CTAs in this pass).

- Keep two hero CTAs: install/docs path + Open Analytics.
- Do not reintroduce beta-key login UI without a separate product program.
- Follow-up (docs-only, can ship with this pass): note in findings that PRD §5.2/5.6 is stale vs shipped redirects; a later PRD edit should list `/docs#extension` (or store URL when available) and `/analytics`.

### 2. Landing live data

**Decision: live hub is optional enhancement, not critical path.**

- Critical path must render without inventing numbers.
- Optional ticker/enhancement must be labeled with freshness when data is real.
- On empty/error: **hide** ticker or show honest empty — never `FALLBACK_*` counts (same honesty rule as PRD stats band hide-on-failure).
- Prefer deferring hub fetch until after first paint when practical; do not add an elapsed hub loader on landing.

### 3. Findings approved for this pass

| ID | Action |
|---|---|
| F-01 | **Ship** — stop FALLBACK ticker numbers |
| F-02 | **Ship partial** — do not expand demo LiveSignal fallbacks this pass beyond avoiding Live-dot on empty ticker; demo graph may stay labeled fixture |
| F-03 | **Ship** — landing-specific mobile nav drawer |
| F-04 | **Ship** — `.sc-skip` skip link on landing |
| F-05 | **Ship partial** — honesty + no fallback; defer full critical-path network isolation if low-risk (document remaining hub poll) |
| F-06 | **Ship partial** — ticker empty/skeleton via existing primitives; analytics live-rail empty state; KPI skeleton only if cheap |
| F-07 | **Prototype** — collapse status banners in place (no new primitive) |
| F-08 | **Defer** |

### Explicitly not approved

- New `ElapsedLoader` / `StatusRow` / `TraceList` / `LiveTicker` / shared `MobileNav` packages
- Analytics section order / inspector / peak-pin regressions
- Agent/chat chrome from Beautiful UI

## Exit criteria (reaudit)

Same capture matrix must show:

1. empty/error honesty probes `containsFallback* === false`
2. mobile 390px has reachable Analytics + Docs
3. landing skip link `.sc-skip` present
4. analytics layout specs still green (`analytics-hub-ux`, live-wire, live-activity, overlap check)
