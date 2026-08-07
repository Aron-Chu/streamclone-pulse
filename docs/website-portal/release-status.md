# StreamPulse release status

Last updated: 2026-07-07 (Gate 1 commits done; Gate 2 remote evidence captured; VPS SSH pending operator key)

## Gate 1 — local commits (done)

| Repo | Commits | Notes |
|------|---------|-------|
| streamclone-pulse | slices A–E | `perf`/`fix`/`feat`/`docs` — see [`release-commit-slices.md`](./release-commit-slices.md) |
| streamclone | A-backend + F | hub cache tests + ops runbooks |

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
| Promotion manifest + `IMAGE_TAG` reconcile | **Operator (SSH)** | Private `streampulse-ops` evidence and preflight |
| Redis bounded + TTL audit | **Operator (SSH)** | Private `streampulse-ops` runbook |
| Staged container limits | **Operator (SSH)** | Private `streampulse-ops` runbook and guarded deploy script |
| Focused cap-250 stability (2–6h) | **Operator (SSH)** | Sample monitor: `twitch-7tv-clone/runtime/evidence/cap250-soak/day-release-check-monitor-20260707T134629Z.txt`; full gate: `hosted-release-check-soak-loop.sh` `RELEASE_CHECK_HOURS=2` |
| Cloudflare hub cache | **Operator (dashboard)** | 2026-07-07 probe: origin `X-Cache: HIT`, `CF-Cache-Status: DYNAMIC` — enable rule per [`hub-fanout-edge-cache.md`](./hub-fanout-edge-cache.md) |
| Cloudflare `/v1/public/*` WAF | **Operator (dashboard)** | Private `streampulse-ops` edge ownership record |
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

## Current production identity (public check 2026-07-09)

**Backend image exit is live for the Pulse BFF.** Public health reports streampulse-backend identity, not Streamclone rc18:

```bash
curl -fsS https://api.streampulse.stream/v1/extension/health
# {"ok":true,"version":"v0.1.1","hostedMode":true,...}
```

Ops still uses **dual tags** (`IMAGE_TAG` for remaining streamclone watch-core images; `BACKEND_IMAGE_TAG` for `ghcr.io/aron-chu/streampulse/{analytics,migrate,analytics-workers}`). See private **streampulse-ops** `AGENTS.md`.

| Doc | Purpose |
|-----|---------|
| [streamclone-image-exit-audit-2026-07.md](../pulse-extension/evidence/streamclone-image-exit-audit-2026-07.md) | Historical migration options / cutover checklist (pre-`v0.1.1` health) |
| [production-artifact-decision-2026-07.md](../pulse-extension/evidence/production-artifact-decision-2026-07.md) | Launch hardening notes until cutover |
| streamclone [production-promotion-contract.md](../../../twitch-7tv-clone/docs/production-promotion-contract.md) | Public promotion contract |

| Field | Value |
|-------|-------|
| Health version (public) | `v0.1.1` (`hostedMode: true`) — Pulse BFF from **streampulse-backend** |
| `BACKEND_IMAGE_TAG` | Pin in streampulse-ops (must match analytics / migrate / workers) |
| `IMAGE_TAG` | Remaining streamclone watch-core services only (metadata/video/chat/emote/…) |
| Source / production digests | Record in streampulse-ops manifest |
| Rollback tags + digests | Document in streampulse-ops manifest |

**Remaining ops work:** keep dual-tag digests reconciled in private **streampulse-ops**; do not treat Streamclone `v0.3.0-rc18` as the live Pulse API identity.

Manifest lives in private **streampulse-ops** (`docs/deployments/YYYY-MM-DD-<tag>-<note>.md`).

## Hosted production checks (public)

```bash
curl -fsS https://api.streampulse.stream/v1/extension/health
curl -fsS https://api.streampulse.stream/v1/public/status
```

Gate 2 soak evidence, SSH probes, and promotion manifests live in private **streampulse-ops** — not this public repo. Operator runbook: streamclone [`docs/hosted-production-ops.md`](https://github.com/Aron-Chu/streamclone/blob/master/docs/hosted-production-ops.md).

## Commit slices

See [`release-commit-slices.md`](./release-commit-slices.md) and [`release-gap-closure-tasks.md`](./release-gap-closure-tasks.md).

## Hub honesty unit tests

Full `AnalyticsLandingPage` mounts were removed (OOM/hang under Vitest). Unique asserts live in [`tests/analyticsHubHonesty.test.tsx`](../../streampulse-web/tests/analyticsHubHonesty.test.tsx). E2E still owns full-page hub paths: [`analytics-hub-metrics-honesty.spec.ts`](../../streampulse-web/tests/e2e/analytics-hub-metrics-honesty.spec.ts), [`analytics-hub-ux.spec.ts`](../../streampulse-web/tests/e2e/analytics-hub-ux.spec.ts).
