# Streamclone Image Exit Audit — StreamPulse

Date: 2026-07-07 UTC
Status: draft audit / migration options
Related: [production-artifact-decision-2026-07.md](production-artifact-decision-2026-07.md), [../../website-portal/release-status.md](../../website-portal/release-status.md)

## Question

Can StreamPulse move completely away from using `ghcr.io/aron-chu/streamclone/*` production images, and what are those images used for today?

## Short Answer

StreamPulse has already moved **production ops** out of the public Streamclone repo and into private `streampulse-ops`. It has **not** moved the hosted backend image line away from Streamclone.

Today, the hosted API is still the Streamclone backend promoted by `streampulse-ops` under a pinned `IMAGE_TAG`. The public health endpoint currently reports:

```json
{"ok":true,"version":"v0.3.0-rc18","hostedMode":true}
```

This proves the hosted deployment identity is `v0.3.0-rc18` at the API level. It does **not** prove the per-container image digests; those must be reconciled inside private `streampulse-ops` / VPS evidence.

## Current Streamclone Image Usage

The public release overlay and production contract define this image set:

| Runtime role | Current image namespace | Why it exists |
| --- | --- | --- |
| `analytics` API | `ghcr.io/aron-chu/streamclone/analytics:${IMAGE_TAG}` | Hosts StreamPulse BFF routes, public hub/read APIs, extension APIs, coverage/backfill/job endpoints. |
| `analytics-workers` | `ghcr.io/aron-chu/streamclone/analytics:${IMAGE_TAG}` | Runs IRC collectors, rollups, scoring, live tracking, backfill workers. Same image, different process/env lane. |
| `migrate` | `ghcr.io/aron-chu/streamclone/migrate:${IMAGE_TAG}` | Applies DB migrations matching the backend source revision. Must remain compatible with `analytics`. |
| `metadata` | `ghcr.io/aron-chu/streamclone/metadata:${IMAGE_TAG}` | Channel/profile metadata service consumed by analytics and local app routes. |
| `emote` | `ghcr.io/aron-chu/streamclone/emote:${IMAGE_TAG}` | Emote dictionary/assets pipeline used by chat tokenization and UI rendering. |
| `video` | `ghcr.io/aron-chu/streamclone/video:${IMAGE_TAG}` | HLS/video relay service. May be unnecessary for a StreamPulse-only hosted API if no hosted watch/video surface is exposed. |
| `chat` | `ghcr.io/aron-chu/streamclone/chat:${IMAGE_TAG}` | Chat/IRC service for Streamclone watch flows. May be unnecessary for StreamPulse-only hosted API if analytics-workers own collection. |
| `frontend` | `ghcr.io/aron-chu/streamclone/frontend:${IMAGE_TAG}` | Streamclone local/web UI. Likely unnecessary for StreamPulse-only production if `streampulse-web` is deployed separately. |
| `scraper` | Streamclone or split scraper image, tag exception allowed | Optional TwitchTracker/Camoufox scraper path. Should be isolated or disabled unless explicitly required. |

## What Is Known Versus Unknown

Known from public docs and release config:

- `streampulse-ops` owns production deploy, secrets, compose overlays, resource limits, smoke, rollback evidence.
- The public release workflow still builds `ghcr.io/aron-chu/streamclone/{metadata,chat,video,emote,analytics,frontend,migrate}`.
- The release overlay maps `analytics-workers` to the same `analytics` image.
- Public health reports `version = v0.3.0-rc18` and `hostedMode = true`.

Unknown without private ops/VPS reconciliation:

- Exact running container image digests.
- Whether hosted production currently runs every generic service (`chat`, `video`, `frontend`) or only the subset needed by StreamPulse.
- Whether `scraper` is running, disabled, isolated, or using a tag exception.
- Whether all app containers and `migrate` are on one digest-compatible release.

## Required Private Ops Evidence

