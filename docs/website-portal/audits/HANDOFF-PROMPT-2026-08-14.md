# Handoff Prompt — StreamPulse Release Readiness (for Grok 4.6 / OpenCode)

Copy this prompt into OpenCode with Grok 4.6, from `/mnt/c/Users/Aron/streamclone-pulse`.

---

You are executing a production release-readiness + feature program for the StreamPulse portal and extension. Work sequentially, verify every task, and report per phase. Do NOT improvise past the specs; stop at any stop-guard.

## Entry points (read first, in this order)
1. `docs/superpowers/plans/2026-08-14-channel-analytics-final-plan.md` — the authoritative cross-repo plan (portal dashboard upgrade + secure backend portal actions + backend H3 write-auth addendum). This is the primary spec.
2. `docs/website-portal/audits/EXECUTION-SPEC-2026-08-14.md` — the release-readiness execution spec (security H1/H2, UX, cleanup, performance, housekeeping — 20 concrete tasks with file:line + verify steps).
3. `docs/website-portal/audits/release-readiness-audit-2026-08-14.md` — the findings context (all 4 audit dimensions + 2 already-shipped fixes).

Ignore `CODEX-PLAN.md` (superseded).

## Environment (from the specs)
- Frontend worktree from `origin/master`: `C:\Users\Aron\release-worktrees\channel-analytics-dashboard-upgrade` (branch `codex/channel-analytics-dashboard-upgrade`) — frontend repo, use in-repo `packages/*` only, never sibling backend.
- Backend worktree from `origin/master`: `C:\Users\Aron\release-worktrees\channel-analytics-backend` (branch `codex/channel-analytics-actions`).
- `npm ci` both; `go test ./internal/analytics/...` baseline; record baseline SHAs.
- Portal dev server on `127.0.0.1:5174` from the NEW frontend worktree (stop any prior worktree's server first; inspect PID/command before stopping).
- Guardrails: one UI stack per surface (`check:analytics-overlap`); server-side sanitization; no secrets; Aron-Chu-only commits (no Co-authored-by); e2e local-only; backend = source of truth (never invent quality/coverage).

## Execution order
1. **Baseline** both worktrees (npm ci, test:packages, go test). Stop if a baseline fails (record exact failure, don't proceed).
2. **Backend** (§2 portal action wrappers + §7 H3 write-auth + tests) → `go test ./internal/analytics/...`.
3. **Portal foundation** (§3 routing/data/types) → gates.
4. **Dashboard features** (§4: quality strip, gated data actions, games, heatmap, recap/clips, export, a11y) → gates.
5. **Release-readiness tasks** (EXECUTION-SPEC Phases 1-6: H1/H2 security, Export wiring, zoom/a11y/vocab/vodId/extension-CSP, dead-code cleanup, perf, housekeeping) → gates.
6. **Final verification** (EXECUTION-SPEC §2 gates + viewport smoke) + one commit per repo (messages in the specs) + report.

## Verification gates (run per phase, in order)
- Backend: `go test ./internal/analytics/...`
- Frontend: `npm run test:packages` (root), `npm run typecheck`, `npm test`, `npm run build:ci`, `npm run check:analytics-overlap`
- Portal: `npx playwright test tests/e2e/analytics-channel-dashboard.spec.ts --workers=1` + `npm run test:e2e:mocked` (local-only)
- Manual smoke on `127.0.0.1:5174`: `/`, `/analytics`, `/analytics/{channel}/{date}`, `?console=1`, `/admin`

## Stop-guards (halt + report, don't improvise)
- Baseline failure before any change.
- A task breaks a gate twice.
- Any cross-repo auth/rate-limit/backend change not in the specs — flag, don't invent.
- Deleting "dead" code that turns out to have an importer — revert.
- Any destructive op (route removal, cache invalidation, host_permissions trim) — confirm first.

## Deliverable
Final report: baseline + commit SHAs, changed-path summary, every gate result, the active `5174` PID/worktree, key-viewport screenshots, and remaining blockers. Do NOT push/PR/deploy/modify CWS without explicit go.
