# Workspace cleanup map (2026-07-11)

After #22 (e2e foundation) and #24 (portal CI honesty):

| Checkout | Branch | Role |
|----------|--------|------|
| `streamclone-pulse` | `master` | Clean main tree |
| `streamclone-pulse-hub` | `feat/analytics-hub-wip` | Older hub WIP |
| `streamclone-pulse-ext-e2e` | `master` | Extra clean worktree (safe to remove) |

Preserved local branches (not pushed as product PRs):

- `backup/gate-a-dirty-snapshot` — full pre-cleanup WIP commit
- `wip/hub-landing` — hub/landing product carve-out from that snapshot (next product branch)
- `archive/*-wip` — archived dirty worktree contents before cull

Next product work: check out `wip/hub-landing`, rebase onto `master`, open a focused hub/landing PR.
Do not start race-matrix [#23](https://github.com/Aron-Chu/streamclone-pulse/issues/23) until hub WIP is split/shipped or parked.
