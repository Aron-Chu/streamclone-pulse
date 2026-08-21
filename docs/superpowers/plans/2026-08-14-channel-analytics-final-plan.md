# Channel Analytics Dashboard Upgrade — Final Auto-Agent Plan

## Summary

Proceed as a long, sequential cross-repository implementation from fresh `origin/master` worktrees.

Two audit clarifications are now locked:

- `npm run test:packages` is valid on frontend `origin/master` (`546a3029…`). It tests the in-repo `packages/*`, including `@streampulse/analytics-console`. The backend's `origin/master` has no `packages/analytics-console`, so substituting a backend package test would reintroduce the stale package-cohort problem.
- Windows Codex uses `C:\Users\Aron\.codex\config.toml`, already configured for `gpt-5.6-luna` with `max` reasoning. Keep that setting and make no global configuration changes. Leave the irrelevant WSL configuration untouched. Official guidance reserves `max` for demanding quality-first work; the user has selected that tradeoff for this run.

The original dirty worktrees, 904-line plan, and `CODEX-PLAN.md` remain read-only references. This replacement plan is authoritative.

## 1. Clean Execution Environment

- Fetch `origin` in both repositories and record the exact baseline SHAs.
- Create only if still unused:
  - Frontend: `C:\Users\Aron\release-worktrees\channel-analytics-dashboard-upgrade`
  - Branch: `codex/channel-analytics-dashboard-upgrade`
  - Backend: `C:\Users\Aron\release-worktrees\channel-analytics-backend`
  - Branch: `codex/channel-analytics-actions`
- Base both worktrees on the newly fetched `origin/master`.
- Use only `streamclone-pulse/packages/*`; never link to sibling backend packages.
- Do not alter existing dirty checkouts, the chart-parity worktree, global Codex configuration, or WSL configuration.
- Execute stages sequentially. Report progress after backend completion and portal foundation completion, but continue automatically while gates pass.
- Stop immediately for baseline failures, unexpected existing target branches/paths, schema ambiguity, destructive operations, or required scope expansion.

Install and establish baselines:

- Run `npm ci` in the frontend root and `streampulse-web`.
- Run the frontend root `npm run test:packages`, root typecheck, and focused portal tests.
- Run `go test ./internal/analytics/...` in the backend.
- Record any pre-existing master failure before editing.

## 2. Secure Backend Portal Actions

Add these authenticated interfaces without changing database schemas or existing GET response bodies:

```http
POST /v1/portal/analytics/streams/{streamId}/sync
Content-Type: application/json

{"login":"ohnepixel","vodId":"optional"}
```

```http
POST /v1/portal/analytics/streams/{streamId}/prefetch-tracker
Content-Type: application/json

{"login":"ohnepixel"}
```

Return only:

```json
{
  "action": "upgrade",
  "accepted": true,
  "phase": "starting",
  "message": "Historical sync requested.",
  "updatedAt": "2026-08-14T17:00:00Z"
}
```

Rules:

- Hosted access requires `pulseHostedAuthMiddleware`, a non-guest beta/device/user principal, `requirePulseWrite`, and existing rate limits.
- Reuse the backfill limit for full sync and watch limit for viewer prefetch.
- Load the exact stream row and verify the normalized login before dispatch.
- Return stable errors: `invalid_body`, `invalid_channel`, `stream_not_found`, `stream_login_mismatch`, `sync_unavailable`, `rate_limited`, `read_only_mode`, `unauthorized`, or `request_failed`.
- Return `404` for no stream and `409` for identity mismatch.
- Full sync calls `TryStartSync` with full-history options. Viewer refresh calls `PrefetchTracker`.
- Return `202` when queued and `200` when already active or skipped.
- Never expose raw Redis, scraper, archive, or sync errors.
- Preserve the existing `/v1/analytics/...` routes as operator-only.
- Extend central post-write invalidation to clear portal summary, minutes, provisional minutes, peaks, coverage-truth, games, and heatmap caches for the stream.

Continue using the existing authenticated backfill route:

```http
POST /v1/extension/pulse/channels/{login}/backfill

{"streamId":"…","vodId":"optional","mode":"missed"}
```

Backend tests must cover guest rejection, beta access, local mode, validation, identity mismatch, read-only mode, service absence, rate limiting, response sanitization, and cache invalidation. Never probe hosted mutations during implementation.

## 3. Portal Data and Routing Foundation

