# Workspace cleanup map (2026-07-11; roles corrected 2026-07-12)

Active checkouts while Command Center WIP is unmerged:

| Checkout | Branch | Role |
|----------|--------|------|
| `streamclone-pulse` | varies (e.g. `master`, extension WIP) | Extension `src/` + docs; **portal UI here is stale** vs hub |
| `streamclone-pulse-hub` | `wip/hub-landing` | **Current** Command Center / `/analytics` portal |
| `streamclone-pulse-ext-e2e` | `master` | Extra clean worktree (safe to remove) |

Preserved local branches (not pushed as product PRs):

- `backup/gate-a-dirty-snapshot` — full pre-cleanup WIP commit
- `wip/hub-landing` — **active** hub/landing product branch (checked out in `streamclone-pulse-hub`)
- `archive/*-wip` — archived dirty worktree contents before cull

**Portal agents:** always start Vite from `streamclone-pulse-hub/streampulse-web` on `wip/hub-landing`. Confirm with `git -C …/streamclone-pulse-hub branch --show-current` and that the `:5173` process cwd is the hub tree (both worktrees fight for the same port).

Next product work: merge `origin/master` into `wip/hub-landing` (D4 locked — no rebase / no force-push), open a focused hub/landing PR, then drop the hub worktree and revert docs to a single checkout.

Do not start race-matrix [#23](https://github.com/Aron-Chu/streamclone-pulse/issues/23) until hub WIP is split/shipped or parked.

Linked from: [`AGENTS.md`](../AGENTS.md), [`docs/website-portal/local-dev-runbook.md`](website-portal/local-dev-runbook.md).
