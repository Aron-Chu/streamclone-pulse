# Ranked Moments Readiness Implementation Plan

> **For the AI agent working this:** Use the canonical executing-plans skill when implementation is explicitly authorized. This document authorizes no execution, acquisition, commit, publication, deployment, or activation.

**Goal:** Make real historical Moments browsing and ranked Explore work end to end, with a reproducible backend release and honest production evidence.

**Architecture:** Keep discovery persistence, scoring, eligibility, facets, and signed pagination in the backend; the portal consumes those contracts. Ops owns runtime investigation, migration execution, image promotion, and rollback. Catalogue recovery and ranking certification are separate gates; Latest remains an explicitly unranked preview until Explore is proven healthy.

**Tech stack:** Go, PostgreSQL/pgx, React/TypeScript, Vite, Vitest, local Playwright, existing image-only ops workflow.

## Scope and Evidence

Continuation of [Ranked Moments Explorer](2026-09-13-ranked-moments-explorer.md), especially its Availability Correction. This plan governs remaining readiness work, not a reimplementation of completed local contracts. Backend references are owner-local `docs/discovery-ranked.md` and `docs/discovery-catalogue.md`. Ops references are owner-local `docs/runbooks/deployment-preflight.md`, `docs/runbooks/rollback.md`, and the current capacity policy named in its `AGENTS.md`. Keep operator procedures and sensitive evidence in private ops, not this public plan.

Prior evidence, supplied by the handoff and existing documentation, **not rerun for this plan**:

- Local `/analytics/moments` defaults to Latest following the Explore 404 report. Prior actual hosted reads: `/v1/public/hub?activityWindow=30m` returned 200 with ten rows; `/v1/public/discovery/ranked` returned 404; `/v1/public/discovery?month=2026-09&limit=50` returned 503. These observations do not diagnose the 503 or establish current deployment identity. No production investigation was performed.
- Local ranked SQL, migration 100014, eligibility persistence/diagnostic, HMAC scope-bound snapshots, facets, and raw-minute partial-day coverage exist. Both `PULSE_DISCOVERY_READ_ENABLED` and `PULSE_DISCOVERY_RANKED_READ_ENABLED`, plus persisted certification/version/reference, gate serving. Actual production projector scores remain nil and ineligible.
- The canonical heatmap scorer normalizes within each stream; appending an extreme minute changes an unchanged prefix's scores. Cross-stream comparability is uncalibrated. A populated table or passing synthetic experiment cannot certify it.
- Prior local unit/synthetic PostgreSQL acceptance included 4,000 detections and migration roundtrip. Portal evidence included 160 tests/13 mocked E2E, then fallback-focused 79 tests/8 mocked E2E and one actual-API browser check. A broader Go run failed once on collector interval timing; a focused retry passed. That retry is not a clean broad-suite result.
- Extensive unrelated dirty WIP is not an isolated release. No deployment or production flags were changed. Latest recovery has **not** solved the original Explore goal.

## File and Ownership Map

Paths below are relative to their owning repository. These are future touchpoints, not permission to modify all of them.

| Owner | Files | Responsibility |
| --- | --- | --- |
| Backend | `docs/discovery-ranked.md`, `docs/discovery-catalogue.md`; proposed `docs/discovery-ranked-calibration.md` | Contract, readiness evidence, frozen scoring decision |
| Backend | `internal/analytics/discovery_api.go`, `discovery_ranked.go`, `discovery_ranked_read.go`, `discovery_projection.go`, `discovery_projector.go`, `discovery_indexer.go` | Only audit-proven catalogue/scoring/read changes |
| Backend | `migrations/100014_ranked_discovery.up.sql`, `migrations/100014_ranked_discovery.down.sql` | Review dependencies and reversibility; do not rewrite applied migrations |
| Backend | `internal/analytics/discovery_ranked_test.go`, `discovery_ranked_sql_test.go`, `discovery_indexer_test.go`, `discovery_scale_test.go`, `discovery_browser_test.go` | Focused regression, realistic database and integration proof |
| Portal | `streampulse-web/src/lib/discoveryRanked.ts`, `discoveryCatalogue.ts`; `src/hooks/useDiscoveryCatalogue.ts`; `src/routes/analytics/AnalyticsMomentsPage.tsx` under `streampulse-web/` | Contract consumption and eventual default change |
| Portal | `streampulse-web/tests/discoveryRanked.test.ts`, `discoveryRankedState.test.tsx`, `rankedExplore.test.tsx`; `tests/e2e/discovery-ranked.spec.ts`, `moments-hosted-availability.spec.ts` under `streampulse-web/` | Existing regressions; availability test expectations must evolve with approved serving state |
| Portal | Proposed `streampulse-web/tests/e2e/moments-readiness.integration.ts` and dedicated local Playwright config | No-interception real full-stack acceptance, distinct from fixture suites |
| Ops | Existing deployment evidence convention `docs/deployments/YYYY-MM-DD-<tag>.md` | Private audit, exact release inventory, approvals, smoke and recovery evidence |

