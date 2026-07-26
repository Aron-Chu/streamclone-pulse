# Production Artifact Decision — StreamPulse / Streamclone

Date: 2026-07-07 UTC
Status: accepted for launch hardening
Related evidence: [improvements.md](improvements.md), [streamclone-image-exit-audit-2026-07.md](streamclone-image-exit-audit-2026-07.md)

**Supersession:** The "keep Streamclone images" decision applies until image namespace cutover. After cutover, promoted StreamPulse images per [streamclone-image-exit-audit-2026-07.md](streamclone-image-exit-audit-2026-07.md) are authoritative for production manifests.

## Decision

For the current public-launch hardening phase, **keep StreamPulse production on Streamclone backend images** and fix the launch issues through promotion discipline, ops limits, Redis/Postgres tuning, and worker isolation.

Follow-up audit: [streamclone-image-exit-audit-2026-07.md](streamclone-image-exit-audit-2026-07.md) documents what those images are used for today and a lower-risk path to move production manifests away from `ghcr.io/aron-chu/streamclone/*`.

Do **not** create a separate StreamPulse backend repo or rebuild `analytics` under a new image line before launch. That would add migration, schema, and rollback risk without fixing the current bottlenecks.

What changes now:

1. `streampulse-ops` becomes the promotion boundary: one deploy manifest pins the backend release, image tags, migration tag, caps, kill switches, rollback tag, and smoke evidence.
2. Streamclone remains the source of backend truth: Go APIs, analytics BFF, workers, migrations, Redis/Postgres code, and GHCR images.
3. `streamclone-pulse` remains the client/product repo: Chrome extension, `streampulse-web`, product docs, and hosted API contracts.
4. Analytics stays separated at runtime as its own image/container/process lane, but not as a separately built source repo.

## Repository Map

| Repo | Owns | Does not own |
| --- | --- | --- |
| `streamclone` (`twitch-7tv-clone` checkout) | Go backend, `/v1/extension/*`, `/v1/public/*`, analytics BFF, workers, migrations, `packages/pulse-core`, GHCR image build | Production secrets, production env, final deploy caps |
| `streamclone-pulse` | Chrome MV3 extension, StreamPulse portal/frontend, product requirements/design/evidence docs | Backend images, migrations, production compose |
| private `streampulse-ops` | VPS compose, secrets, `IMAGE_TAG`, resource limits, Cloudflare/Tunnel config, backup/restore, deploy and rollback evidence | Application source of truth |
| optional scraper source | TwitchTracker/Camoufox scraper implementation if split | Pulse API/BFF or migrations |

## Why We Still Use `ghcr.io/aron-chu/streamclone/*`

StreamPulse is the hosted product, but the hosted API is the Streamclone backend. The public portal and extension do not replace that backend; they consume it.

The important invariant is not the registry path text. The important invariant is:

```text
analytics image tag == migrate image tag == backend source revision that defines the DB/API contract
```

If the registry path was renamed to `ghcr.io/aron-chu/streampulse/analytics` without a promotion manifest and migration invariant, the real problem would remain. Conversely, `ghcr.io/aron-chu/streamclone/analytics:v0.3.0-rc18` is fine when ops can prove exactly what revision, migrations, caps, and rollback tag are deployed.

## What Was Actually Wrong In The Review

The issue was **release and operations discipline**, not the Streamclone registry namespace.

| Finding | Meaning | Fix owner |
| --- | --- | --- |
| rc18 app images, rc8 scraper, rc4 host `VERSION` | Deploy identity evidence is sloppy | `streampulse-ops` |
| cap 250 live while docs still discuss cap 10/25 gate | Launch posture drift | `streampulse-ops` + evidence docs |
| Redis 1.66 GiB, no maxmemory, noeviction, millions of rejected connections | Cache/quota/lock plane can fail under public load | `streampulse-ops` + `streamclone` metrics |
| no Docker memory/CPU/PID limits | Q4 worker/browser/Redis/MinIO can starve Q0 | `streampulse-ops` |
| corpus workers and scraper on API node | Runtime isolation is not proven | `streampulse-ops` |
| readiness route 404 and missing soak evidence | Operators cannot prove cap safety quickly | `streamclone` scripts + `streampulse-ops` evidence |

## Fix Plan By Repo

### 1. `streampulse-ops`: Promotion Manifest First