Before changing image names, capture one deployment record in `streampulse-ops/docs/deployments/` with enough evidence to answer “what is running?” without relying on public docs.

Minimum evidence:

| Evidence | Why it matters |
| --- | --- |
| `docker compose ps --format json` | Shows which services actually run, not just what public compose examples define. |
| `docker inspect` image name + digest for every running app container | Proves whether production is on one release or mixed tags. |
| `curl https://api.streampulse.stream/v1/extension/health` | Confirms public API identity and hosted mode. |
| Internal ops launch snapshot | Confirms caps, collector counts, queues, and kill-switch posture. |
| Current private compose file hash or git SHA | Makes rollback/debugging possible after the namespace change. |
| `migrate` image/tag used for latest schema migration | Proves DB schema and API code came from a compatible revision. |

Suggested VPS command block:

```bash
set -euo pipefail

date -u +%Y-%m-%dT%H:%M:%SZ
docker compose ps --format json

for id in $(docker compose ps -q); do
	docker inspect --format '{{.Name}} {{.Config.Image}} {{range .RepoDigests}}{{.}} {{end}}' "$id"
done

curl -fsS https://api.streampulse.stream/v1/extension/health

if [ -n "${PULSE_OPS_PROBE_TOKEN:-}" ]; then
	curl -fsS \
		-H "X-Ops-Probe-Token: ${PULSE_OPS_PROBE_TOKEN}" \
		'http://127.0.0.1:8090/v1/internal/ops/launch-snapshot?topN=500'
fi
```

The output should be copied into private ops evidence. Public docs should only summarize the result.

## Runtime Dependency Check

Do not remove inherited Streamclone services only because they look unrelated. Prove whether public StreamPulse routes touch them.

Minimum route checks after temporarily disabling a candidate service in staging:

| Candidate service | Disable only after proving |
| --- | --- |
| `frontend` | `streampulse.stream` is served by `streampulse-web` and no production Caddy route falls back to Streamclone frontend. |
| `video` | No public StreamPulse API or portal path uses HLS/video relay. Watch/playback routes are not part of current StreamPulse GA. |
| `chat` | Analytics ingestion/live tracking is handled by `analytics-workers`; no hosted extension/portal route requires the standalone chat service. |
| `scraper` | Hub/coverage UX degrades honestly or uses cached/rollup data; scraper is isolated or intentionally disabled. |
| `metadata` | Channel lookup/profile calls still work through analytics or a retained metadata service. Usually keep until BFF owns replacements. |
| `emote` | Emote rendering/tokenization still has dictionaries/assets. Usually keep until analytics owns enough cached emote metadata. |

Smoke paths to run after each candidate removal:

```bash
curl -fsS https://api.streampulse.stream/v1/extension/health
curl -fsS 'https://api.streampulse.stream/v1/public/hub?activityWindow=30m' | head -c 400
curl -fsS 'https://api.streampulse.stream/v1/extension/pulse/channels/xqc' | head -c 400
```

Add portal and extension manual checks when the removed service could affect visible UI.

## Why A Direct Rename Is Not Enough

Changing only the registry path from `streamclone/*` to `streampulse/*` would not by itself create a cleaner production boundary. The real invariants are:

```text
analytics image source == migrate image source == DB/API contract source
operator manifest records tag + digest + rollback
```

If StreamPulse-branded images are copied from the same Streamclone build without digest evidence, the audit problem remains. If they are rebuilt from a different source revision, migration and rollback risk increases.

## Naming Target

Prefer product names in production manifests even if the backend source remains in Streamclone for now. A clear first target is:

| Production role | Preferred StreamPulse image name | Source for first promotion |
| --- | --- | --- |
| API/BFF | `ghcr.io/aron-chu/streampulse/api:${IMAGE_TAG}` | Digest of `streamclone/analytics:${IMAGE_TAG}` |
| Workers | `ghcr.io/aron-chu/streampulse/workers:${IMAGE_TAG}` | Same digest as API unless a separate worker image is introduced later |
| Migrations | `ghcr.io/aron-chu/streampulse/migrate:${IMAGE_TAG}` | Digest of `streamclone/migrate:${IMAGE_TAG}` |
| Metadata | `ghcr.io/aron-chu/streampulse/metadata:${IMAGE_TAG}` | Digest of `streamclone/metadata:${IMAGE_TAG}` if still required |
| Emotes | `ghcr.io/aron-chu/streampulse/emote:${IMAGE_TAG}` | Digest of `streamclone/emote:${IMAGE_TAG}` if still required |

Avoid publishing `streampulse/frontend` from Streamclone. The public StreamPulse frontend should come from `streamclone-pulse/streampulse-web`, not the Streamclone local app.

## Migration Options

### Option A — Promote Existing Digests Into A StreamPulse Namespace

Copy tested Streamclone image digests into `ghcr.io/aron-chu/streampulse/*` or another StreamPulse-owned namespace without rebuilding.

Pros:

- Fastest way to remove the public-facing `streamclone/*` image names from production manifests.
- Keeps current backend source and migration compatibility.
- Low code risk if digest copy is exact.

Cons:

- Still uses Streamclone as backend source and CI origin.
- Requires a promotion workflow and manifest discipline.

Recommended as the first exit step.

### Option B — Build StreamPulse-Branded Images From The Streamclone Repo

Add a release workflow that publishes `ghcr.io/aron-chu/streampulse/{analytics,migrate,metadata,emote,...}` from the same source tree.

Pros:

- Removes Streamclone image namespace from production.
- Keeps one backend source repo and one migration line.

Cons:

- Duplicate image publishing can drift unless workflow enforces matching digests/source SHA.
- Cosmetic if package labels and docs still say Streamclone internally.

Acceptable if Option A is inconvenient, but it needs strict tag/digest checks.

### Option C — Split StreamPulse Backend Into Its Own Source Repo

Move hosted API/BFF/workers/migrations out of Streamclone into a new StreamPulse backend repo.

Pros:

- Cleanest product/source boundary long-term.

Cons:

- Highest risk: duplicated migrations, CI, rollback policy, shared types, security scanning, release train, ops runbooks.
- Requires deciding what happens to local Streamclone features that currently share backend code.
- Should not be mixed with GA launch hardening or ReplayForge productization.

Treat as a later architecture program, not the first image-exit step.

## Recommended Exit Plan

### Phase 0 — Private Ops Reconcile

Owner: `streampulse-ops`

- Capture current running containers, tags, and digests.
- Confirm which services are actually running for StreamPulse production.
- Mark `chat`, `video`, and `frontend` as required or removable for hosted StreamPulse.
- Record scraper status and tag exception if any.

Evidence command shape:

```bash
docker compose ps
docker inspect --format '{{.Name}} {{.Config.Image}} {{index .RepoDigests 0}}' $(docker compose ps -q)
curl -fsS https://api.streampulse.stream/v1/extension/health
```

### Phase 1 — Shrink The Runtime Set

Owner: `streampulse-ops` + backend review

- Keep only services required for `api.streampulse.stream`.
- Candidate required set: `analytics`, `analytics-workers`, `migrate`, `postgres`, `redis`, `metadata`, `emote`, Caddy/Tunnel.
- Candidate removable or optional set: Streamclone `frontend`, `video`, `chat`, scraper/corpus workers unless explicitly needed.
- Validate no public StreamPulse route depends on removed services.

### Phase 2 — Digest Promotion To StreamPulse Images

Owner: `streampulse-ops` / release automation

- Promote exact tested digests into a StreamPulse namespace.
- Do not rebuild from a different source revision during the promotion step.
- Update private compose to consume promoted image names.
- Keep `SOURCE_SHA`, old digest, new digest/name, and rollback tag in the deploy manifest.