No speculative scorer implementation or migration number is prescribed. Evidence-gated code changes require a narrow follow-up implementation task with a failing regression first; select a new migration number only against the approved release inventory.

## Execution Order

After future authorization, stages 1 and 2 can run in parallel with stage 4's offline feasibility work on already-approved data. Stage 3 depends on 1/2; stage 5 can review existing persistence concurrently with calibration but must rerun against the final stage 3/4 artifacts. Stage 6 requires 3/4/5. Stage 7 requires 1-6 and separate release authorization. Stage 8 validates each production activation before the next one proceeds. No deployment precedes representative score/data verification. Catalogue-only progress can be proposed separately if scoring fails, but is not completion of this goal.

### 1. Read-Only Hosted Audit

**Owner:** Ops, with backend interpretation. **Dependency:** authorization for a bounded read-only audit; none is performed by writing this plan.

1. Record UTC observation time, actual image digests/tags and source revisions, runtime route availability, effective read/ranked/index flags, schema migration version/dirty state, and installed index/trigger definitions. Use only `streampulse-vps` or `hosted-production-vps` as production aliases here.
2. Inspect discovery scheduler scan/sweep freshness, queue backlog/failures, worker ownership and cadence, projection totals/eligible totals/version/certification presence, source identity and raw-minute retention. Never print signing keys or private validation-reference contents publicly.
3. Correlate the historical 503 with bounded logs and read-only database evidence. Distinguish disabled configuration, absent schema, stale/unproven coverage, and query failure; do not infer a cause from HTTP status alone.
4. Record indexed scope and date/category distribution, including whether representative real scopes exceed ten and fifty results. Use bounded samples with a recorded cap and selection rationale; neither a 500/501 sample nor collector count proves completeness. Do not acquire data or change retention to improve the audit.

**Output / go:** Private timestamped evidence identifies the deployed revision, migration state, configuration and a supported diagnosis, or explicitly narrows unresolved questions. **No-go:** missing access/evidence means production state remains unknown, not permission to enable flags. Any mutation needs separate approval.

### 2. Isolate a Reproducible Release Tree

**Owner:** Backend and portal; ops inventories its own release inputs. **Dependency:** none beyond future local-work authorization.

1. Inventory staged, unstaged and untracked changes and exact base revisions in each owner. Record intended paths/hunks and required imports, generated package inputs, lockfiles, schema dependencies and runtime wiring.
2. Prepare an isolated release tree containing only reviewed feature changes and necessary dependencies, with a content manifest and repeatable build instructions. Preserve the current worktrees; do not reset, stash, discard, or sweep unrelated WIP into a release.
3. Build/check from that tree, not from a previously built package cache. Identify every remaining commit/image provenance dependency before requesting release approval.

**Output / go:** Reviewable change inventory and reproducible local artifact tied to exact inputs. **No-go:** unresolved dependency on unrelated WIP blocks release. No commit, push, image publication or PR creation is authorized; approved immutable revision/image provenance must be obtained before stage 7.

### 3. Restore the Historical Catalogue

**Owner:** Backend for behavior, portal for consumption, ops for later activation. **Dependencies:** stages 1/2.

1. Turn the audit diagnosis into a local failing regression: disabled/store/schema distinction, index progress/freshness, identity eligibility, or coverage evidence as applicable. Apply only the demonstrated code fix; if configuration alone explains it, propose that exact configuration correction without inventing a code change.
2. Use approved real stored IRC input in isolation to run the existing bounded projector/indexer and catalogue read. Inventory missing source/retention evidence; do not launch new collectors, background acquisition, media publishing or backfill.
3. Reconcile month/day/category/creator results and calendar counts to independently queried stored facts. Demonstrate more than ten real detections in an evidence-backed day/category scope, plus a real collection exceeding fifty traversed with `limit=50`. Do not choose an empty scope and call that scale acceptance.
4. Check measured zero versus no measurement, event-time category versus current creator category, source correction/deletion behavior, and scheduler freshness. Keep nil ranking evidence unchanged; historical chronological browsing is not Top.