Add a private deploy artifact, for example `docs/deployments/YYYY-MM-DD-IMAGE_TAG.md` or `runtime/deploy-manifest.json`, containing:

| Field | Required value |
| --- | --- |
| `IMAGE_TAG` | One tag for analytics, metadata, emote, migrate, and default app images |
| `SOURCE_SHA` | Git SHA used to build that tag |
| `MIGRATE_IMAGE` | Must match `IMAGE_TAG` unless migration compatibility exception is documented |
| `SCRAPER_IMAGE_TAG` | May differ, but must be explicitly marked as scraper-only |
| `DEPLOYED_AT` | UTC timestamp |
| `CAPS` | active channels, top-N admission, backfills, GQL concurrency, scraper concurrency |
| `KILL_SWITCHES` | GQL, backfill, go-live, read-only, Helix, corpus/silver/gold |
| `ROLLBACK_TAG` | Previous known-good image tag |
| `SMOKE_RESULTS` | Hosted boundary, launch probes, health, hub, admin exposure |

This fixes the “why are we on Streamclone tags?” confusion by making deployment promotion explicit: Streamclone builds artifacts; StreamPulse ops promotes one artifact set.

### 2. `streampulse-ops`: Normalize Current Production

Do one of these before public launch:

| Option | Decision |
| --- | --- |
| Conservative launch | Lower to cap 25, disable corpus/silver auto-enqueue on API node, run 24h soak |
| Aggressive launch | Keep cap 250 only after attaching cap-250 soak evidence with memory, Redis, PG write p95, BFF p95, rollup flush p95, GQL throttling, tunnel errors |

Recommendation: **conservative launch** unless the private soak bundle already exists.

### 3. `streampulse-ops`: Redis And Container Limits

Immediate ops changes, with rollback notes:

- Add Redis memory alerting and maxclients/connection monitoring before traffic grows.
- Investigate why rejected connections are already in the millions.
- Add container memory/CPU/PID limits for analytics, workers, scraper, Redis, Postgres, MinIO, and Caddy.
- Keep `PULSE_MAX_BACKFILLS=1`, GQL concurrency 1, and `SCRAPER_MAX_CONCURRENT=1`.
- Do not choose an eviction policy blindly while quotas/locks/cache share one Redis DB. First inventory key prefixes and TTLs; then split DBs or set eviction only for cache-safe keys.

### 4. `streamclone`: Add Runtime Truth Endpoints / Metrics

Backend/source work that helps ops prove readiness:

- Private/local readiness probe for live admission, collector deficits, cap, queue state, Redis hit/reject counters, and DB size.
- Health payload or admin payload should expose non-secret cap and kill-switch states to operator smokes.
- Metrics for Redis BFF hit/miss, PG write p95, rollup flush p95, GQL 429/503/backoff, and collector reconnects.
- Forward-only retention/pruning migrations or jobs for rollups, top500 snapshots, VOD chat staging, and old job rows.

### 5. `streamclone-pulse`: Keep Client Contracts Honest

Portal/extension work remains client-side:

- Continue using `https://api.streampulse.stream` as hosted default.
- Keep public analytics aggregate-only and raw chat private.
- Reduce polling or add cache headers if public hub fanout creates origin pressure.
- Document launch evidence and product posture, but do not own backend image tags.

## When To Create `streampulse/*` Images

Create StreamPulse-branded backend images only when at least one of these is true:

1. A private promotion pipeline copies a tested Streamclone image digest into a StreamPulse namespace without rebuilding from different source.
2. The hosted product needs a different support/compliance boundary from the open-source backend.
3. StreamPulse backend code truly forks from Streamclone and accepts the cost of duplicated migrations, CI, security updates, and rollback compatibility.

Until then, separate image names would be mostly cosmetic and could make rollback less safe.

## Operational Decision

For launch hardening:

- **Keep** `ghcr.io/aron-chu/streamclone/analytics:${IMAGE_TAG}`.
- **Require** `analytics` and `migrate` to match by tag or digest.
- **Allow** scraper tag exceptions only when recorded.
- **Fix** cap drift, Redis pressure, container limits, retention, and soak evidence before full public launch.
- **Move** corpus/silver/gold/scraper to a worker VPS if public API p95, Redis, or PG write latency degrades.

This resolves the repo-boundary confusion without adding a risky pre-launch backend split.