Example target names:

```text
ghcr.io/aron-chu/streampulse/api:${IMAGE_TAG}
ghcr.io/aron-chu/streampulse/workers:${IMAGE_TAG}
ghcr.io/aron-chu/streampulse/migrate:${IMAGE_TAG}
ghcr.io/aron-chu/streampulse/metadata:${IMAGE_TAG}
ghcr.io/aron-chu/streampulse/emote:${IMAGE_TAG}
```

Promotion must preserve traceability. Each promoted image should have labels or manifest fields for:

- original image name
- original digest
- promoted image digest
- Streamclone source SHA
- StreamPulse release note / operator manifest path
- promotion timestamp

If GHCR package copying by digest is not available in the chosen tooling, use `docker buildx imagetools create` or an equivalent registry copy tool rather than rebuilding from source.

### Phase 3 — Public Docs Update

Owner: `streamclone-pulse` + `streamclone`

- Update the production artifact decision from “keep Streamclone images” to “StreamPulse production consumes promoted StreamPulse images whose source SHA traces back to Streamclone release X”.
- Keep Streamclone described as backend source until/unless the source repo is actually split.
- Update release-status and promotion manifest examples.
- Do not imply `streamclone-pulse` owns backend images unless it gains backend build/release responsibility.

Docs to update at cutover:

| Doc | Required change |
| --- | --- |
| `streamclone-pulse/docs/pulse-extension/evidence/production-artifact-decision-2026-07.md` | Mark the “keep Streamclone images” decision as superseded by promoted StreamPulse images. |
| `streamclone-pulse/docs/website-portal/release-status.md` | Replace intended `IMAGE_TAG` wording with StreamPulse image namespace and manifest link. |
| `streamclone/docs/production-artifact-contract.md` | Change from active production contract to historical/source-build contract, or add a new StreamPulse promotion contract. |
| `streamclone/AGENTS.md` and `streamclone-pulse/AGENTS.md` | Clarify that Streamclone remains backend source only if source has not split. |
| `streampulse-ops` private manifest template | Replace `streamclone/*` image rows with promoted StreamPulse image rows. |

## SDLC Doc Debt Register

These docs are not all blockers for the first image namespace cutover, but they are places where stale wording can create engineering debt, release confusion, or wrong agent behavior.

