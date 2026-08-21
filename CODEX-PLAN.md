> SUPERSEDED 2026-08-14 — use docs/superpowers/plans/2026-08-14-channel-analytics-final-plan.md instead. Kept for history.
# StreamPulse Channel Analytics Dashboard — Codex Execution Handoff

> **Executor:** Codex (OpenAI CLI) · **Model config:** `~/.codex/config.toml` (`model = "gpt-5.5"`, `model_reasoning_effort = "high"`)
> **Plan source:** `docs/superpowers/plans/2026-08-14-channel-analytics-dashboard-upgrade.md` (904 lines, complete — read it; this file is the runnable wrapper).
> **Audits:** Appendices A/B/C of the plan are ground-truth endpoint + test + QOL inventories. Trust them over any prose.

## Prerequisites (verify BEFORE starting)

1. **Writable root:** `streamclone-pulse` MUST be in `~/.codex/config.toml` `writable_roots` (it is **not** today — see the note at the bottom; add it or you cannot edit any file).
2. **Portal dev server** on `127.0.0.1:5173` (hosted API). Start detached:
   ```bash
   cd /mnt/c/Users/Aron/streamclone-pulse/streampulse-web
   npm run check:package-cohort   # required — sibling @streampulse/* override
   npm run dev &> /tmp/portal-vite.log &   # expect http://127.0.0.1:5173 (NOT 5174)
   ```
   Poll until `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/` returns 200. Do NOT run vite in the foreground (hangs).
3. **Node v22+**, npm. Confirm `cd streampulse-web && npm run check:package-cohort` passes (dirty sibling source is an expected warning).

## Guardrails (non-negotiable — from repo AGENTS.md + plan Global Constraints)

- **One UI stack per surface.** Never add a second analytics mount. Run `npm run check:analytics-overlap` before any deploy-adjacent change.
- **Portal analytics sanitized server-side** (`/v1/portal/analytics/*`). Never strip client-side.
- **No Twitch OAuth for MVP.** Public `/analytics` is no-login. Clip-queue / sync CTAs gate behind `hasBetaKey()` / `portalBookmarksSupported()` if the hosted endpoints 401 (see Task 3 Step 0).
- **Reuse `@streampulse/analytics-console`** — don't reimplement chart/bucket/scoring.
- **No `?window=full` on default live poll** — full timeline only on explicit session navigation.
- **Backend = source of truth** for peaks/coverage/sync/backfill/quality. Never invent client-side quality.
- **No secrets / host IPs** in committed code.
- **Commit policy: Aron-Chu only — NO `Co-authored-by:` trailers.** Commit messages per `docs/website-portal/release-commit-slices.md`.
- **E2E is LOCAL-ONLY.** Do NOT add portal Playwright to GitHub Actions. Use `RF_E2E_BROWSER=chrome`.

## Execution Model (conservative — this is the "don't blast credits" requirement)

Execute **task-by-task, one at a time, with a verification gate between each**. Do NOT run all 7 tasks in one free-for-all. For each task:
1. Read the task's steps in the plan (Tasks 1-7, lines 139-767).
2. Implement (TDD: write the test → see it fail → implement → see it pass).
3. **Gate:** run the task's verification (unit tests + typecheck). Only proceed to the next task when green.
4. Commit with the plan's exact commit message (each task has one).

