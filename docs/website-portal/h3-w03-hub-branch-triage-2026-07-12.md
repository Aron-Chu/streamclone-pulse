# H3-W03 — hub branch triage (2026-07-12)

## Snapshot

- `wip/hub-landing` is **ahead 2 / behind 3** of `origin/master`.
- The two hub commits contain the original Command Center / landing WIP and
  Pages-deploy hardening (185 files, roughly 15.5k additions against master).
- The three incoming `master` commits include the workspace cleanup map plus
  two later portal CI / shell fixes. The current branch must therefore be
  reconciled before it is presented as a focused portal PR.
- The worktree also has 17 dirty paths: 15 modified and two new files.

## Coherent slices

1. **Portal routing, guardrails, and CI** — rules, AGENTS/CONTEXT/runbook,
   requirements/task command corrections, `ci-context-contract.sh`, CI YAML,
   `package.json`, `vite.config.ts`, the worktree rule, and the WIP checkout
   map. This is the smallest independently reviewable slice; it restores the
   hosted-first / local-`:8081` contract and makes overlap/backend URL checks
   part of the portal gate.
2. **Truthful session-tape adapter** —
   `streampulse-web/src/lib/streamcloneAnalytics.ts` plus its focused test.
   Keep it separate: it consumes signal provenance supplied by the
   `@streampulse/analytics-console` dependency, so it must land only alongside
   the compatible backend package/API contract.
3. **Hub product WIP** — the two existing hub commits remain a third, larger
   landing / Command Center slice. Do not mix their visual/product review with
   the policy or session-provenance changes above.

`analyticsConsoleUtils.test.ts` is an orphan in this worktree: it tests a
utility implemented by the linked backend package, not portal source. Move it
with the matching backend-package change or remove it from the portal slice.

## Recommended strategy for Aron

Preserve this worktree unchanged, then create a clean integration worktree from
current `origin/master`. Reapply the three slices above deliberately there:
first the portal routing/CI slice, then the adapter only when its backend
contract is ready, and finally the hub product WIP as its own reviewable PR (or
split it further by landing versus Command Center if review size remains too
large). Resolve the three upstream commits in that clean integration branch;
do not rebase, merge, reset, or overwrite this dirty hub worktree until the
result is verified.

## Checks at triage time

- `npm run check:analytics-overlap` — pass
- `npm run check:backend-url` — pass
- `git diff --check` — pass
- Spot-check: AGENTS, `docs/CONTEXT.md`, the local-dev runbook, and both
  applicable rules identify `:8090` as watch-only and name hosted API / local
  `:8081` as the BFF choices. The old BFF commands in requirements/tasks were
  also changed to `:8081`.
- Caveat: the requirements architecture diagram still calls the upstream
  service “Streamclone analytics backend (Caddy :8090).” Correct that stale
  diagram and AGENTS' old Go-backend router (`twitch-7tv-clone`) in the
  routing/guardrail slice; otherwise the written contract remains internally
  inconsistent.

## D4 merge outcome (2026-07-12)

**Decision D4 (locked):** merge `origin/master` into `wip/hub-landing`.
No rebase. No force-push. No push in this step.

| Item | Result |
|------|--------|
| Merge | **Clean** (ort auto-merge; no conflict markers in the merge commit) |
| Merge commit | `aca53db` — `merge(origin/master): reconcile wip/hub-landing with master (D4)` |
| Files from master | `.github/workflows/ci.yml`, `docs/contributing-wip-split.md` (create), `streampulse-web/package.json` (+1 line) |
| Conflicts resolved | None in the merge itself |
| Post-merge stash restore | Temporary conflict only in `.github/workflows/ci.yml` comment/typecheck while restoring pre-merge dirty WIP; **resolved by keeping merge-HEAD CI** (honest `build:ci`, no portal `typecheck` step that fights linked-package CI) |
| Branch tip vs `origin/master` | **ahead 3 / behind 0** (2 hub commits + 1 merge) |
| Push | **Not done** — push needed later when Aron is ready |

### Validation after merge

- `npm run check:analytics-overlap` — pass
- `npm run check:backend-url` — pass
- `npm run build:ci` — pass
- `git diff --check` — pass

### Notes

- Pre-merge dirty WIP was stashed, merge completed, then stash restored as
  **uncommitted** working-tree changes (not folded into the merge commit).
- `docs/contributing-wip-split.md` working copy restored to the hub role-corrected
  map and updated to say **merge** (D4), not rebase.
- Main `streamclone-pulse` checkout was not touched.