**Output / go:** Real catalogue acceptance matrix and either a tested narrow repair or an evidence-backed configuration-only proposal. **No-go:** unavailable data or 503 cause unresolved; request acquisition/configuration authorization at the boundary. Production catalogue restoration remains pending stages 7/8.

### 4. Decide Scoring Feasibility and Freeze the Contract

**Owner:** Backend scoring owner; user approves meaning/metric changes. **Dependency:** stage 2 input provenance; initial offline research can run in parallel with stages 1/3.

1. Write `docs/discovery-ranked-calibration.md` with public-IRC/consented source eligibility, exact input hashes/revisions, source retention and preprocessing rules, scorer configuration/version, and reproducible experiment commands. Acquire additional representative samples only after explicit approval; keep private/raw data outside public docs.
2. Before tuning, freeze train/calibration/held-out splits separated by channel and time, with channel-size, category, activity, duration and incomplete-coverage diversity. Specify numeric minimum channels/streams/measured minutes per stratum and held-out set, evaluation labels/reference judgments, uncertainty bounds, cross-stream comparability criteria, and rank-stability tolerances for append/extreme-minute/reprocessing tests. Obtain review of those values before running acceptance; insufficient evidence is a failed gate, not a smaller post-hoc threshold.
3. Evaluate the existing scorer against the frozen criteria and an honestly named raw-volume baseline. Test leakage, dominance by large channels, missing-data effects, rank sensitivity, and stability across held-out periods. Report pass/fail per criterion, not merely aggregate averages.
4. If it passes, specify the exact certified version, eligibility rule, minimum evidence, score explanation, data manifest and validation reference. Implement only the reviewed backend projection contract, then verify finite persisted scores and eligibility on representative data; a validation-reference string alone is not certification.
5. If it fails, stop ranked activation. Present the evidence and ask the user to choose a metric change or defer ranked Explore. A raw-volume option must be labeled as raw volume, not relative reaction quality or the existing Top promise; it requires an approved contract/UI change. Do not invent a replacement scorer or certify the current one by assumption.

**Output / go:** Reviewed, reproducible held-out evidence and an approved score/eligibility contract actually populated locally. **No-go:** any unmet criterion keeps real rows ineligible and ranking unavailable. Catalogue/Latest may remain useful, but the Explore goal remains open.

### 5. Database, Load and Regression Readiness

**Owner:** Backend, with ops migration/recovery review. **Dependencies:** stage 2; final acceptance uses stage 3/4 artifacts.

1. Compare migration inventory and checksums to stage 1. Locate and confirm the owning applied-migration policy before edits; the inspected guides do not establish permission to rewrite applied SQL. Preserve applied migrations; use a new additive migration for required corrections. Review dependency order through 100014, new ranking fields and generation triggers, worker/old-image compatibility, locks and index build behavior.
2. On an isolated representative restore, capture row distributions, heavy JSON payloads, skewed categories, missing/eligible fractions and current-day raw-minute retention. Run `EXPLAIN (ANALYZE, BUFFERS)` for the actual ranked, facet, eligibility, coverage and catalogue queries across day/31-day scopes, creator/category filters and late pages. Record plans and timings; synthetic 4k evidence is insufficient.
3. Exercise concurrent readers and index updates, rate-limit identity behavior, cancellation, restart/persistence, snapshot churn and invalidation. Verify existing bounds: four concurrent reads, three-second read deadline, 2 requests/sec burst 4 per-client limiter, 150,000-byte response ceiling and 1,000-facet fail-closed limit. Approve deployment-specific latency/resource/error budgets and distributed edge controls before load acceptance; do not equate timeout ceilings with latency targets.
4. Capture pre-migration data/schema and prove backup readability and restoration in isolation. Rehearse forward migration and recovery using intended image versions. Record lost ranking/certification fields or derived data on down/restore, restore-point loss and rebuild requirements. A roundtrip pass does not guarantee production rollback; prefer an evidenced compatible flag-off/image recovery where possible.
5. Diagnose the broad Go collector interval timing failure on the release tree; compare baseline, isolate the timing assumption and record the cause/fix or unresolved blocker. A focused passing retry cannot replace a clean applicable broad run.