**Parallelism only where the plan says** (Tasks 1/2/3 are independent; 4/5/6 depend on 1's fields). If you parallelize, use separate git worktrees per task and merge sequentially — do NOT edit the same files concurrently.

## Task-by-Task (from the plan — do each, in order)

### Task 1 — Date → session resolution + honest date notice
- **Files:** create `streampulse-web/src/lib/sessionDateResolution.ts`, `streampulse-web/src/lib/__tests__/sessionDateResolution.test.ts`; modify `streampulse-web/src/hooks/useChannelPageData.ts`, `streampulse-web/src/routes/analytics/FigmaChannelView.tsx`, `streampulse-web/src/ui/components/analytics/figma-analytics.css`.
- **Full test + code:** in plan lines 154-250. Follow exactly.
- **Verify:** `npx vitest run src/lib/__tests__/sessionDateResolution.test.ts` (5 tests PASS) + `npm run typecheck` clean + manual: `/analytics/ohnepixel/2026-08-14` → live 08-14 session; `/analytics/ohnepixel/2026-08-12` → 08-12 VOD; `/analytics/ohnepixel/2026-01-01` → fallback + notice.
- **Commit:** `fix(analytics): resolve date URLs to sessions with honest fallback notice`

### Task 2 — Per-signal coverage + quality strip
- **Files:** create `streampulse-web/src/lib/channelQuality.ts`, `__tests__/channelQuality.test.ts`, `streampulse-web/src/ui/components/analytics/ChannelQualityStrip.tsx`; modify `FigmaChannelDashboard.tsx`, `figma-analytics.css`.
- **Full test + code:** plan lines 322-420.
- **IMPORTANT:** read the snake_case metric keys exactly (`data_coverage_pct`, `sync_health_state`, `viewer_momentum_5m`) — Appendix A confirmed summary uses snake_case.
- **Verify:** `npx vitest run src/lib/__tests__/channelQuality.test.ts` + typecheck + manual on live vs VOD sessions.
- **Commit:** `feat(analytics): per-signal coverage + analytics quality strip`

### Task 3 — Sync / backfill CTA actions (auth-probe FIRST)
- **Step 0 (MANDATORY):** probe the hosted endpoints before writing code:
  ```bash
  curl -i -X POST "https://api.streampulse.stream/v1/analytics/streams/317482878564/sync?channel=ohnepixel" | head -20
  curl -i -X POST "https://api.streampulse.stream/v1/analytics/streams/317482878564/prefetch-tracker?channel=ohnepixel" | head -20
  ```
  - If **202/200** → call `/v1/analytics/*` directly from `syncStreamActions`.
  - If **401/403** (expected) → gate the CTAs behind `hasBetaKey()` with muted "Available with StreamPulse beta access" fallback; note in PR that a portal wrapper is a backend prerequisite. **Never fire a request that 401s.**
- **Files:** modify `streampulse-web/src/lib/streamcloneAnalytics.ts` (add `syncStreamActions`), create `SessionSyncActions.tsx`, modify `FigmaChannelDashboard.tsx`.
- **Full test + code:** plan lines 462-575 (incl. the new Step 0).
- **Verify:** `npx vitest run src/lib/__tests__/syncStreamActions.test.ts` + typecheck + manual click (button → status).
- **Commit:** `feat(analytics): sync/backfill CTA actions on channel dashboard`

### Task 4 — Stream recap section (top moments, spike, funniest burst, clip candidates)
- **Files:** create `StreamRecapSection.tsx`; modify `FigmaChannelDashboard.tsx`.
- **Use existing:** `fetchPortalStreamRecap` (`streamcloneAnalytics.ts:1139`), `PortalStreamRecapResponse` (incl. `clipCandidates`), `formatStreamOffset` (`:1149`), `buildAnalyticsHref` (`analyticsLinks.ts:10`), `sendClipCandidateToReplayForge` (`clipCandidates.ts:134`), `portalBookmarksSupported` (`streamcloneAnalytics.ts:219`).
- **Gate clip buttons** behind `portalBookmarksSupported()`; when unsupported show "Clip queue available with StreamPulse beta access."
- **Full code outline:** plan lines 579-615.
- **Verify:** unit + manual on the 08-12 VOD (recap with ~245k messages, clips beta-gated).
- **Commit:** `feat(analytics): stream recap section with clip-to-ReplayForge`

### Task 5 — Game segments + heatmap layers
- **Files:** create `SessionGameSegments.tsx`, `SessionHeatmap.tsx`; modify `streamcloneAnalytics.ts` (`fetchPortalStreamGames` using `gamesEndpoint` pattern at `:260`), `figmaSessionAnalytics.ts` (reuse `fetchReplayHeatmapDetail` `:559`), `FigmaChannelDashboard.tsx`.
- **CRITICAL (Appendix A):** heatmap is a **flat `points[]`** (one 60-s bucket: `score`/`reactionScore`/`reason`) — **NO chat/7TV/viewer lanes**; `window` must be **exactly 60** (400 otherwise). Render ONE intensity lane, not 3.
- **Fallback:** `deriveClientGameSegments` (`streamcloneAnalytics.ts:238`) when `/games` returns empty.
- **Full code outline:** plan lines 617-655.
- **Verify:** unit + manual on VOD sessions (games + heatmap present).
- **Commit:** `feat(analytics): game segments + full-stream heatmap on channel dashboard`

### Task 6 — Export CSV, emote-label unification, chart gap/raw fixes
- **Files:** modify `FigmaSessionHeaderStrip.tsx` (wire Export — **replace the disabled button**, fix "vod synced", unify `Emotes / min` label), `FigmaSignalChart.tsx` (gap rendering for `missing` minutes + raw-vs-normalized toggle), `figma-analytics.css`; create `streampulse-web/src/lib/sessionCsv.ts` + test.
- **Full test + code:** plan lines 657-727.
- **Verify:** `npx vitest run src/lib/__tests__/sessionCsv.test.ts` + typecheck + manual: Export downloads CSV; gaps show; Raw toggle flips.
- **Commit:** `feat(analytics): CSV export, chart gaps, raw/normalized toggle, label fixes`

### Task 7 — End-to-end verification, a11y, e2e
- **Files:** create/extend `streampulse-web/tests/e2e/analytics-channel-dashboard.spec.ts` (mock via `installPortalConsoleMock` + `installHubUxMock` — Appendix B; assert date resolution, quality strip, sync POST, recap, games, export download, no console errors). Add arrow-key handling to session strip tabs (a11y).
- **Run:** `npx playwright test tests/e2e/analytics-channel-dashboard.spec.ts --workers=1` then `npm run test:e2e:audit` (LOCAL-ONLY).
- **Full verification:** `npm run check:analytics-overlap` → `npm run typecheck` → `npx vitest run` → `npm run test:e2e:audit`. Manual smoke on date URLs, live, VOD, empty, `?console=1`.
- **Commit:** `test(analytics): e2e for date resolution, quality, sync CTAs, recap, export`

## Final Verification Checklist (before you report done)

- [ ] `npm run check:analytics-overlap` passes (no new duplicate stack)
- [ ] `npm run typecheck` passes
- [ ] `npx vitest run` passes (all unit tests)
- [ ] `npm run test:e2e:audit` passes (local-only)
- [ ] `git log --oneline` shows the 7 task commits, **Aron-Chu only, no `Co-authored-by:`**
- [ ] Manual: date URLs resolve + notice; quality strip; sync CTAs (or beta-gated); recap; games; heatmap; export; chart gaps; raw toggle; `?console=1` still works

## Known Limitations / Gaps (be honest about these in your final report)

- **Sync endpoints are NOT under `/v1/portal`** and may 401 for public no-login (Task 3 Step 0 decides). If gated, the CTAs are beta-gated — that's the correct outcome, not a failure.
- **No export endpoint** — CSV is client-side by design.
- **Heatmap is flat points** (no lanes) — render one intensity lane.
- **Clip handoff backend** (`GET /v1/pulse/clips/{id}` + import) is still "code on branch — merge + hosted smoke pending" (Appendix C). Gate any "Send to ReplayForge" UI until that lands.
- **Do NOT reorder sections / rename `Figma*` / change layout contracts** (Appendix C) — the Figma Make file wins on `/analytics`.

## Writable-root note (REQUIRED for Codex to edit)

`streamclone-pulse` is **not** currently in `~/.codex/config.toml` `writable_roots`. Before running, add it (the operator — or you, if running in a sandbox with config access — must apply this):

```toml
writable_roots = [
  "/mnt/c/Users/Aron/twitch-7tv-clone",
  "/mnt/c/users/aron/twitch-7tv-clone",
  "/mnt/c/Users/Aron/streamclone",
  "/mnt/c/Users/Aron/streamclone-pulse",   # ADD THIS
  "/mnt/c/NEW/cert",
  "/home/aron/idleon-roblox"
]
```

Without this, Codex's `workspace-write` sandbox will refuse every edit in this repo.
