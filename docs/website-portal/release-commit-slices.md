# Release commit slices (TASK-R0-001)

Use these slices when committing the current dirty worktree. Do **not** stage generated artifacts.

## Never stage

`dist*`, `dist.before-*`, `runtime/`, `test-results/`, `playwright-report/`, `.playwright-mcp/`, `tsconfig.tsbuildinfo`, `.codegraph/`, `.env.local`, root `*.png`, `scripts/tmp/`, `analytics-hub-full.png`, `firefox-review/`, `lighthouse-report.json`.

**Staging rule:** `git add -- <path>…` only — never `git add .`. After staging, run `git diff --cached --name-only` and compare to the slice list below.

## Slice A — Portal perf (streamclone-pulse)

- `streampulse-web/index.html`
- `streampulse-web/src/main.tsx`
- `streampulse-web/src/routes/index.tsx`
- `streampulse-web/src/hooks/usePublicHubData.ts`
- `streampulse-web/tests/usePublicHubData.test.tsx`
- `streampulse-web/vite.config.ts`
- `docs/website-portal/hub-fanout-edge-cache.md`

Suggested message: `perf(portal): hub first-load, poll discipline, and cache docs`

## Slice A-backend — Hub cache tests (streamclone)

Separate repo / separate commit — coordinated with pulse slice A.

- `internal/analytics/hub_overview_test.go`

Suggested message: `test(analytics): public hub cache-control and list caps`

## Slice B — Portal build gate + console bootstrap

**streamclone-pulse**

- `streampulse-web/tsconfig.json`
- `streampulse-web/tsconfig.test.json`
- `streampulse-web/package.json`
- `streampulse-web/src/vite-env.d.ts`
- `streampulse-web/src/lib/streamcloneAnalytics.ts`
- `streampulse-web/src/routes/analytics/ConsoleChannelView.tsx`
- `streampulse-web/vitest.config.ts`
- `streampulse-web/scripts/pages-deploy-prod.mjs`
- `streampulse-web/tests/analyticsConsoleMotion.test.ts`
- `streampulse-web/tests/analyticsConsoleUtils.test.ts`
- `streampulse-web/tests/analyticsConsoleVodLink.test.ts`
- `streampulse-web/tests/analyticsHonesty.test.ts`
- `streampulse-web/tests/analyticsRoutes.test.tsx`
- `streampulse-web/tests/gameSegmentChart.test.ts`
- `streampulse-web/tests/recapEmoteCatalogEnrich.test.ts`
- `streampulse-web/tests/selectedMomentDisplay.test.ts`
- `streampulse-web/tests/streamRecapEmotes.test.ts`

Suggested message: `fix(portal): split app/test typecheck and sync console API setup`

## Slice C — Hub UI refactor

- `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`
- `streampulse-web/src/ui/components/analytics/HubCommandHeader.tsx` (LF normalized)
- `streampulse-web/src/ui/components/analytics/AnalyticsHubSidebar.tsx`
- `streampulse-web/src/ui/components/analytics/FigmaGlobalActivityPanel.tsx`
- `streampulse-web/src/ui/components/analytics/figma-analytics.css`
- `streampulse-web/src/ui/components/hub/HubDataHealthBanner.tsx`
- `streampulse-web/src/ui/themes/commandCenterLabels.ts`
- `streampulse-web/tests/analyticsLandingPage.test.tsx`

Suggested message: `feat(portal): hub command header and landing polish`

## Slice D — Extension overlay

- `src/ui/Overlay.tsx`, panel/chart components, extension tests under `tests/`

Suggested message: `fix(extension): overlay and panel updates`

## Slice E — Docs / agent boundary

- `.cursor/agents/`, `.cursor/rules/`, `.cursor/skills/`, `.cursor/mcp.recommended.json.example`, `.cursor/hooks/`
- `AGENTS.md`, `docs/CONTEXT.md`
- `docs/website-portal/release-status.md`, `release-commit-slices.md`, `release-gap-closure-tasks.md`
- `docs/pulse-extension/chrome-web-store-review-checklist.md`
- Portal/pulse requirement docs touched in this release (`docs/website-portal/design.md`, `docs/pulse-extension/design.md`, etc.)

Suggested message: `docs: release gap closure and agent runbooks`

## Slice F — Ops runbooks/scripts (streamclone only)

- `scripts/ops/hosted-redis-audit.sh`
- `scripts/ops/verify-public-hub-edge-cache.sh`
- `scripts/ops/release-gap-vps-execute.sh`
- `scripts/load/hosted-release-check-soak-loop.sh`
- `docs/ops/hosted-redis-bounds-runbook.md`
- `docs/ops/hosted-limits-staged-runbook.md`
- `docs/ops/release-check-evidence-template.md`
- `docs/ops/cloudflare-public-hub-waf.md`
- `docs/ops/examples/promotion-manifest-rc18.example.md`
- `docs/ops/evidence/release-gap-2026-07-07-remote.md`

Suggested message: `docs(ops): release gap closure runbooks and hosted probes`

## Pre-commit checks (slices A + B)

```bash
git diff --check
cd streampulse-web && npm run typecheck && npm run build && npm test
```