| Area | Doc or artifact | Why it may need changing | Timing |
| --- | --- | --- | --- |
| Production contract | `streamclone/docs/production-artifact-contract.md` | Currently says StreamPulse production intentionally deploys Streamclone images. Split it into source/build responsibility versus production promotion responsibility once StreamPulse image promotion exists. | Cutover blocker |
| Production ops pointer | `streamclone/docs/hosted-production-ops.md` | Should mention promoted StreamPulse image names after cutover while keeping secrets/compose in private `streampulse-ops`. | Cutover blocker |
| Release manifest template | `streamclone/docs/ops/promotion-manifest.template.md` | Current examples list `streamclone/*` images and `STREAMCLONE_VERSION`; needs promoted image rows, digest fields, and possibly a renamed public version field. | Cutover blocker |
| Release manifest examples | `streamclone/docs/ops/examples/promotion-manifest-*.md` | Examples can mislead operators into copying old image names. Keep old examples clearly historical or replace with StreamPulse image examples. | Cutover blocker |
| Release overlay docs | `streamclone/deploy/docker-compose.release.yml` comments | Public release overlay may remain for local/self-hosted Streamclone, but comments should not be read as StreamPulse production guidance after cutover. | Cutover or immediately after |
| Release workflow | `streamclone/.github/workflows/release-images.yml` | If StreamPulse images are published by promotion, document that this workflow is source-image build only. If it publishes StreamPulse images too, enforce source SHA/digest parity. | Implementation phase |
| Streamclone environment docs | `streamclone/docs/ENVIRONMENT.md` | Production deploy row should point to StreamPulse promotion contract instead of implying `IMAGE_TAG` always means Streamclone namespace. | Cutover or immediately after |
| Streamclone ops migration docs | `streamclone/docs/ops-migration-plan.md`, `streamclone/docs/ops-migration-manifest.md`, `streamclone/docs/ops-migration-prepared-report.md` | These are historical but contain examples with old image names. Mark as historical and link to the new promotion contract to avoid resurrecting old deploy practice. | Cleanup phase |
| Streamclone/Reforge boundary | `streamclone/docs/agents-streamclone-and-replayforge.md` | Currently says production API containers are pinned `streamclone/*` images. Update when StreamPulse production uses promoted images; keep ReplayForge separate. | Cutover or ReplayForge spec pass |
| Workspace/context routing | `streamclone/docs/workspace.md`, `streamclone-pulse/docs/CONTEXT.md` | Should only change if backend source ownership changes. For image promotion only, add at most one sentence that production images are promoted by `streampulse-ops`. | Optional after cutover |
| Agent routing | `streamclone/AGENTS.md`, `streamclone-pulse/AGENTS.md` | Agents follow these as truth. Update the task router so future agents do not reintroduce Streamclone image assumptions in hosted production docs. | Cutover blocker |
| Portal release status | `streamclone-pulse/docs/website-portal/release-status.md` | Current release identity uses `IMAGE_TAG`; after promotion, it should include StreamPulse image names/digests and private manifest link. | Cutover blocker |
| Portal release-gap tasks | `streamclone-pulse/docs/website-portal/release-gap-closure-tasks.md` | Mentions confirming `STREAMCLONE_VERSION` and `IMAGE_TAG`; should become a generic deployed version / image digest check. | Cutover or next release cleanup |
| Portal architecture | `streamclone-pulse/docs/website-portal/design.md` | Hosted API section says production values and `STREAMCLONE_VERSION`; update to avoid tying the portal contract to Streamclone-branded runtime identity. | Cutover or next design refresh |
| Portal requirements | `streamclone-pulse/docs/pulse-extension/website-portal-requirements.md` | Says backend is Streamclone analytics. If only image names change, keep source truth but clarify production promotion. If source splits, rewrite backend ownership. | Depends on scope |
| Extension design | `streamclone-pulse/docs/pulse-extension/design.md` | Lists hosted compose stack with inherited services. After runtime shrink, update actual services and remove stale `frontend`/`video`/`chat` if no longer running. | After runtime shrink |
| Live coverage requirements | `streamclone-pulse/docs/pulse-extension/live-coverage-requirements.md` | Backend row currently says backend is Streamclone. Keep if source stays; revise only if source split happens. Version wording should not hard-code `STREAMCLONE_VERSION` forever. | Depends on scope |
| Evidence ledger | `streamclone-pulse/docs/pulse-extension/evidence/improvements.md` | Currently states keep StreamPulse production on Streamclone backend images for launch. Add superseding note when promoted images are live. | Cutover blocker |
| Private ops docs | `streampulse-ops/compose/production/*`, `streampulse-ops/docs/deployments/*`, `streampulse-ops/scripts/deploy/*`, `streampulse-ops/scripts/smoke/*` | Authoritative production change lives here: compose image names, digest reconcile, deploy, smoke, rollback, and manifest schema. Public docs must not claim success before these are updated and run. | Cutover blocker |
| CI/CD runbooks | Release checklist / PR template / deployment checklist in whichever repo owns them | Add a required “image namespace + digest reconcile” checkbox so future releases do not silently drift back to `streamclone/*`. | SDLC hardening |

Recommended split for `streamclone/docs/production-artifact-contract.md`:

1. Keep it as the **source-build contract** for Streamclone images and local/self-hosted Streamclone releases.
2. Add a new `streamclone-pulse` or public StreamPulse doc for the **production promotion contract** once promoted images exist.
3. Link both docs from `streampulse-ops` private templates so operators see source provenance and production promotion as separate checks.