- Recognize only valid `YYYY-MM-DD` route parameters as date slugs.
- Match against the UTC calendar date of `startedAt`.
- For duplicate dates, prefer an open/live stream, otherwise the latest `startedAt`.
- Preserve non-date stream IDs exactly, even when absent from the recent-session response.
- When a date is missing, select the normal live/recent fallback and expose `date_not_found`.
- When no sessions exist, expose `no_sessions`.
- Do not redirect date URLs.
- Keep complete sanitized minute rows in the session view model for export and factual coverage. Keep downsampled chart points separate.
- Load detail, summary, coverage truth, minutes, recap, games, and flat heatmap data once per selected stream. Cancel stale requests after navigation.

Add exact frontend types for backend `analyticsQuality`, `viewerSource`, data-source badges, stored-artifact state, availability, full minute fields, games, recap, and flat heatmap points.

Place all tests under `streampulse-web/tests/`; do not create source-tree `__tests__` folders.

## 4. Dashboard Features

### Trust and quality

- Map backend `analyticsQuality` through the existing analytics-console quality utility.
- Use a coarse client fallback only when the backend omits quality.
- Show backend overall `data_coverage_pct`.
- Show chat replay state/message, viewer sample count and source, total emotes/min, separate 7TV/min, and VOD state.
- Use `emotes_per_min` for "Emotes/min"; never relabel `seventv_per_min` as total emotes.
- Never convert rates into percentages or fabricate signal coverage.

### Authenticated data actions

- Upgrade calls the new portal sync endpoint.
- Refresh viewer chart calls the new portal prefetch endpoint.
- Load missed moments calls the existing extension backfill endpoint with its required body.
- All calls use `gated: true`.
- Without a beta key, display availability copy and issue no request.
- Poll sync/backfill every two seconds for at most two minutes, stop on terminal status or navigation, and refresh dashboard data afterward.
- Viewer prefetch performs one delayed refresh.
- Copy says requested, queued, running, completed, or failed based only on backend state.

### Dashboard order

Render one analytics stack in this order:

1. Channel heading and date notice.
2. Session tabs.
3. Session summary header.
4. Quality strip and data actions.
5. Games Played.
6. Four-signal chart.
7. Compact replay heatmap.
8. Stream recap.
9. Existing metrics/moments/inspector/emotes grid.

### Games Played

- Render compact portrait artwork/icons immediately above the graph—no orange text boxes.
- Artwork order: normalized backend `boxArtUrl`, deterministic category-ID CDN URL, then initials.
- Hide failed images, cache failed candidates, and never render a broken-image placeholder.
- Hover/focus previews the segment.
- Click pins/unpins its graph range without replacing the selected moment.
- Keep first and last games keyboard- and touch-reachable in horizontally constrained layouts.
- If the backend supplies no segments, show "Game segments unavailable"; do not invent a full-session game.

### Heatmap

- Request `window=60&detail=false`.
- Consume the actual flat `points[]` response.
- Render one compact score-intensity lane.
- Do not invent viewer/chat/emote lanes.
- Omit the panel when no points exist.

### Recap and ReplayForge

- Render backend totals, top moments, biggest chat spike, funniest emote burst, and recap clip moments.
- Treat recap clip moments as read-only because they do not contain candidate IDs.
- With beta access, fetch stored clip candidates and match only a unique candidate with identical stream ID, exact offset, and first reason.
- Never derive candidate IDs client-side.
- Show ReplayForge controls only for a real candidate passing `clipCandidateCanQueueReplayForge`.
- Ambiguous, missing, source-unavailable, or unrenderable candidates receive honest status copy.
- Preserve "worker ready—playback unverified" wording.

### Export, graph, and accessibility

- Export complete minute rows, never downsampled chart points.
- CSV columns:

```text
offset_seconds,chat_count,total_emote_count,seventv_emote_count,viewer_avg,viewer_max,viewer_latest,missing
```

- Use LF endings, escaped fields, empty absent values, safe filenames, and revoked object URLs.
- Add `missing` to chart points and split all four signal paths at missing ranges.
- Preserve past/future layers for viewer, chat, emote, and heat series.
- Tooltips always show raw units.
- `Normalized / Raw values` changes labels, readouts, and maxima—not mathematically identical geometry. Persist the choice safely in `sessionStorage`.
- Replace hardcoded "vod synced" with backend-derived `live tracking`, `VOD ready`, or `No VOD linked`.
- Use roving session-tab focus with ArrowLeft, ArrowRight, Home, and End.
- New controls require visible focus, text states in addition to color, headings, adequate touch targets, and polite live regions.

## 5. Tests and Verification

Update existing mock helpers rather than creating another mocking stack. Fixtures must match hosted contracts:

