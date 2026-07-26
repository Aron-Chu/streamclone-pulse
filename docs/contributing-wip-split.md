# Workspace cleanup map (updated 2026-07-12)

**Status:** `wip/hub-landing` merged via [PR #25](https://github.com/Aron-Chu/streamclone-pulse/pull/25). Use a **single** `streamclone-pulse` checkout for both extension and portal.

| Checkout | Branch | Role |
|----------|--------|------|
| `streamclone-pulse` | `master` (or feature branch) | Extension `src/` + portal `streampulse-web/` |
| `streamclone-pulse-hub` | — | **Retired** after PR #25 — remove the worktree if still present |
| `streamclone-pulse-ext-e2e` | `master` | Extra clean worktree (safe to remove) |

Preserved local branches (history only, not active product):

- `backup/gate-a-dirty-snapshot` — full pre-cleanup WIP commit
- `wip/hub-landing` — merged; local branch may still exist until pruned
- `archive/*-wip` — archived dirty worktree contents before cull

**Portal agents:** start Vite from `streamclone-pulse/streampulse-web` on current `master` (or your feature branch based on it).

```bash
cd streampulse-web
npm install
npm run dev   # or npm run dev:hosted
```

Linked from: [`AGENTS.md`](../AGENTS.md), [`docs/website-portal/local-dev-runbook.md`](website-portal/local-dev-runbook.md).
