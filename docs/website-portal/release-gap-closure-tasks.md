# StreamPulse Release Gap Closure Tasks

**Status summary:** [`release-status.md`](./release-status.md) · **Commit slices:** [`release-commit-slices.md`](./release-commit-slices.md)

Scope:

- Corpus expansion is out of scope.
- Do not widen Top500, corpus, or backfill behavior.
- Keep the current 250-channel live tracking target.
- Replace broad soak language with focused release stability checks for changed production protections.

## P0 - Release Reproducibility

### TASK-R0-001: Split and Commit the Dirty Worktree Into Reviewable Slices

Owner: repo maintainer / agent

Problem: `streamclone-pulse` has mixed uncommitted WIP: portal performance changes, hub UI refactors, extension overlay changes, docs, generated artifacts, and whitespace noise.

Steps:

- Run `git status --short` in both repos.
- Group changes into separate slices:
  - portal performance/build fixes
  - hub UI refactor
  - extension overlay changes
  - docs/agent boundary changes
  - generated artifacts to ignore/remove
- Do not commit generated artifacts like `dist`, screenshots, `test-results`, `tsconfig.tsbuildinfo`, Playwright reports, or script temp files.
- Fix CRLF/trailing whitespace in `HubCommandHeader.tsx`.
- Run `git diff --check` per slice.

Acceptance:

- Each intended release slice has a clean diff.
- `git diff --check` passes for changed files.
- There is a clear commit/tag candidate for what was tested.

Validation:

```bash
git status --short
git diff --check
```

### TASK-R0-002: Create Promotion Manifest for Current Release Candidate

Owner: ops / release

Problem: Running image identity is drifting: mostly `v0.3.0-rc18`, scraper older, host `VERSION` older, health rc18.

Steps:

- Fill promotion manifest from Streamclone `docs/ops/promotion-manifest.template.md`.
- Record:
  - `IMAGE_TAG`
  - source SHA
  - migration image tag
  - analytics image digest
  - rollback tag
  - known scraper exception, if scraper remains separate
  - smoke evidence
- Confirm health `STREAMCLONE_VERSION` matches intended `IMAGE_TAG`.

Acceptance:

- One manifest describes the deployed artifact.
- Any per-service tag exception is explicit.
- Rollback target is known.

Validation:

```bash
bash scripts/ops/hosted-promotion-reconcile.sh
curl -s https://api.streampulse.stream/v1/extension/health
```

## P0 - Portal Release Gate

### TASK-R0-003: Fix `streampulse-web` TypeScript Build Gate

Owner: frontend

Problem: `npm run typecheck` / `npm run build` fail because Vitest files import sibling package internals via paths TypeScript cannot resolve.

Steps:

- Inspect failing test imports under `streampulse-web/tests`.
- Choose one approach:
  - point tests at configured Vite/TS aliases
  - add stable TS path mappings for sibling package internals
  - exclude test files from production `tsc --noEmit` and add a separate `tsconfig.test.json`
- Prefer separating production build typecheck from test-only internal imports.
- Do not weaken production app typechecking.

Acceptance:

- `npm run typecheck` passes.
- `npm run build` passes.
- `npm test` still passes or has a documented focused failure unrelated to the change.

Validation:

```bash
cd streamclone-pulse/streampulse-web
npm run typecheck
npm run build
npm test
```

### TASK-R0-004: Fix Channel Analytics Setup Race From Performance Optimization

Owner: frontend

Problem: Moving `setupStreamcloneAnalyticsApi()` into parent `useEffect` may race with lazy `<AnalyticsConsole />`.

Steps:

- Move setup into the lazy-loaded channel module synchronously:
  - module top of `ConsoleChannelView.tsx`, or
  - a small lazy bootstrap module that calls setup before rendering console
- Keep setup out of `main.tsx` so the public app entry still avoids pulling analytics-console.

Acceptance:

- `/analytics` entry stays lighter.
- `/analytics/:login` configures analytics API before console queries run.

Validation:

```bash
cd streamclone-pulse/streampulse-web
npm test -- tests/usePublicHubData.test.tsx
npx vite build
```

## P0 - Hot Path Safety

### TASK-R0-005: Bound Redis Memory Safely

Owner: ops/backend

Problem: Redis has no `maxmemory`, `noeviction`, and evidence of millions of rejected connections.

Steps:

- Inspect current Redis memory, keyspace, rejected connections, and client counts.
- Set a conservative `maxmemory` based on available host RAM and observed usage.
- Choose eviction policy intentionally:
  - likely `allkeys-lru` or `volatile-lru`, depending on key TTL discipline
- Confirm critical queues/state are not evicted accidentally.
- Add Redis metrics to post-promotion checklist.

Acceptance:

- Redis has bounded memory.
- Rejected connections stop increasing under normal load.
- Public hub and extension paths still function.

Validation:

```bash
redis-cli INFO memory
redis-cli INFO stats | grep rejected_connections
redis-cli CONFIG GET maxmemory
redis-cli CONFIG GET maxmemory-policy
curl -s https://api.streampulse.stream/v1/public/hub | head -c 500
```

### TASK-R0-006: Add Staged Container Resource Limits

Owner: ops

Problem: Hot services have no memory/CPU/PID limits.

Steps:

- Apply limits one service at a time, not all at once:
  - Redis
  - analytics
  - Postgres
  - Caddy
- Use existing staged limits runbook/fragments.
- After each stage, observe health and memory for at least a short burn-in window.
- Keep rollback command beside each stage.

Acceptance:

