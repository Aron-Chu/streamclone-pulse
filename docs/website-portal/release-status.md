# StreamPulse release status

Last updated: 2026-07-07 (portal release gate green; VPS ops pending SSH)

## Release target

**Full StreamPulse GA** — public website + hosted API + Chrome Web Store extension.

## Sign-off tracks

| Track | Meaning | Blocks website/API ship? |
|-------|---------|--------------------------|
| **A — GA release readiness** | Portal build green, hosted API stable, extension submit-ready, ops evidence | **Yes** |
| **B — CWS approval complete** | Chrome Web Store listing approved | **No** (Landing CTA swap only) |

## Track A checklist

| Gate | Status | Evidence |
|------|--------|----------|
| Portal `npm run build` (app-only tsc) | Done (local) | `streampulse-web`: split `tsconfig.json` / `tsconfig.test.json` |
| Portal `npm test` | Done (local) | 62 files / 342 tests; hub landing empty tests excluded (known hang — e2e authority) |
| Console API setup before render | Done | `ConsoleChannelView.tsx` module-top `setupStreamcloneAnalyticsApi()` |
| Promotion manifest + `IMAGE_TAG` reconcile | **Operator (SSH)** | [`promotion-manifest-rc18.example.md`](../../../twitch-7tv-clone/docs/ops/examples/promotion-manifest-rc18.example.md), `scripts/ops/release-gap-vps-execute.sh`; remote health `v0.3.0-rc18` — [`release-gap-2026-07-07-remote.md`](../../../twitch-7tv-clone/docs/ops/evidence/release-gap-2026-07-07-remote.md) |
| Redis bounded + TTL audit | **Operator (SSH)** | `scripts/ops/hosted-redis-audit.sh`, [`hosted-redis-bounds-runbook.md`](../../../twitch-7tv-clone/docs/ops/hosted-redis-bounds-runbook.md) |
| Staged container limits | **Operator (SSH)** | [`hosted-limits-staged-runbook.md`](../../../twitch-7tv-clone/docs/ops/hosted-limits-staged-runbook.md), `release-gap-vps-execute.sh --limits-redis` |
| Focused cap-250 stability (2–6h) | **Operator (SSH)** | `hosted-release-check-soak-loop.sh` with `RELEASE_CHECK_HOURS=2` |
| Cloudflare hub cache | **Operator (dashboard)** | Probe: origin `X-Cache: HIT`, `CF-Cache-Status: DYNAMIC` — enable rule per [`hub-fanout-edge-cache.md`](./hub-fanout-edge-cache.md) |
| Cloudflare `/v1/public/*` WAF | **Operator (dashboard)** | [`cloudflare-public-hub-waf.md`](../../../twitch-7tv-clone/docs/ops/cloudflare-public-hub-waf.md) |
| Extension build + CWS checklist | **Operator submit** | [`chrome-web-store-review-checklist.md`](../pulse-extension/chrome-web-store-review-checklist.md) |

## Track B checklist

| Gate | Status |
|------|--------|
| CWS listing submitted | Pending operator |
| CWS approved | Pending Google review |
| Landing store CTA | Pending post-approval |

## Scope lock (this release)

- **In:** 250-channel live tracking stability, portal/API GA, extension store submission
- **Out:** corpus expansion, Top500 widen, broad 7-day corpus soak, ReplayForge auto-clipper GA

## Current production identity (audit 2026-07-07)

| Field | Value |
|-------|-------|
| Health version | `v0.3.0-rc18` |
| Intended `IMAGE_TAG` | `v0.3.0-rc18` (reconcile via ops) |
| Rollback tag | Document in streampulse-ops manifest |
| Scraper tag exception | Document if not rc18 |

Manifest lives in private **streampulse-ops** (`docs/deployments/YYYY-MM-DD-<tag>-<note>.md`).

## VPS SSH (operator)

Agent session could not authenticate to streampulse-vps (`aron-wsl` key missing; Tailscale SSH needs browser approval). Remote laptop probes are in [`release-gap-2026-07-07-remote.md`](../../../twitch-7tv-clone/docs/ops/evidence/release-gap-2026-07-07-remote.md).

After SSH works:

```bash
export PULSE_PROBE_SSH_TARGET=streampulse-vps
export PULSE_PROBE_SSH_KEY=~/.ssh/aron-wsl
export PULSE_PROBE_REMOTE_APP=/opt/streamclone/app
bash scripts/ops/release-gap-vps-execute.sh
RELEASE_CHECK_HOURS=2 bash scripts/load/hosted-release-check-soak-loop.sh
```

## Commit slices

See [`release-commit-slices.md`](./release-commit-slices.md) and [`release-gap-closure-tasks.md`](./release-gap-closure-tasks.md).

## Excluded Vitest unit tests

Configured in [`streampulse-web/vitest.config.ts`](../../streampulse-web/vitest.config.ts) `test.exclude`. E2E owns hub landing honesty paths.

| Excluded unit test | Reason | E2E owner |
|--------------------|--------|-----------|
| `analyticsLandingPage.test.tsx` | stats-fallback case OOM/hangs in full Vitest | [`tests/e2e/analytics-hub-metrics-honesty.spec.ts`](../../streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts) |
| `analyticsHubEmpty.test.tsx` | full landing render hang | same + [`tests/e2e/analytics-hub-ux.spec.ts`](../../streampulse-web/tests/e2e/analytics-hub-ux.spec.ts) |
