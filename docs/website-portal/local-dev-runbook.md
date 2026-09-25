# StreamPulse portal — local dev runbook (hosted-first)

After launch hardening (2026-07), portal dev defaults to the **hosted production API** — not a local stack. Use this checklist before `/analytics` work, hub QA, or portal screenshots.

## Which checkout

`wip/hub-landing` merged in [PR #25](https://github.com/Aron-Chu/streamclone-pulse/pull/25). Use the main `streamclone-pulse` checkout for portal and extension.

```bash
cd streampulse-web
npm install   # after branch switch or @streampulse/* changes
npm run dev   # or npm run dev:hosted
```

See [`docs/contributing-wip-split.md`](../contributing-wip-split.md).

## Prerequisites

1. In-repo `@streampulse/*` packages under `packages/*` (RPR-6). No sibling private checkout is required for package resolution. Optional: sibling **streampulse-backend** only when debugging a local BFF on `:8081`.
2. From `streampulse-web/`:

```bash
npm install
```

Re-run `npm install` after pulling portal or in-repo `packages/*` changes. Run
`npm run build:packages` from the repo root (or `npm run build:packages` in
`streampulse-web`, which calls root `ensure:packages`) so `dist/` exists.

3. Portal Vite must alias landing extension UI: `@pulse-ext/ui` → repo-root `src/ui`, plus `extensionUiShimsPlugin` in `streampulse-web/vite.config.ts`. Without that, `/` and `/analytics` both fail module resolve (Landing is eagerly imported in the router). Hosted API is unrelated to that failure.

Public **Streamclone** (`../../twitch-7tv-clone`, `:8090`) is the desktop watch stack only — **not** extension/portal BFF after boundary split.

### Optional exact-moment watch handoff

`VITE_STREAMCLONE_WATCH_ORIGIN` opts a portal build into **Review in Streamclone**.
Leave it unset unless the intended watch service is available. It is separate
from `VITE_BACKEND_URL`: never send Pulse API requests to the watch app.

For an explicitly local session, pass `http://127.0.0.1:8090` in the starting
process environment. Local watch links are allowed only when the portal itself
is on loopback, and only to the watch boundary port8090. A public portal rejects
a loopback target even if that target was accidentally included at build time.
A hosted target must be a configured HTTPS origin without a path, credentials,
query or fragment. No environment file is required or changed by the test run.

The action appears only after the selected source check returns an exact VOD
and aligned timestamp. The link carries public VOD/stream identity and archive
offset, not credentials or a publish instruction. Saved items recheck their
source; they do not persist watch URLs or source authorization. Native Twitch
clipping is a separate disabled-by-default watch feature requiring its own
server permission checks and an explicit publication confirmation.

The opt-in two-app browser check uses `playwright.watch-handoff.config.ts`.
Build the watch frontend normally. Build a separate portal acceptance artifact
with `VITE_STREAMCLONE_WATCH_ORIGIN=http://127.0.0.1:8090` and
`npx vite build --outDir node_modules/.cache/pulse-watch-handoff-preview`.
Serve that artifact on an unused loopback port with strict-port behavior;
serve the built watch app on8090 only if the port is unoccupied. These are
isolated frontend previews, not a running Caddy/backend/media stack.

Set `PLAYWRIGHT_BASE_URL` to the isolated portal preview and
`WATCH_HANDOFF_TARGET_ORIGIN=http://127.0.0.1:8090`, then run:

```text
npx playwright test --config playwright.watch-handoff.config.ts
```

The tests load both real built applications, intercept service/media requests,
and stop before publication. They cover second/third updates, signed archive
alignment, Saved source revalidation and unavailable sources, plus the watch
review dialog at390/768/1440px. This proves UI/HTTP-contract integration, not
Twitch playback, OAuth rights, Redis durability or actual clip publication.
Never kill an occupying service or change account permissions to run this test.

## Default dev (hosted API)

```bash
cd streampulse-web
npm run dev
# or: npm run dev:hosted
```

| Item | Value |
|------|-------|
| Vite URL | `http://127.0.0.1:5173` |
| Backend | `https://api.streampulse.stream` |
| Hub poll | 45s default (`VITE_PUBLIC_HUB_POLL_MS`) |

No beta key required for `/analytics`. No local Docker stack required.

## Account routes

Account pages use same-origin `/v1/account/*` (and billing uses `/v1/billing/*`),
independently of the analytics backend override. Vite proxies `/v1` to the local
Pulse BFF on port 8081 and preserves Host and Origin. Without that BFF, account
requests fail locally; an analytics fixture or hosted analytics connection does
not provide an account session.

`npm run test:account-routing` checks the real Vite routing configuration using
an isolated loopback HTTP fixture on ephemeral ports. It verifies account SPA
deep links and API status/body/header forwarding without secrets or email.
`npx playwright test tests/e2e/account-flow.spec.ts --workers=1` separately checks
the account UI with intercepted API responses. Neither proves a real login:
the backend requires its configured HTTPS account origin and secure cookies,
plus account storage and email delivery. Do not relax those protections for
plain-HTTP local development.

## Opt-in local StreamPulse backend

Only when explicitly debugging Go BFF / local analytics:

1. Copy `streampulse-web/.env.development.localhost.example` → `.env.development.localhost`.
2. **Must include** `VITE_ALLOW_LOCAL_BACKEND=1` — without it, localhost `VITE_BACKEND_URL` is ignored.
3. In **streampulse-backend** checkout: `make up` (TODO — compose Caddy `:8081` → analytics `:8080`).
4. Rebuild/restart local **analytics** if `/v1/public/hub` returns 404 (extension health may work while hub route does not).
5. Run:

```bash
npm run dev:local
```

Default local URL: `http://localhost:8081` (streampulse-backend). Do **not** point portal local dev at Streamclone `:8090`.

Expect a tiny IRC pool and different hub data vs production. `HubBackendSourceBanner` warns when not on hosted.

## Viewing stored-day analytics while `/v1/public/discovery` is 503

The hosted API currently answers `503 {"error":"discovery_unavailable"}` for
`/v1/public/discovery` and `/v1/public/discovery/activity`. With the hosted default that leaves the
activity calendar with **no day cells**, and the broadcast-grouped stored day never renders at all —
the portal is behaving correctly and refusing to invent measurements.

`scripts/dev-discovery-fixture.mjs` serves just those two endpoints from a deterministic fixture and
**passes every other `/v1/*` request through to the hosted API**, so the hub, Live Wire, newsroom and
channel analytics keep showing real data in the same session.

Two terminals, from `streampulse-web/`:

```bash
npm run dev:fixtures
```

```bash
VITE_ALLOW_LOCAL_BACKEND=1 npm run dev
```

Then point the portal at the shim. Easiest is the dev-only `?spBackend=` parameter — open this once
and it stores the override for the session, then removes itself from the URL:

```
http://127.0.0.1:5173/analytics/moments?collection=history&month=2026-09&creator=casson&day=2026-09-03&spBackend=http://127.0.0.1:8099
```

Equivalent, if you prefer the console:

```js
sessionStorage.setItem('sp.backendUrlOverride', 'http://127.0.0.1:8099'); location.reload()
```

Reference URLs once it is up:

- `http://127.0.0.1:5173/analytics/moments?collection=history&month=2026-09&creator=casson&day=2026-09-03`
  — 136 detections across two distinct broadcasts, each capped at the backend's top 20 with the rest
  behind one disclosure.
- Same URL without `&day=…`, then **Year overview** — the shared cyan intensity legend in both modes.

The fixture creator is **`casson`** and its first broadcast is the real stream `315982311249`, so
`/streams/:id/recap` answers through the shim's passthrough and the list shows a genuine server
ranking (`#1…#N`, plus the clip-candidate chip). The second broadcast is synthetic, which is what
exercises the honest *"No ranking was returned for this broadcast"* fallback in the same view.
Requesting a different `creator=` still returns items — the fixture echoes the requested login — but
the ranking is then correctly refused, because a recap belongs to one creator's stream.

Notes:

- `VITE_ALLOW_LOCAL_BACKEND=1` is mandatory. Without it `getBackendUrlOverride()` refuses a localhost
  override *and* `clearStaleLocalBackendOverride()` (called from `src/main.tsx` on every dev start)
  removes it before the first request.
- `?spBackend=` is compiled out of production builds (`import.meta.env.DEV`) and still routes through
  `setBackendUrlOverride()`, which enforces the same opt-in.
- The dev CSP must allow the shim origin. `devConnectSrcPlugin` in `vite.config.ts` adds the fixture
  port to `connect-src` (default `8099`, overridable with `SP_FIXTURE_PORT`, which the shim and the
  CSP both read). Without that the browser blocks the fetch and the page shows the 503 copy as if
  nothing changed.
- Port `8099` is deliberate: `8081` is the local BFF, `8090` Streamclone watch, `8095`/`8096`
  ReplayForge, `5173`/`5174` portal.
- Fixture data is **dev-only** — the override returns `null` in PROD and the shim is a script that is
  never bundled. `tests/e2e/dev-fixture-shim.spec.ts` asserts this whole path still works.
- Change the fixture in one place: `scripts/fixtures/discoveryFixture.mjs`, which the Playwright
  helper imports too, so what you browse is what CI asserts.
- The shim also serves the UI mockups at **`http://127.0.0.1:8099/mockups/`** (read-only, path-escape
  rejected). They live in `streampulse-sdlc/artifacts/ui-audit-2026-09-11/mockups/` — outside this
  repo, so they never ship with the app — and are self-contained, so they also open over `file://`.
  Override the directory with `SP_MOCKUP_DIR`.

## What the code enforces

| Mechanism | Effect |
|-----------|--------|
| [`scripts/dev-portal.mjs`](../../scripts/dev-portal.mjs) | Strips `localhost` / `:8081` from `VITE_BACKEND_URL` when starting default `npm run dev` |
| [`src/lib/auth.ts`](../../streampulse-web/src/lib/auth.ts) `resolvePortalDefaultBackendUrl()` | Ignores localhost env unless `VITE_ALLOW_LOCAL_BACKEND=1` |
| [`src/main.tsx`](../../streampulse-web/src/main.tsx) `clearStaleLocalBackendOverride()` | Removes stale `sessionStorage.sp.backendUrlOverride` pointing at local backend on boot |
| [`src/hooks/usePublicHubData.ts`](../../streampulse-web/src/hooks/usePublicHubData.ts) | Default poll 45s — do not lower without evidence (see fanout doc) |

### Backend resolution flow

```mermaid
flowchart TD
  start[npm run dev] --> devPortal[dev-portal.mjs]
  devPortal --> stripLocal{localhost in VITE_BACKEND_URL?}
  stripLocal -->|yes| drop[Strip from process env]
  stripLocal -->|no| vite[Vite on :5173]
  drop --> vite
  vite --> boot[main.tsx bootstrap]
  boot --> clearOverride[clearStaleLocalBackendOverride]
  clearOverride --> resolve[resolvePortalDefaultBackendUrl]
  resolve --> hosted[api.streampulse.stream]
  devLocal[npm run dev:local] --> allowFlag{VITE_ALLOW_LOCAL_BACKEND=1}
  allowFlag -->|yes| local8081[localhost:8081 streampulse-backend]
  allowFlag -->|no| hosted
```

## Scalability guardrails

- Portal QA and hub screenshots should use **hosted** API unless the task explicitly says local-backend debugging.
- Hub poll cadence: see [hub-fanout-edge-cache.md](./hub-fanout-edge-cache.md) — browser default 45s, backend Redis TTL ~30s, origin `Cache-Control` on `/v1/public/hub`.
- Do not point portal dev at Streamclone `:8090` for “representative” production hub/moment/emote checks.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/analytics` hangs on “Loading…” 30s+ (dev) | Cold Vite compile of lazy hub chunk; or `localhost` IPv6 stall | Use **`http://127.0.0.1:5173/analytics`**; wait for Vite terminal to finish first compile; hard refresh |
| Blank black page, empty `#root` | Stale Vite on `:5173` after long session or git rebase | Kill process on port 5173, restart `npm run dev`, hard refresh (Ctrl+Shift+R) |
| Port 5173 serves old bundle | Stale dev server or wrong checkout | Confirm the serving process cwd is `streamclone-pulse/streampulse-web`; preserve the current branch/dirty work and restart only the identified portal process. The hub worktree is retired. |
| Looks like “old” Command Center | Stale cache or a different checkout | Verify process cwd and loaded source before changing branches; see **Which checkout** above. |
| Module / `@streampulse/*` errors | Missing `npm install` or package `dist/` | `npm install` in `streampulse-web`; `npm run build:packages` from repo root (`packages/*/dist`) |
| `tsc` reports missing `getStreamStatus` (or any new API) in `streamcloneAnalytics.ts` even though source defines it | `streampulse-web/node_modules/@streampulse/*` symlinks point to a sibling checkout (e.g. `../streampulse-backend/packages/*`) that was patched for local testing and never restored | `readlink streampulse-web/node_modules/@streampulse/analytics-console` — if it points outside this repo, `rm` it and re-run `npm install`; CI does `npm ci` so it is unaffected |
| Hub empty but page renders | Off-peak live pool or wrong backend | Confirm hosted hub: `curl -sI https://api.streampulse.stream/v1/public/hub` |
| Unexpected local backend | Session override or env | DevTools → Application → `sessionStorage.sp.backendUrlOverride`; check `.env.development.local*` |
| `dev:local` still hits hosted | Missing `VITE_ALLOW_LOCAL_BACKEND=1` | Update `.env.development.localhost` from example |
| Local hub 404 | Old analytics image or wrong stack | Use **streampulse-backend** compose; curl `http://localhost:8081/v1/public/hub` |
| Duplicate Pulse Moments + Top Moments on session page | Both panels mounted in `analytics-console` | Pull latest; restart dev; run `npm install` + `npm run build:packages` after package edits |
| Session VOD link points at wrong broadcast | Cross-session `fallbackVodId` | Fixed in `@streampulse/analytics-console` — only current session row |

## Before restarting `:5173` after package edits

`npm run dev` starts the hosted-first wrapper with strict-port binding; it never
automatically kills the listener on 5173. The legacy `dev:clean-port` command is
now a read-only ownership diagnostic and fails when occupied. Verify the PID's
checkout before stopping it explicitly. A terminated Vite child terminates the
wrapper with a diagnostic rather than leaving an apparently live watcher with
no HTTP server. A module-load reload button cannot recover until the server is
actually available again.

Portal UI imports `@streampulse/analytics-console` and `@streampulse/pulse-charts` via `file:../packages/*` (Pulse-owned). After editing those packages:

```bash
cd ..
npm run build:packages
cd streampulse-web
npm install
npm run check:analytics-overlap   # fails if duplicate stacks reintroduced
npm run typecheck && npm test
```

If HMR serves stale console code, delete `node_modules/.vite` and hard-refresh the browser (Ctrl+Shift+R).

## Why overlap keeps coming back (and what blocks it now)

| Cause | What happens | Enforcement |
|-------|----------------|-------------|
| Agents **add** features without **deleting** old mounts | Two moment lists, two charts, wrong VOD fallback | `npm run check:analytics-overlap` (also in `build` + `pages:deploy:prod`) |
| Portal + in-repo packages out of sync | Fix in packages/, portal still on stale dist | `npm run build:packages` then portal `npm install`; commit hook runs overlap check |
| `:5173` restart ≠ clean slate | Old behavior is still in source until gated/deleted | Overlap script greps source, not cache |
| No CI gate on duplicate patterns | Regressions ship on deploy | Deploy script runs overlap check before Vite build |

Cursor: rule `.cursor/rules/analytics-no-duplicate-stack.mdc` + commit hook `.cursor/hooks/analytics-overlap-pre-commit.py`.

## Verify

`npm run test:e2e:audit` builds a fresh local production preview and runs public-surface, hub, chart, and responsive interaction regressions, including the outer Live Wire rail and bucket inspector. Its browser suites use intercepted API fixtures, so this is not the separate no-mock real-data acceptance. The launcher binds loopback by default; use `npm run dev -- --lan` only when LAN exposure is intentional. Landing uses one initial 30-minute snapshot, not the analytics poll loop. No additional Chromium GitHub Actions job is required.

```bash
# Portal dev server up
curl -s -o NUL -w "%{http_code}" http://127.0.0.1:5173/analytics

# Hosted hub reachable
curl -sI "https://api.streampulse.stream/v1/public/hub?activityWindow=24h" | findstr /i cache-control

# Local backend (when compose up)
curl -fsS http://localhost:8081/v1/extension/health
```

When on hosted (default): no `HubBackendSourceBanner` warning; hub KPIs reflect production IRC pool.

## Related docs

- [contributing-wip-split.md](../contributing-wip-split.md) — hub vs main checkout roles
- [design.md](./design.md) — portal architecture
- [hub-fanout-edge-cache.md](./hub-fanout-edge-cache.md) — Day 6 fanout / poll discipline
- [streampulse-web/README.md](../../streampulse-web/README.md) — npm scripts and deploy
- [streampulse-backend/AGENTS.md](../../../streampulse-backend/AGENTS.md) — backend router