This avoids overloading one public Streamclone doc with both “Streamclone builds source images” and “StreamPulse production no longer consumes Streamclone-named images.”

### Phase 4 — Optional Source Split

Owner: separate architecture spec

- Define StreamPulse backend repo ownership.
- Move or fork Go BFF/workers/migrations intentionally.
- Create compatibility plan for existing Postgres migrations and rollback.
- Move shared types out of Streamclone or version them explicitly.

Do this only after promoted images are stable. Source split is a separate migration with its own rollback and migration compatibility plan.

## Cutover Checklist

Use this only after Phase 0 evidence exists.

1. Pick one release tag already stable in production, for example `v0.3.0-rc18` or newer.
2. Reconcile current Streamclone image digests in private ops.
3. Promote exact required digests into StreamPulse image names.
4. Render private production compose with StreamPulse image names.
5. Confirm `analytics`/`api`, `workers`, and `migrate` all trace to the same source SHA.
6. Run staging or canary deploy with StreamPulse image names.
7. Run public health, hub, channel pulse, extension, and portal smoke.
8. Record rollback image names/digests.
9. Switch production compose to StreamPulse image names.
10. Run post-promotion smoke and attach output to private manifest.
11. Update public docs after production smoke passes.

## Backout Plan

The first namespace migration should be reversible without changing DB schema.

Rollback steps:

1. Restore previous private compose image names/digests from the manifest.
2. Do **not** run a down migration unless a separate schema migration happened.
3. `docker compose pull && docker compose up -d`.
4. Re-run health and hub smoke.
5. Record failure reason before attempting another promotion.

If the promoted image is digest-identical to the previous Streamclone image, rollback should be a compose/image reference rollback, not a code rollback.

## Risks And Controls

| Risk | Control |
| --- | --- |
| Promoted images drift from source images | Promote by digest and record original/promoted digests. |
| `migrate` and API no longer match | Require same source SHA for API/workers/migrate before deploy. |
| Removing `chat` or `video` breaks hidden routes | Disable one service at a time in staging and run route smoke. |
| Public docs imply backend source moved when it did not | Say “promoted StreamPulse images built from Streamclone source SHA” until source split happens. |
| Rollback loses schema compatibility | Treat namespace change as image-reference-only; do not combine with migrations. |
| `streamclone-pulse` accidentally becomes backend owner in docs | Keep backend source ownership separate from product and ops ownership. |

## Acceptance Criteria For “No Streamclone Images In Production”

- Private production compose references no `ghcr.io/aron-chu/streamclone/*` images.
- Promotion manifest records StreamPulse image names and immutable digests.
- Public health reports the expected `IMAGE_TAG`.
- `analytics` and `migrate` are proven digest/source-compatible.
- Rollback manifest points to previous StreamPulse image names/digests.
- Public docs no longer say StreamPulse production deploys Streamclone images.
- Public docs still accurately state backend source ownership if the source repo has not moved.

## Open Questions

1. Does hosted StreamPulse production still run `chat`, `video`, or `frontend`, or are those only inherited from generic Streamclone compose?
2. Is scraper active in production today, and if so is it on the API VPS or isolated?
3. Do we want promoted image names to be service-specific (`api`, `workers`) or preserve old service names (`analytics`, `metadata`, `emote`)?
4. Should promoted StreamPulse images live under `ghcr.io/aron-chu/streampulse/*`, a private package namespace, or a future org namespace?
5. Is the goal only to remove `streamclone` from production manifests, or also to move backend source ownership away from Streamclone?

## Current Recommendation

Do not jump straight to a backend source split. First, reconcile current production, remove unneeded inherited services, then promote exact tested digests into a StreamPulse image namespace. That gets production off `ghcr.io/aron-chu/streamclone/*` with the least migration risk while preserving rollback and DB compatibility.