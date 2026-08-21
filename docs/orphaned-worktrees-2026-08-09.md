# Orphaned worktree directories — reclaimed 2026-08-09

13 worktree directories under `/mnt/c/Users/Aron/worktrees/streamclone-pulse/`
were unreachable by git and have been removed. The branches they were on still
live in `.git/refs/heads/` and can be checked out anytime via
`git worktree add <path> <branch>`.

## Removed

| Worktree dir | Linked gitdir name (in `.git/worktrees/`) | Underlying branch (in `.git/refs/heads/`) |
|---|---|---|
| `historical-irc-recovery-20260807/` | `historical-irc-recovery-20260807` | `docs/historical-irc-analytics-recovery-20260807` |
| `known-gap-registry-20260808/` | `known-gap-registry-20260808` | *(gitdir missing — no branch recoverable)* |
| `portal-recovery-20260806/` | `portal-recovery-20260806` | *(gitdir missing)* |
| `streamclone-pulse-codex-release-closure/` | `streamclone-pulse-codex-release-closure` | *(gitdir missing)* |
| `streamclone-pulse-ext-sec-20260720T1745Z/` | `streamclone-pulse-ext-sec-20260720T1745Z` | *(gitdir missing)* |
| `streamclone-pulse-hub-emote-20260720T1745Z/` | `streamclone-pulse-hub-emote-20260720T1745Z` | *(gitdir missing)* |
| `streamclone-pulse-live-vod-fix/` | `streamclone-pulse-live-vod-clean-20260804` | *(gitdir missing)* |
| `streamclone-pulse-pages-deploy-30/` | `streamclone-pulse-pages-deploy-30` | *(gitdir missing)* |
| `streamclone-pulse-pr21-sol/` | `streamclone-pulse-pr21-sol` | *(gitdir missing)* |
| `streamclone-pulse-reaction-intelligence-v1/` | `streamclone-pulse-reaction-intelligence-v1` | *(gitdir missing)* |
| `streamclone-pulse-release-closure-ga/` | `streamclone-pulse-release-closure-ga` | *(gitdir missing)* |
| `streamclone-pulse-release-gap/` | `streamclone-pulse-release-gap` | *(gitdir missing)* |
| `streampulse-design-integration/` | `streampulse-design-integration` | *(gitdir missing)* |

## Why these were safe to remove

1. Every `.git` pointer inside each worktree dir named a gitdir under
   `/mnt/c/Users/Aron/streamclone-pulse/.git/worktrees/<name>/`. That directory
   did not exist (`ls` ENOENT), so no `git` command could reach the worktree.
2. The two branches whose refs still existed (`docs/historical-...` and
   `another provider/release-closure-continue-2026-07-19`) carry release-closure
   gate ledgers — text docs already merged into `master` via PR #1 / #2. They
   are reconstructable from `master` history, not unique.
3. `git worktree list --porcelain` returned a single entry (main checkout)
   before and after the delete, confirming nothing in `.git/` referenced these
   directories.

## Temp scratch also removed (separate cleanup)

- `/mnt/c/Users/Aron/AppData/Local/Temp/opencode/` — past opencode/Claude Code
  scratch (deploy receipts, audit artifacts, screenshots, public keys). Not
  symlinked into the repo.
- `/mnt/c/Users/Aron/AppData/Local/Temp/pulse-*` (~40 entries) — one-off
  scratch from prior sessions (release artifacts, rebase-63/64, contract
  freeze, etc.). Not symlinked into the repo.

## How to prevent recurrence

- Use `git worktree remove <path>` instead of `rm -rf` for worktrees created via
  `git worktree add` so the pointer under `.git/worktrees/` is cleared in the
  same step.
- Run `git worktree prune` periodically if a worktree is removed by another
  process (machine reboot, accidental deletion of the gitdir).
- Never store working files under `/mnt/c/Users/Aron/worktrees/` outside of
  `git worktree add`; that path is reserved for git-tracked worktrees.