**Future commands:** In backend, with `INTEGRATION=1` and an explicitly isolated loopback `TEST_DATABASE_URL` supplied privately, run separately:

```text
go test ./internal/analytics -run "TestDiscoveryRanked|TestDiscoveryCatalogueMigrationRoundTrip" -count=1 -timeout=120s
go test -race ./internal/analytics -run "^TestDiscovery" -count=1 -timeout=5m
go test ./internal/analytics/... -count=1 -timeout=10m
```

**Output / go:** Non-skipped database evidence, representative plans/load report within approved budgets, migration compatibility/recovery matrix, and explained broad-suite result. **No-go:** unsafe locks, missing restore evidence, unknown policy, unexplained failures or excessive churn block promotion. Tests run only on disposable local data; production load/migration/restore requires separate approval.

### 6. Real Local Full-Stack Acceptance

**Owner:** Backend and portal. **Dependencies:** stages 3-5; explicit permission for any additional acquisition.

1. Bring up the isolated populated backend at canonical `http://localhost:8081` and portal through the documented `npm run dev:local` with `VITE_ALLOW_LOCAL_BACKEND=1`. Confirm the actual local launch entrypoint first: the owner guide still labels `make up` as planned, so do not treat it as a working command. Never route BFF traffic to the watch service. Use detached servers with redirected logs and a finite readiness check; do not kill occupied services.
2. Add the dedicated integration spec/config from the file map using the real API and approved representative corpus. No route interception, fixture shim, prebuilt response injection, synthetic certification or hosted pass-through. The existing synthetic database browser harness remains separate evidence.
3. Exercise explicit Explore, History, Latest, Saved, exact detail and Back/refresh. Reconcile filters/facets/ranks/coverage and more-than-ten results, traversing at least two 50-item pages where data supports them, against the same database snapshot. Verify cursor invalidation preserves old rows until explicit refresh and never mixes generations.
4. Verify unavailable source states without false playback, and exact stream/offset alignment for available sources. Browsing must not invoke collector admission, backfill, Helix acquisition or ReplayForge job creation. Record network evidence and actual asset/source availability.
5. Capture 390/768/1440px screenshots and check clipping, overlap, keyboard focus, loading/errors, category/date controls and pagination. Keep bare-route Latest until hosted validation in stage 8.

**Future commands:** In `streamclone-pulse/streampulse-web`, run separately:

```text
npm run typecheck
npm run build:ci
npm run check:analytics-overlap
npm test -- tests/discoveryRanked.test.ts tests/discoveryRankedState.test.tsx tests/rankedExplore.test.tsx
npx playwright test tests/e2e/discovery-ranked.spec.ts --workers=1
```

The last command is mocked regression evidence only. Once the new dedicated config exists, record its exact no-mock command and environment in this plan and run it against the confirmed isolated stack. Missing/skipped full-stack acceptance is a blocker, not permission to reuse synthetic results.

**Output / go:** Reproducible real-data browser/API/database report, screenshots and clean applicable checks on release inputs. **No-go:** mocks, nil real scores, unexplained missing records, source misidentity or failed interaction. No production changes are authorized by local success.

### 7. Explicitly Authorized Promotion and Separate Activations

**Owner:** Ops; backend supplies artifact/schema contract, portal owns its release. **Dependencies:** stages 1-6; fresh audit if inputs changed.

1. Request deployment authorization naming exact approved revisions, immutable image tags/digests, migration inventory, backup/restore proof, intended flags, smoke matrix, resource/error/freshness thresholds and previous known-good images. Match analytics/migrate/workers to the same backend release; preserve the unrelated watch release. Do not publish images or commit to obtain these without authorization.
2. Ops follows its existing private preflight and image-only deployment workflow: clean approved ops revision, validated compose with no source build, and a fresh receipt bound to revision/tags/configuration. Reissue preflight when inputs change. Use existing CI only, with no new Chromium Actions jobs or bypasses. Keep operational commands in the ops runbook.
3. First authorized deployment keeps both discovery read flags off and explicitly reviews indexer state; any worker enabling/reprocessing is a separately approved mutation. Confirm migration clean state, exact running revision and general health using existing production smoke and hub IRC verification, not repeated process polling.
4. Request distinct catalogue/index activation approval specifying work bounds and scope. Validate production catalogue via stage 8 before proceeding. Artwork/media activation and capacity changes are not implied.
5. Only after real production score/version/eligibility reconciliation against the approved calibration contract, request separate certification publication/reprocessing and ranked activation approval. Specify exactly which mutation each approval permits. Enabling `PULSE_DISCOVERY_RANKED_READ_ENABLED` does not establish trust in missing scores.