- Summary has `metrics` and `analyticsQuality`.
- Recap uses `topMoments` and ID-less `clipCandidates`.
- Games is a plain array.
- Heatmap contains flat `points`.
- Minutes contain actual sanitized minute fields.

Required unit coverage:

- Date resolution and legacy stream IDs.
- Quality mapping with no invented values.
- Exact action paths, bodies, gating, errors, and polling cancellation.
- Clip-candidate matching and queueability.
- Game art fallback/cache, pinning, and ordering.
- Heatmap shape.
- Full-row CSV output and escaping.
- Missing-range path segmentation and all four future layers.
- Raw-value preference.
- Session-tab keyboard navigation.

Run in order:

1. Backend: `go test ./internal/analytics/...`.
2. Focused package work: `npm run test -w @streampulse/analytics-console`.
3. Frontend package cohort: root `npm run test:packages`.
4. Frontend root: `npm run typecheck`, `npm test`, `npm run build`, `npm run check:bundle-budget`, `npm run check:public-source-readiness`.
5. Portal: `npm run typecheck`, `npm test`, `npm run check:analytics-overlap`, `npm run build:ci`.
6. Focused E2E: `npx playwright test tests/e2e/analytics-channel-dashboard.spec.ts --workers=1`.
7. Existing portal mocked E2E: `npm run test:e2e:mocked`.

Responsive E2E viewports:

- `360×800`
- `390×844`
- `844×390`
- `1024×768`
- `1280×720`
- `1440×900`
- `1920×1080`

Assert no horizontal overflow, Games Played precedes the graph, edge controls remain reachable, pin/hover states remain visible, downloads work, keyboard navigation works, and there are no console errors.

For final UI verification:

- Inspect the exact PID and command line currently owning `5174`.
- Stop only the previous worktree's server.
- Start `127.0.0.1:5174` from the new frontend worktree.
- Smoke date, live, VOD, empty, and `?console=1` routes.
- Use mocked Playwright for mutations. Hosted verification remains GET-only until backend deployment.

## 6. Commits and Handoff

After every cross-repo gate passes:

- Review `git status --short`, intended paths, and `git diff --check`.
- Create one local commit per repository:
  - Backend: `feat(analytics): add authenticated portal data actions`
  - Frontend: `feat(analytics): upgrade channel session dashboard`
- Author and committer: `Aron-Chu <aroncloudchu@gmail.com>`.
- No co-author trailer.
- Do not change global Git configuration.
- Do not push, create a PR, deploy, package CWS artifacts, or upload anything.

Final report must include baseline SHAs, commit SHAs, changed paths, validation results, responsive screenshots, the active `5174` PID/worktree, and unresolved blockers.

## Assumptions

- The executor is Windows Codex using Luna/max; no configuration edits are required.
- The WSL writable-root edit is harmless but irrelevant and remains untouched.
- Portal and backend actions are in scope. Extension UI, VOD `2844403169`, deployment, CWS, and ReplayForge backend changes are excluded.
- Backend deployment must precede frontend production release because hosted portal actions do not exist yet.
- Existing dirty worktrees and planning documents remain untouched.

## 7. Backend Addendum — Extension Write Auth (H3, from security audit)

In addition to the portal action wrappers, address the security audit's **H3**: extension backend write endpoints are currently unauthenticated.

- **Endpoints** (in `streampulse-backend/internal/analytics/`): `POST /v1/analytics/channels/{login}/watch`, `POST /v1/analytics/always-tracked`, `POST /v1/analytics/streams/{streamID}/backfill`, `POST /v1/analytics/streams/{streamID}/vod-hint`, `POST /v1/analytics/streams/{streamID}/prefetch-tracker`, `POST /v1/analytics/streams/{streamID}/sync`.
- **Goal:** require a per-install device token (or beta key) on write endpoints; add server-side rate limits + validation (esp. `always-tracked` mutations) to prevent corpus poisoning + resource-cost abuse.
- **Client** (`streamclone-pulse/src/background/api.ts:71-77,282-410`): add an `X-Streampulse-Device` header from a `chrome.storage.local` UUID (or the beta key) to write requests.
- **Tests:** guest rejection, missing/invalid device token, rate limiting, and that read endpoints stay unauthenticated.
- This is the backend half of the release-security fix; the portal action wrappers (§2) and this addendum together close H3.

## 8. Reference files

- Read-only audit (context): `docs/website-portal/audits/release-readiness-audit-2026-08-14.md`
- Read-only execution spec (Phases 1-6 incl. security H1/H2, UX, cleanup, perf, housekeeping): `docs/website-portal/audits/EXECUTION-SPEC-2026-08-14.md`
- Superseded draft (do not use): `CODEX-PLAN.md`
