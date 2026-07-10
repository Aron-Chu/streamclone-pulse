---
name: streamclone-task-runner
description: Execute StreamPulse portal tasks from docs/website-portal/tasks.md in dependency order. Use when implementing portal/infra work or checking off TASK-IDs.
---

# Streamclone task runner

## Read first

1. [website-portal/tasks.md](https://github.com/Aron-Chu/streamclone-pulse/blob/master/docs/website-portal/tasks.md) — ordered TASK-IDs, acceptance criteria, tests
2. [website-portal/design.md](https://github.com/Aron-Chu/streamclone-pulse/blob/master/docs/website-portal/design.md) — do not re-decide architecture here
3. [website-portal/analytics-command-center-layout.md](https://github.com/Aron-Chu/streamclone-pulse/blob/master/docs/website-portal/analytics-command-center-layout.md) — hub landing layout, Pulse Moments + chart rail inspector, range/bucket streamer footers (2026-07)
4. [website-portal/local-dev-runbook.md](https://github.com/Aron-Chu/streamclone-pulse/blob/master/docs/website-portal/local-dev-runbook.md) — hosted-first portal dev preflight

## Workflow

1. Pick the next **unblocked** task (respect Depends on).
2. Implement only files listed (or narrowly related).
3. Verify **acceptance criteria** and **Tests** sections literally.
4. Mark checkbox `- [x]` only after criteria pass — never for partial work.
5. If blocked, annotate task with blocking TASK-ID; do not skip dependency order.

## Recommended first batch

Start from the "Recommended first implementation batch" section at the bottom of `tasks.md`.

## Cross-repo routing

| Area | Repo |
|------|------|
| Portal UI, extension | streamclone-pulse |
| Go BFF, migrations, packages | **streampulse-backend** (`../streampulse-backend`) |
| pulse-core types | **streampulse-backend** `packages/pulse-core/` |

## Endpoint defaults

Portal and analytics hub (`/analytics`) use **`https://api.streampulse.stream`** by default. Use `http://localhost:8081` only when explicitly debugging the **streampulse-backend** local stack (not `:8090`).

## Verification commands

```bash
# Portal preflight (see local-dev-runbook.md)
cd streampulse-web && npm install
npm run dev:hosted   # Vite → https://api.streampulse.stream
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/analytics

# Portal/extension tests
npm run typecheck && npm test
npx playwright test tests/e2e/analytics-hub-ux.spec.ts tests/e2e/hub-audit-regression.spec.ts --workers=1

# Backend (streampulse-backend)
cd ../streampulse-backend && make test-analytics
curl -s https://api.streampulse.stream/v1/extension/health
curl -s "https://api.streampulse.stream/v1/public/hub" | head -c 500
```