- Each hot service has a tested resource cap or a documented reason for deferral.
- No OOM/restart loop occurs.
- Rollback is tested or clearly documented.

Validation:

```bash
docker compose ps
docker stats --no-stream
curl -s https://api.streampulse.stream/v1/extension/health
bash scripts/hosted-launch-probes.sh
```

### TASK-R0-007: Replace Broad Soak With Focused 250-Channel Stability Check

Owner: ops/backend

Problem: A long corpus soak is unnecessary if corpus is on hold, but changed protections still need burn-in.

Steps:

- Define a shorter stability window for current release changes, such as 2 to 6 hours after Redis/container limit changes or one busy traffic window.
- Monitor:
  - Redis rejected connection delta
  - Redis memory/evictions
  - analytics restarts/OOM
  - `/v1/public/hub` latency/error rate
  - extension health
  - Caddy 5xx
- Do not require corpus/backfill expansion.

Acceptance:

- Current 250-channel target remains healthy.
- Rejected connections are not rising.
- No repeated container restarts occur.
- Public hub remains cacheable and responsive.

Validation:

```bash
SOAK_DAY=release-check bash scripts/load/hosted-cap250-soak-monitor.sh --enforce-stop-conditions
docker stats --no-stream
```

## P1 - Public Abuse Surface

### TASK-R1-001: Prove Cloudflare Cache Rule for `/v1/public/hub`

Owner: ops

Problem: Origin headers exist, but edge cache activation is not evidenced.

Steps:

- Enable Cloudflare cache rule for `api.streampulse.stream/v1/public/hub*`.
- Bypass auth/admin headers.
- Repeat `curl -I` within 30 seconds.
- Record `CF-Cache-Status`.

Acceptance:

- Repeated public hub request returns `CF-Cache-Status: HIT` or `REVALIDATED`.
- If `DYNAMIC`, document why and fix the rule.

Validation:

```bash
curl -sI "https://api.streampulse.stream/v1/public/hub?activityWindow=30m" | grep -iE 'cache-control|cf-cache-status|x-cache'
```

### TASK-R1-002: Add Cloudflare Rate Limit/WAF Rule Evidence

Owner: ops

Problem: Public unauthenticated hub can be discovered by bots/search.

Steps:

- Add WAF/rate rule for `/v1/public/*`.
- Keep normal portal polling unaffected.
- Record threshold and action in private ops manifest.
- Add smoke showing normal request still succeeds.

Acceptance:

- Public hub has documented edge abuse protection.
- Normal portal access remains OK.

Validation:

```bash
curl -s https://api.streampulse.stream/v1/public/hub | head -c 500
```

## P1 - Product Release Readiness

### TASK-R1-003: Decide Release Definition

Owner: product/release

Problem: Release can mean public website, hosted API beta, Chrome extension store, or full StreamPulse GA.

Steps:

- Pick one release target:
  - public website only
  - hosted API beta
  - extension beta/store
  - full StreamPulse GA
- Write the gate checklist for that target only.
- Move non-target gates to follow-up.

Acceptance:

- No one blocks website launch on Chrome Web Store work unless GA requires it.
- No one blocks current 250-channel launch on corpus expansion.

### TASK-R1-004: Chrome Web Store / Privacy Final Check

Owner: extension/product

Only required if release includes extension distribution.

Steps:

- Verify listing copy.
- Verify privacy policy.
- Verify extension permissions match actual use.
- Verify hosted API default and local opt-in behavior.
- Build extension after any source change.

Validation:

```bash
cd streamclone-pulse
npm test
npm run build
```

## P2 - Auto Clipper / ReplayForge Beta

### TASK-R2-001: Keep Auto Clipper as Private Beta, Not Release Blocker

Owner: clipper/replayforge

Problem: Auto clipper is close, but not production-complete.

Steps:

- Do not block StreamPulse public site/API release on ReplayForge.
- Track ReplayForge separately:
  - packaging/image
  - private ops service
  - server-side tokens
  - durable artifacts
  - signed playback URLs

Acceptance:

- Release docs clearly say auto clipper is private beta.
- No FFmpeg/render/editor logic is moved back into Streamclone.

### TASK-R2-002: Define ReplayForge Production Artifact Plan

Owner: ReplayForge/ops

Steps:

- Choose packaging:
  - GHCR image
  - private registry image
  - private deploy artifact
- Record source SHA and build command.
- Add health probe for API/UI.
- Keep tokens server-side.

Acceptance:

- ReplayForge can be promoted independently.
- Streamclone calls it through configured server-side URL.

## P3 - Cleanup / Docs

### TASK-R3-001: Update Release Docs to Say Corpus Is Paused

Owner: docs

Steps:

- Add a short note to the relevant launch/readiness doc:
  - corpus expansion is paused
  - current release target is 250 live tracking stability
  - no broad corpus soak required

Acceptance:

- Agents stop treating corpus as the launch gate.

### TASK-R3-002: Add Release Status Summary Doc

Owner: docs/release

Create a short status file with:

- current release target
- in-scope gates
- out-of-scope gates
- current image tag
- manifest link
- rollback tag
- known exceptions

## Recommended Order

1. `TASK-R0-003` portal build gate.
2. `TASK-R0-004` analytics setup race.
3. `TASK-R0-001` split/clean dirty WIP.
4. `TASK-R0-002` promotion manifest / tag drift.
5. `TASK-R0-005` Redis bounds.
6. `TASK-R0-006` staged container limits.
7. `TASK-R1-001` and `TASK-R1-002` Cloudflare cache/rate evidence.
