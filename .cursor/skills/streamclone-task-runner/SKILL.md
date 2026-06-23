---
name: streamclone-task-runner
description: Execute StreamPulse portal tasks from docs/website-portal/tasks.md in dependency order. Use when implementing portal/infra work or checking off TASK-IDs.
---

# Streamclone task runner

## Read first

1. [`docs/website-portal/tasks.md`](../../docs/website-portal/tasks.md) — ordered TASK-IDs, acceptance criteria, tests
2. [`docs/website-portal/design.md`](../../docs/website-portal/design.md) — do not re-decide architecture here

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
| Go BFF, migrations, hosted env | streamclone (`../twitch-7tv-clone`) |
| pulse-core types | streamclone `packages/pulse-core/` |

## Verification commands

```bash
# Portal/extension
npm run typecheck && npm test

# Backend (streamclone)
make test-analytics
curl -s http://localhost:8090/v1/extension/health
```