**Output / go:** Private release record with approvals, immutable provenance, backup, fresh preflight receipt, smoke and rollback/stop decisions for each transition. **No-go:** any threshold violation pauses rollout; follow the preapproved flag-off/recovery path, recording schema/data implications. Do not promise that an image rollback reverses migrations. No capacity expansion is included; applicable current ops policy remains controlling.

### 8. Verify Production User Outcome, Then Change the Default

**Owner:** Ops records runtime/data evidence; backend reconciles contracts; portal verifies user route. **Dependencies:** stage 7 incrementally, with new approval for portal publication/default change.

1. After catalogue activation, verify real day/category/creator scopes beyond ten results and real continuation beyond the first 50-item page. Compare calendar/facet totals to stored facts; distinguish partial coverage, missing measurements, measured zero, exclusions and out-of-retention. Failure stops ranked activation.
2. Before ranked activation, reconcile representative persisted finite scores, eligibility totals, certification and one ranking version to approved inputs. After activation, verify actual API ordering, disjunctive facets, Today/Yesterday/week/custom UTC bounds, ties and consecutive ranks across pages, and snapshot invalidation/refresh under naturally occurring updates. Test destructive correction cases locally, not by mutating production for a screenshot.
3. Confirm nil/missing scores remain excluded rather than fake zero, unavailable versus healthy empty is distinguishable, and the eligibility diagnostic reconciles. Verify representative source availability and exact selection/playback where available; unavailable footage must remain honestly unavailable. Do not claim all detections have playable sources.
4. Run read-only live browser acceptance on explicit `?view=explore` using the actual hosted API, without interception or backend overrides, at 390/768/1440px. Update the old availability test, whose expected 404/503 states are now historical, without weakening its no-mock boundary. Record requests, timestamps, screenshots and real pagination/category/date/detail/Saved behavior.
5. Observe within a bounded, preapproved ops-policy window covering relevant index sweeps, refresh and load conditions. Record start/end, cadence and error/freshness/resource stop thresholds before starting. Do not invent a 30-minute sufficiency claim or confuse preflight receipt lifetime with soak. If capacity is touched, its separate policy applies; a shorter Moments check cannot satisfy that policy.
6. Only after the preceding live gate passes, request the portal default change/release. Add the bare-route Explore regression, preserve explicit Latest/History/Saved and honest failure recovery, then run portal checks and authorized publication. Repeat actual live browser acceptance on `/analytics/moments` with no `view` override. If it fails, use the approved portal recovery and leave completion open.

**Output / go:** Approved observation evidence plus a healthy bare user route serving real ranked results, meaningful category/date browsing, stable pagination beyond the preview, and honest source/coverage states. **No-go:** feature-empty data masquerading as readiness, unresolved ranking validity, or route/default failure. A passing health check, flag toggle or Latest fallback never auto-completes this plan.

## Pending Checklist and Completion Rule

- [ ] 1. Authorized read-only hosted audit and supported diagnosis recorded.
- [ ] 2. Intended changes/dependencies isolated without losing unrelated WIP.
- [ ] 3. Representative real historical catalogue acceptance passed.
- [ ] 4. Scoring decision approved and real eligibility evidence passed, or explicitly stopped for a user decision.
- [ ] 5. Migration, representative plans/load, recovery and broad regression gates passed.
- [ ] 6. Real no-mock local full-stack acceptance passed.
- [ ] 7. Deployment and each activation separately authorized and evidenced.
- [ ] 8. Actual production data/browser observation passed; authorized bare-route Explore verified.

All stages remain pending. Backend deployment-ready means stages 1-6 plus a reviewable promotion/recovery packet, not deployed. Original user outcome complete means all eight pass with evidence tied to actual release inputs. Scoring failure or missing approval is an explicit blocked state, not a reason to silently redefine Top or mark catalogue-only progress complete.
