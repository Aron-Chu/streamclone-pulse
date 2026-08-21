# StreamPulse Release-Readiness — Execution Spec (for OpenCode / Grok 4.6)

> **Executor:** Any agent (Grok 4.6 / Claude Code / Codex). This spec is self-contained: environment preamble + per-task change/verify specs + sequencing + stop-guards.
> **Audit (read this for context):** `docs/website-portal/audits/release-readiness-audit-2026-08-14.md`
> **Feature plan (Phase 5 only):** `docs/superpowers/plans/2026-08-14-channel-analytics-dashboard-upgrade.md`

---

## 0. Environment preamble (DO FIRST)

- **Repos:** `streamclone-pulse` (portal `streampulse-web/` + extension `src/`). Backend `streampulse-backend` + ReplayForge are OUT OF SCOPE unless a task says so.
- **Branch:** `track-b/hub-ux-hygiene` (dirty, 241 files). **Work from a clean worktree of `origin/master` for execution** — do NOT build on the dirty checkout. Command:
  ```bash
  cd /mnt/c/Users/Aron/streamclone-pulse && git fetch origin && git worktree add /mnt/c/Users/Aron/release-worktrees/channel-analytics-release origin/master -b release/readiness-2026-08-14
  ```
- **Node:** v22+. Install: `cd <worktree> && npm ci` (root) + `cd streampulse-web && npm ci`.
- **Dev server** (hosted API): `cd streampulse-web && npm run check:package-cohort && npm run dev` → `127.0.0.1:5174`. Run detached, poll `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5174/` until 200.
- **Guardrails (non-negotiable):**
  - One UI stack per surface — run `npm run check:analytics-overlap` before deploy-adjacent changes.
  - Portal analytics sanitized server-side; never strip client-side.
  - No secrets/host IPs. Commit policy: **Aron-Chu only, no `Co-authored-by:`**.
  - E2E is LOCAL-ONLY — do not add to GitHub Actions.
  - Backend = source of truth; never invent client-side quality/coverage.
- **Test commands:**
  - Portal unit: `cd streampulse-web && npm test` (vitest)
  - Portal typecheck: `npm run typecheck`
  - Portal gate: `npm run check:analytics-overlap`
  - Portal build: `npm run build:ci`
  - E2E: `npx playwright test tests/e2e/<spec>.ts --workers=1` (local-only, `RF_E2E_BROWSER=chrome`)
- **Verify each task's change compiles + relevant tests pass before moving on.** If `npm test` fails due to a pre-existing env issue (esbuild platform binary mismatch in WSL: `@esbuild/linux-x64@0.27.7` vs host `0.28.2`), fix with `npm install --no-save @esbuild/linux-x64@0.28.2` — it's a WSL env repair, not a code change.

---

## 1. Task sequencing (each is independently testable; do in order)

### Phase 1 — Security ship-blockers

#### Task 1: Move beta key out of `localStorage`
- **Change:** `streampulse-web/src/lib/auth.ts` — `STORAGE_KEY = 'sp.betaKey'` is read/written in `localStorage` (lines 1-29). Change to `sessionStorage` (all three: get/set/remove). Keep the same key string so existing sessions work.
- **Why:** H1 — localStorage is readable by any injected script; the key gates clip-queue + operator endpoints (`X-Streamclone-Beta-Key` header on every gated request).
- **Verify:** `npm run typecheck`; `npm test` for auth; manual: set a beta key, reload, confirm it persists in `sessionStorage` (survives SPA nav, not full tab close).

#### Task 2: Gate `?console=1` + `/admin` behind beta key
- **Change:** `streampulse-web/src/routes/analytics/ChannelAnalyticsPage.tsx` (line 20-24) — when `?console=1` and NOT `hasBetaKey()`, render the curated `FigmaChannelView` instead of `ConsoleChannelView` (public users get the curated dashboard, never the operator console). Import `hasBetaKey` from `lib/auth`.
- **Change:** `streampulse-web/src/routes/index.tsx` line 70 — wrap `/admin/*` in `RequireAuth` (already imported at line 3).
- **Verify:** `npm run typecheck`; manual: `/analytics/ohnepixel?console=1` without key → curated view; with key → console. `/admin` without key → redirect to `/analytics`.
- **Note:** The backend must remain authoritative for gated calls; this closes the client-side surface (H2).

#### Task 3: Extension write auth (cross-repo, flag for backend)
- **Change:** `src/background/api.ts` (`pulseRequestHeaders` lines 71-77, `postWatchChannel` 377-386, `fetchAlwaysTracked`/`setAlwaysTracked` 388-410, `postVodHint` 339-375, backfill 282-337) — add a per-install device token to write requests (e.g. `chrome.storage.local` UUID in header `X-Streampulse-Device`), OR require the beta key.
- **Why:** H3 — writes are currently unauthenticated → corpus poisoning + resource abuse.
- **Verify:** typecheck; extension unit tests if any; manual in extension dev.
- **⚠ Cross-repo:** server-side validation/rate limits live in `streampulse-backend` (OUT OF SCOPE here — flag to the backend owner; the audited plan's "authenticated portal actions" is the backend side).

### Phase 2 — Small UX/correctness (safe, high-value)

#### Task 4: Wire Export button (CSV)
- **Change:** `FigmaSessionHeaderStrip.tsx` — the `disabled` Export button (line ~70) becomes a working CSV download of the session's minutes (full rows, not chart-downsampled). Columns: `offset_seconds,chat_count,total_emote_count,seventv_emote_count,viewer_avg,viewer_max,viewer_latest,missing`. LF endings, escape quotes/commas, empty for absent values, safe filename, revoke object URL.
- **Files:** new `streampulse-web/src/lib/sessionCsv.ts` + modify header. Pass `minutes`/`moments` into the header from `FigmaChannelDashboard`.
- **Verify:** `npm test` for a new `sessionCsv` test; manual: click Export → CSV downloads.

#### Task 5: Chart zoom `−` affordance
- **Change:** `FigmaSignalChart.tsx` (~line 315) — allow `−` always (no-op at 1×) or hide both `−`/Reset until zoomed; currently `−` is disabled at default zoom while `+` is enabled (reads as bug, U2).
- **Verify:** `npm test tests/FigmaSignalChart.test.tsx`; manual zoom.

#### Task 6: Chart a11y role
- **Change:** `FigmaSignalChart.tsx` (~line 342) — `role="img"` on the interactive wrapper → `role="application"` (or proper slider pattern) + add "arrow keys select a minute" to the aria-label (U3).
- **Verify:** `npm test tests/FigmaSignalChart.test.tsx`.

#### Task 7: `LiveChannelsMatrix` honest coverage
- **Change:** `LiveChannelsMatrix.tsx` (line 51-65, 109) — replace invented `coveragePercent()` (`synced→100, partial→62, chat_only→44, stats_only→18`) with: use `dataCoveragePct` when present, else an indeterminate/qualitative bar with honest label (U9).
- **Verify:** typecheck; manual render.

#### Task 8: Vocabulary unification
- **Change:** Unify "Emotes / min" (header already done) + "Reaction score" with tooltip across `FigmaChannelDashboard`/`FigmaSessionHeaderStrip`/`FigmaMomentInspector`/`MostReactedMinutesTable` (see audit §Vocabulary). Remove remaining "7TV / min" (already fixed in header).
- **Verify:** typecheck; grep for stale labels.

#### Task 9: VOD id validation
- **Change:** `streampulse-web/src/lib/figmaSessionAnalytics.ts` `buildVodTimestampUrl` (~line 687) — numeric-validate `vodId` (`/^\d{6,20}$/`) before building `https://www.twitch.tv/videos/...` (L2); reuse the console's `buildTwitchVodUrl` if importable.
- **Verify:** `npm test` for the helper.

#### Task 10: Extension popup/options CSP
- **Change:** Add a CSP `<meta>` to `popup/index.html` + `options/index.html` (L4): `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'`.
- **Verify:** typecheck; manual popup render.

### Phase 3 — Cleanup (safe deletions)

#### Task 11: Delete dead code
- **Change:** Delete (verify zero importers first with `grep -rn <name> src/`):
  - `routes/analytics/StreamsHubPlaceholder.tsx` (D2)
  - `ui/components/analytics/TopEmotesPanel.tsx` (D1 — the file; the *inline* one in `FigmaChannelDashboard` stays, rename to `SessionTopEmotesPanel`)
  - `FigmaEmoteSignalBlock.tsx` `FigmaCorpusPipelineBlock`/`FigmaLiveCollectorBlock` (D3)
  - `ui/components/analytics/ChannelAvatar.tsx` (D4)
  - `lib/backendEndpoints.ts`, `lib/health.ts`, `setBetaKey`/`clearBetaKey`/`hash16` from `auth.ts` (D5 — keep `hasBetaKey`)
  - Deprecated exports (D8): `livePulseMomentsFromPublicHub`, `TREND_VS_PRIOR_*`, migrate `useAnalyticsTheme`→`useAnalyticsThemeOptional`, drop `liveActivity` label
  - Dead CSS `.how-chat-reacted*` in `figma-analytics.css` (D9)
- **Verify:** `npm run typecheck` + `npm test` — must stay green after each deletion.

#### Task 12: Gate/remove `/dashboard` + `/admin` placeholder
- **Change:** `/dashboard` is unreachable without a beta-key UI (D6); `/admin` is a placeholder (D7). Decide with owner: **remove** both route blocks + lazy imports, OR ship a beta-key entry point. Default recommendation: remove `/admin` from public SPA; keep `/dashboard` gated behind `RequireAuth` (already is) but add a key-entry UI or accept it's hidden.
- **Verify:** typecheck; routes work.

### Phase 4 — Performance

#### Task 13: Stop `vendor-analytics-console` (312 KB) shipping on `/`
- **Change:** `streampulse-web/vite.config.ts` `manualChunks` (line 161-169) + modulepreload handling — prevent the analytics-console/pulse-charts chunk from being `modulepreload`'d into the entry HTML (only the lazy analytics routes should pull it). Options: exclude it from entry preload (`build.modulePreload.resolveDependencies`), or ensure only lazy chunks import it.
- **Verify:** `npm run build`; check `dist/index.html` has NO `modulepreload` of `vendor-analytics-console`; measure `dist/assets/` sizes.

#### Task 14: React vendor chunk + remove dead config
- **Change:** `vite.config.ts` — add a `react`/`react-dom`/`react-router` vendor manualChunk; remove the dead `recharts|d3-` branch (neither is a dep).
- **Verify:** `npm run build`; entry chunk smaller.

#### Task 15: Slim hub payload (cross-repo flag)
- **Change:** The 183 KB `/v1/public/hub` payload drives a 45s poll (measured). **Client-side:** nothing safe to cut without changing the endpoint. **Flag to backend** (OUT OF SCOPE here): split the poll, add `?since=`, or slim server-side. Client can add `If-None-Match`/ETag on the poll (medium).
- **Verify:** n/a client-side unless ETag added.

#### Task 16: Defer `refreshPrincipal()` on public routes
- **Change:** `streampulse-web/src/main.tsx` (line 58-60) — `refreshPrincipal()` awaited before render blocks first paint. On public paths (landing, `/analytics`), fire it concurrently (not awaited) or after first render.
- **Verify:** `npm run build`; manual load.

### Phase 5 — Feature (the approved upgrade plan)
- **Execute:** `docs/superpowers/plans/2026-08-14-channel-analytics-dashboard-upgrade.md` (Tasks 1-7, date resolution → quality strip → sync CTAs → recap/games/heatmap → export → e2e). This is the fully-specified plan.

### Phase 6 — Release housekeeping
- **Task 17:** Reconcile dirty `streampulse-web/package.json` (font-dep removal — commit or revert).
- **Task 18:** Update `release-notes.json` — set 0.1.0 `released` (with date) or decide 0.2.0 status; add a `0.3.0` unreleased entry for the analytics work. Gate: `node scripts/check-release-notes.mjs` must pass (versions synced).
- **Task 19:** Refresh `release-status.md` (stale since 2026-07-07).
- **Task 20 (cross-repo, flag):** Backend version bump + release note + provenance.

---

## 2. Verification gates (run after each phase, in order)

1. `cd streampulse-web && npm run typecheck`
2. `npm test` (unit)
3. `npm run check:analytics-overlap`
4. `npm run build:ci`
5. Focused e2e: `npx playwright test tests/e2e/analytics-channel-dashboard.spec.ts --workers=1` (if the spec exists) + `npm run test:e2e:audit` (local-only)
6. Manual smoke on `127.0.0.1:5174`: `/`, `/analytics`, `/analytics/{channel}/{date}`, `?console=1`, `/admin`

## 3. Stop-guards (halt + report, don't improvise)

- A baseline failure (worktree of origin/master fails `npm test`/`typecheck` before any change).
- A task's change breaks the gate and can't be fixed in ~2 attempts.
- Any security task touches backend auth/rate-limits (cross-repo — flag, don't invent).
- Any "delete dead code" turns out to have an importer you didn't verify (revert).
- Destructive ops (route removal, cache invalidation, host_permissions trim) that affect production — stop and confirm.

## 4. Handoff / commit

- One commit per logical task (or per phase), **Aron-Chu only, no `Co-authored-by:`**, message prefix per task (e.g. `fix(analytics): ...`, `security(portal): ...`).
- Final report: changed-path summary, each gate's result, the `5174` server state, screenshots (key viewports), remaining blockers.
- Do NOT push, PR, deploy, or modify the Chrome Web Store without explicit go.
