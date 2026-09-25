# Ranked Moments Readiness Implementation Plan

> **For the AI agent working this:** Use the canonical executing-plans skill when implementation is explicitly authorized. This document authorizes no execution, acquisition, commit, publication, deployment, or activation.

**Goal:** Make real historical Moments browsing and volume-ranked Explore work end to end, with a reproducible backend release and honest production evidence. Relative/Top ranking is a separate later release.

**Architecture:** Keep discovery persistence, volume eligibility, facets, and signed pagination in the backend; the portal consumes those contracts. Ops owns runtime investigation, migration execution, image promotion, and rollback. Catalogue recovery and completed-day volume certification are separate gates; Relative score calibration belongs to a later release. Latest remains an explicitly unranked preview until Explore is proven healthy.

**Tech stack:** Go, PostgreSQL/pgx, React/TypeScript, Vite, Vitest, local Playwright, existing image-only ops workflow.

**Readiness status (2026-09-22): BLOCKED.** The real-data
`moments-readiness.integration.ts` gate still requires an approved reconciliation
manifest and SHA-256; mocked portal tests do not satisfy it. A bounded read-only
hosted check found the discovery read, ranked read, and index flags unset and
the migration ledger clean at `100017`; the ranked schema and hosted route are
not activated. The user selected a volume-first product contract, with
Relative hidden until certified and portal History limited to at most 30
completed UTC days within the verified retained range. The separate
`/analytics/explore` route stays available until its replacement works.
Local candidate code and tests exist, but representative volume
lineage, recent coverage, historical read latency, and hosted smoke remain
release gates. No commit or deployment is implied by this status update.
At 2026-09-23 00:09 UTC, a bounded read-only hosted probe of the candidate's
representative Explorer/Newsroom 24-hour top-peaks SQL timed out at the
database's three-second statement limit. The plan scanned the peaks table
sequentially;
forcing its existing time-leading index also timed out. Backend candidate
migration `100023` adds a concurrent rank-leading partial index for this
query. A disposable PostgreSQL 16 smoke confirmed ordered index scans for
24-hour and 7-day queries on synthetic rows, but the index has not been built
or measured on hosted data.
Read-only hosted metadata estimates about 3.9 million discovery moments.
Stored discovery day facts currently end on September 19, so the recent
History window requires backfill and a verified freshness boundary before
activation; that observation does not establish raw-source absence.
Migration `100022` completed on a disposable PostgreSQL 16 table of the same
row count and roughly 4.6 GB, with all new indexes and constraints valid.
That local DDL rehearsal does not establish the hosted lock or I/O budget;
the reviewed migration and recovery gates remain open.
A bounded read-only count-lineage probe matched 2,998 of 3,000 sampled stored
moment display counts to their public IRC minute. Two differed; 500 additional
high-count-slice rows matched, but neither sample proves the full ranking
scope or the extreme tail. The candidate's exact-count guard must be checked
again against reprojected rows before volume activation.
The volume reader also has an unresolved 30-day facet cost: a bounded hosted
read-only equivalent of its canonical-identity category count timed out at
five seconds, while the handler's whole-request deadline is three seconds.
Even a raw category count without identity or first-seen filtering timed out.
New ordering indexes have not been shown to fix this aggregation. Preserve
the full category/eligibility contract and require a representative
post-reprojection plan and handler timing; if still over budget, add an
indexed aggregate read path before activation.
Forcing the existing category index to perform an index-only raw count also
exceeded five seconds. A smaller 30-day stream/day summary with the same
canonical identity filter returned in roughly two seconds, which suggests
preaggregation but is not yet fast enough proof for the whole request.
The 24-hour and 7-day full handlers remain a release gate even after this
migration. The deployed binary's exact query text was not independently
verified by that SQL probe. A later signed-manifest check bound the current
`v0.2.66` image digest to source `4adb6340de04`; the candidate descends from
that source and `internal/analytics/store.go` has no source diff for the
top-peaks query. Process-byte overrides were not rechecked, and the candidate's
historical handler changes remain unhosted.
A separate bounded comparison-rollup sample using the latest 40 eligible
minutes returned 5,845 rollup rows in 285 ms with the stream/minute index.
Those were not the handler's highest-chat candidates, so full endpoint
latency remains an open gate.
At 2026-09-23 01:33 UTC, local candidate migration `100024` adds a
transactional stream/day/category volume facet summary with invalidation on
direct base/summary writes and a complete day/moment write guard. The volume
reader uses summary groups before the signed cursor cutoff and raw moments
only for groups crossing it. All Discovery tests passed against disposable
PostgreSQL 16, including a cutoff prefix case; migration checksums validated.
A disposable query over 91,462 day rows and 274,386 facet rows took 466 ms
with the older public-identity join.
This is not a hosted full-handler measurement or migration rehearsal.
A separate read-only hosted probe of the candidate's unchanged pending and
coverage SQL took about 985 ms and 2,611 ms respectively for the recent
30-day scope. Coverage `EXPLAIN ANALYZE` took about 2,885 ms and revisited
canonical stream/alias identity for 91,462 day rows. Materializing the public
stream CTE took about 4,042 ms; disabling nested loops took about 3,616 ms.
Those variants did not improve the path. The two unchanged serial reads alone
exceed the handler's three-second deadline, so stage 5 stays blocked even
with the new facet summary. Optimize and prove the full representative path
before any ranked flag or migration promotion.
At 2026-09-23 01:48 UTC, the uncommitted candidate has a further `100024`
identity cache maintained by source/alias/projection triggers, a conservative
overlapping-stream pending query, and one coverage pass that also verifies
volume projection readiness. Direct identity and alias mutation tests, the
full Discovery SQL set, and the broader `go test ./internal/analytics/...`
suite passed against a disposable PostgreSQL 16 database. The first broad
attempt failed only because the fixture safety gate requires a test-named
database; rerunning with that name passed. A populated disposable `100024`
DDL rehearsal (78,521 projections, 91,462 days, 100,000 moments) took about 0.6 seconds
with six user triggers and valid indexes. It is not hosted lock evidence.
Read-only hosted shape probes, with the not-yet-deployed identity predicate
replaced by a permissive predicate, took 177 ms for pending and 1,420 ms for
coverage. The cutoff-day raw-minute branch had no rows in that sample. The
full ranked request and post-reprojection facet/page queries remain unproven
at hosted scale; stage 5 is still blocked until they fit the agreed budget.
Source review also found that distant hot minutes from one long broadcast
were merged into a single rollup envelope spanning their quiet gap. The
backend candidate now preserves disjoint ranges; focused and full analytics
package tests pass. Hosted impact is not measured.
At 2026-09-23 02:14 UTC, the disposable facet scale harness was updated to
run the candidate's cached-public-identity query shape. With 91,462 day rows
and 274,386 facet rows it took 247 ms without cutoff groups; with 128,016
seeded cutoff-day moments and the actual stream/offset index shape it took
381 ms and included 118,872 rows before the cursor cutoff. The partial-day
plan used about 418,000 shared buffer hits. This supersedes the older 466 ms
old-identity-join shape as a
local comparison, but still does not prove the full hosted three-second
request, concurrent load, or retained-source reconciliation.

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
| Backend | `docs/discovery-ranked.md`, `docs/discovery-catalogue.md`; proposed `docs/discovery-ranked-calibration.md` | Volume contract/readiness evidence; separate later Relative calibration |
| Backend | `internal/analytics/discovery_api.go`, `discovery_ranked.go`, `discovery_ranked_read.go`, `discovery_projection.go`, `discovery_projector.go`, `discovery_indexer.go` | Only audit-proven catalogue/scoring/read changes |
| Backend | `migrations/100014_ranked_discovery.up.sql`, `migrations/100014_ranked_discovery.down.sql` | Review dependencies and reversibility; do not rewrite applied migrations |
| Backend | `internal/analytics/discovery_ranked_test.go`, `discovery_ranked_sql_test.go`, `discovery_indexer_test.go`, `discovery_scale_test.go`, `discovery_browser_test.go` | Focused regression, realistic database and integration proof |
| Portal | `streampulse-web/src/lib/discoveryRanked.ts`, `discoveryCatalogue.ts`; `src/hooks/useDiscoveryCatalogue.ts`; `src/routes/analytics/AnalyticsMomentsPage.tsx` under `streampulse-web/` | Contract consumption and eventual default change |
| Portal | `streampulse-web/tests/discoveryRanked.test.ts`, `discoveryRankedState.test.tsx`, `rankedExplore.test.tsx`; `tests/e2e/discovery-ranked.spec.ts`, `moments-hosted-availability.spec.ts` under `streampulse-web/` | Existing regressions; availability test expectations must evolve with approved serving state |
| Portal | Proposed `streampulse-web/tests/e2e/moments-readiness.integration.ts` and dedicated local Playwright config | No-interception real full-stack acceptance, distinct from fixture suites |
| Ops | Existing deployment evidence convention `docs/deployments/YYYY-MM-DD-<tag>.md` | Private audit, exact release inventory, approvals, smoke and recovery evidence |

No speculative scorer implementation or migration number is prescribed. Evidence-gated code changes require a narrow follow-up implementation task with a failing regression first; select a new migration number only against the approved release inventory.

## Execution Order

For the approved first release, stages 1 and 2 can run in parallel; stage 3 depends on 1/2, stage 5 on the relevant stage-2/3 release inputs, and stage 6 on 3/5. Stage 7 requires 1-3/5/6 and separate release authorization; stage 8 validates each production activation before the next one proceeds. Stage 4 records the already approved volume-first decision and describes later Relative calibration, which does not gate volume. No volume activation precedes representative observed-count lineage, completed-day certificate, projection/capacity, query/load, recovery, and real-data acceptance proof. Dated Top-first execution updates below remain historical evidence and do not reinstate a Relative-score prerequisite for volume.

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
4. Check measured zero versus no measurement, event-time category versus current creator category, source correction/deletion behavior, and scheduler freshness. Keep uncalibrated Relative scores unset; historical chronological browsing does not prove volume eligibility.

**Output / go:** Real catalogue acceptance matrix and either a tested narrow repair or an evidence-backed configuration-only proposal. **No-go:** unavailable data or 503 cause unresolved; request acquisition/configuration authorization at the boundary. Production catalogue restoration remains pending stages 7/8.

### 4. First-Release Volume Decision and Later Relative Calibration

**Owner:** Backend scoring owner for later Relative work. The user has already approved observed IRC volume for the first release and hiding Relative until certified. **Dependency for later Relative work:** stage 2 input provenance; offline research on already-approved data can run in parallel with stages 1/3.

The first release orders detector-selected moments by observed IRC chat per minute. It makes no claim to cross-stream reaction quality or complete coverage of busy minutes. The current backend read contract serves only `sort=volume`; `sort=top` remains unavailable. The following calibration work is required before a separate Relative/Top release, not before the volume release:

1. Write `docs/discovery-ranked-calibration.md` with public-IRC/consented source eligibility, exact input hashes/revisions, source retention and preprocessing rules, scorer configuration/version, and reproducible experiment commands. Acquire additional representative samples only after explicit approval; keep private/raw data outside public docs.
2. Before tuning, freeze train/calibration/held-out splits separated by channel and time, with channel-size, category, activity, duration and incomplete-coverage diversity. Specify numeric minimum channels/streams/measured minutes per stratum and held-out set, evaluation labels/reference judgments, uncertainty bounds, cross-stream comparability criteria, and rank-stability tolerances for append/extreme-minute/reprocessing tests. Obtain review of those values before running acceptance; insufficient evidence is a failed gate, not a smaller post-hoc threshold.
3. Evaluate the existing scorer against the frozen criteria and an honestly named raw-volume baseline. Test leakage, dominance by large channels, missing-data effects, rank sensitivity, and stability across held-out periods. Report pass/fail per criterion, not merely aggregate averages.
4. If it passes, specify the exact certified version, eligibility rule, minimum evidence, score explanation, data manifest and validation reference. Implement only the reviewed backend projection contract, then verify finite persisted scores and eligibility on representative data; a validation-reference string alone is not certification.
5. If it fails, keep Relative/Top unavailable and present the evidence before proposing any new metric. Continue the already approved volume path only if its own independent lineage, certificate, load, recovery, and real-data gates pass. Do not invent a replacement scorer or certify the current one by assumption.

**Output / go for a later Relative release:** Reviewed, reproducible held-out evidence and an approved score/eligibility contract actually populated locally. **No-go for Relative/Top:** any unmet criterion keeps that ordering unavailable. The first volume release has its own stage-3/5/6/7/8 gates and remains unproved until they pass.

### 5. Database, Load and Regression Readiness

**Owner:** Backend, with ops migration/recovery review. **Dependencies for volume:** stages 2/3; later Relative acceptance also uses stage-4 artifacts.

1. Compare migration inventory and checksums to stage 1's actual hosted ledger. Locate and confirm the owning applied-migration policy before edits; the inspected guides do not establish permission to rewrite applied SQL. Preserve applied migrations; use a new additive migration for required corrections. Review the full dependency chain from that observed ledger through every proposed additive volume certificate, facet and identity migration; treat the later priority-queue migration as its separate release contract. Check worker/old-image compatibility, locks and index build behavior.
2. On an isolated representative restore, capture row distributions, heavy JSON payloads, skewed categories, missing/volume-eligible fractions and retained source minutes. Run `EXPLAIN (ANALYZE, BUFFERS)` for the actual volume-ranked, facet, eligibility, coverage and catalogue queries across day/30-day completed UTC scopes, creator/category filters and late pages. Record plans and timings; synthetic 4k evidence is insufficient.
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

**Owner:** Backend and portal. **Dependencies for volume:** stages 3/5; explicit permission for any additional acquisition. Stage 4 is required only for a later Relative acceptance.

1. Bring up the isolated populated backend at canonical `http://localhost:8081` and portal through the documented `npm run dev:local` with `VITE_ALLOW_LOCAL_BACKEND=1`. Confirm the actual local launch entrypoint first: the owner guide still labels `make up` as planned, so do not treat it as a working command. Never route BFF traffic to the watch service. Use detached servers with redirected logs and a finite readiness check; do not kill occupied services.
2. Run and complete the existing `playwright.moments-readiness.config.ts` no-mock integration spec against the real local API and an approved representative corpus. Its current preflight requires an independently hashed reconciliation manifest and fails closed before browser work while that input is missing. Extend its current three-page/three-viewport proof to the required category, coverage, source and concurrent-generation matrix; do not count an unexecuted scenario as a pass. No route interception, fixture shim, prebuilt response injection, synthetic certification or hosted pass-through. The synthetic database browser harness remains separate evidence.
3. Exercise explicit Explore, History, Latest, Saved, exact detail and Back/refresh. Reconcile filters/facets/ranks/coverage and more-than-ten results, reaching at least the 101st ranked result in the approved scope, against the same database snapshot. Verify cursor invalidation preserves old rows until explicit refresh and never mixes generations.
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

The last command is mocked regression evidence only. The existing dedicated no-mock command, from `streampulse-web` after starting the isolated local backend and `dev:local` portal and supplying the approved manifest and its independent SHA-256, is:

```text
npx playwright test --config playwright.moments-readiness.config.ts --max-failures=1
```

It currently fails closed at manifest preflight because those approved inputs do not exist. Missing/skipped full-stack acceptance is a blocker, not permission to reuse synthetic results.

**Output / go:** Reproducible real-data browser/API/database report, screenshots and clean applicable checks on release inputs. **No-go for volume:** mocks, missing or misattributed observed counts, an unproved completed-day certificate, unexplained missing records, source misidentity or failed interaction. Nil Relative scores neither certify nor block volume. No production changes are authorized by local success.

### 7. Explicitly Authorized Promotion and Separate Activations

**Owner:** Ops; backend supplies artifact/schema contract, portal owns its release. **Dependencies for volume:** stages 1-3/5/6, with the first-release decision recorded in stage 4; fresh audit if inputs changed. A later Relative release additionally requires the stage-4 calibration gate.

1. Request deployment authorization naming exact approved revisions, immutable image tags/digests, migration inventory, backup/restore proof, intended flags, smoke matrix, resource/error/freshness thresholds and previous known-good images. Match analytics/migrate/workers to the same backend release; preserve the unrelated watch release. Do not publish images or commit to obtain these without authorization.
2. Ops follows its existing private preflight and image-only deployment workflow: clean approved ops revision, validated compose with no source build, and a fresh receipt bound to revision/tags/configuration. Reissue preflight when inputs change. Use existing CI only, with no new Chromium Actions jobs or bypasses. Keep operational commands in the ops runbook.
3. First authorized deployment keeps both discovery read flags off and explicitly reviews indexer state; any worker enabling/reprocessing is a separately approved mutation. Confirm migration clean state, exact running revision and general health using existing production smoke and hub IRC verification, not repeated process polling.
4. Request distinct catalogue/index activation approval specifying work bounds and scope. Validate production catalogue via stage 8 before proceeding. Artwork/media activation and capacity changes are not implied.
5. After separately approved catalogue/indexer activation, request another explicit approval for any bounded reprocessing needed to obtain a completed-day proof, naming its scope and stop conditions. Observe the verifier-generated certificate and reconcile real production observed-count lineage, projection-version/volume-eligibility, queue/freshness and representative read budgets against the approved volume contract. Only then request distinct `sort=volume` ranked-read activation approval. Specify exactly which mutation each approval permits; certification is an observed verifier result, not a manually asserted flag. Enabling `PULSE_DISCOVERY_RANKED_READ_ENABLED` alone does not prove those facts. Keep `sort=top` unavailable; its future calibration/reprocessing and activation require a separate contract and approval.

**Output / go:** Private release record with approvals, immutable provenance, backup, fresh preflight receipt, smoke and rollback/stop decisions for each transition. **No-go:** any threshold violation pauses rollout; follow the preapproved flag-off/recovery path, recording schema/data implications. Do not promise that an image rollback reverses migrations. No capacity expansion is included; applicable current ops policy remains controlling.

### 8. Verify Production User Outcome, Then Change the Default

**Owner:** Ops records runtime/data evidence; backend reconciles contracts; portal verifies user route. **Dependencies:** stage 7 incrementally, with new approval for portal publication/default change.

1. After catalogue activation, verify real day/category/creator scopes beyond ten results and real continuation beyond the first 50-item page. Compare calendar/facet totals to stored facts; distinguish partial coverage, missing measurements, measured zero, exclusions and out-of-retention. Failure stops ranked activation.
2. Before volume-ranked activation, reconcile representative observed IRC counts, projection version, volume-eligibility totals, completed-day certificate/generation and one ranking version to approved inputs. After activation, verify `sort=volume` API ordering, disjunctive facets, Yesterday/week/custom completed UTC bounds, today's still-open date as unavailable, ties and consecutive ranks across pages, and snapshot invalidation/refresh under naturally occurring updates. Test destructive correction cases locally, not by mutating production for a screenshot. Do not require or claim certified Relative scores.
3. Confirm missing volume measurements are excluded rather than coerced to zero, measured zero remains eligible, unavailable versus healthy empty is distinguishable, and the volume eligibility diagnostic reconciles. Verify representative source availability and exact selection/playback where available; unavailable footage must remain honestly unavailable. Do not claim all detections have playable sources; confirm Relative/Top stays unavailable.
4. Run read-only live browser acceptance on explicit `?view=explore` using the actual hosted API, without interception or backend overrides, at 390/768/1440px. Update the old availability test, whose expected 404/503 states are now historical, without weakening its no-mock boundary. Record requests, timestamps, screenshots and real pagination/category/date/detail/Saved behavior.
5. Observe within a bounded, preapproved ops-policy window covering relevant index sweeps, refresh and load conditions. Record start/end, cadence and error/freshness/resource stop thresholds before starting. Do not invent a 30-minute sufficiency claim or confuse preflight receipt lifetime with soak. If capacity is touched, its separate policy applies; a shorter Moments check cannot satisfy that policy.
6. Only after the preceding live gate passes, request the portal default change/release. Add the bare-route Explore regression, preserve explicit Latest/History/Saved, the separate `/analytics/explore` route until its replacement works, and honest failure recovery, then run portal checks and authorized publication. Repeat actual live browser acceptance on `/analytics/moments` with no `view` override and smoke the retained Explorer route. If either fails, use the approved portal recovery and leave completion open.

**Output / go:** Approved observation evidence plus a healthy bare user route serving real volume-ranked results, meaningful category/date browsing, stable pagination beyond the preview, and honest source/coverage states. **No-go:** feature-empty data masquerading as readiness, unresolved volume lineage/certification, or route/default failure. A passing health check, flag toggle or Latest fallback never auto-completes this plan.

## Pending Checklist and Completion Rule

- [x] 1. Authorized read-only hosted audit and supported diagnosis recorded; signed running-source binding verified in follow-up.
- [x] 2. Intended changes/dependencies isolated without losing unrelated WIP; working deltas are hashed, not committed/published.
- [ ] 3. Representative real historical catalogue acceptance passed.
- [x] 4. First-release observed-volume decision approved; Relative/Top remains hidden and requires separate future calibration. This decision does not prove volume eligibility or certification.
- [ ] 5. Migration, representative plans/load, recovery and broad regression gates passed.
- [ ] 6. Real no-mock local full-stack acceptance passed.
- [ ] 7. Deployment and each activation separately authorized and evidenced.
- [ ] 8. Actual production data/browser observation passed; authorized bare-route Explore verified.

Backend volume deployment-ready means stages 1-3/5/6 plus the stage-4 first-release decision and a reviewable promotion/recovery packet, not deployed. The first-release user outcome is complete only when stages 1-3/5-8 pass with evidence tied to actual release inputs. Relative/Top remains a separate no-go until its own stage-4 calibration and later release gates pass. Catalogue-only progress does not complete volume Explore.

## Execution Update: 2026-09-13

Implementation/read-only audit authorized in the continuation request. Production
mutation/publication remains unauthorized. No commits, staging or pushes performed.
Private evidence: ops `docs/deployments/2026-09-13-ranked-moments-readiness-audit.md`.
Scoring decision: backend `docs/discovery-ranked-calibration.md`.

| Phase | Actual progress and remaining gate |
| --- | --- |
| 1 | Read-only audit executed. Reads are now enabled; History still 503 and Explore 404. Actual reader SQL timeout reproduced, but running source attestation remains unresolved. |
| 2 | Existing isolated backend d1c3cc1 identified and built; narrow readiness delta/content-manifest utility added there. Correct candidate migration is 100018 after current ledger 100017. Original dirty 100014 is not a deployable migration input. Portal release isolation remains incomplete. |
| 3 | PostgreSQL identity-query flattening reproduced on actual stored data; correlated-query experiment returned 51 rows in 160ms versus original 3s timeout. Failing local plan regression added then fixed. Full representative API/projector/category reconciliation remains blocked, not passed. |
| 4 | Reproducible scorer diagnostics and proposed numeric evaluation freeze recorded. Append changed 40/60 prefix scores, max delta 19; no reviewed real held-out corpus/labels. No metric change or certification made. User review required. |
| 5 | Ranked SQL/migration and race discovery tests pass. Broad no-integration suite passes. Broad integration suite fails; several failures reproduced on parent, collector minute-boundary timing test fixed. Representative restore/load/recovery and remaining broad failures still gate release. |
| 6 | Separate no-mock config/spec added; execution fails explicitly on absent approved real-data reconciliation manifest, not skipped/passed. Typecheck/build/overlap, 26 focused tests, eight mocked E2E and one actual-hosted-API fallback check pass on original portal WIP only. Full real-data interaction/source matrix remains incomplete. |
| 7 | Not authorized; no candidate image provenance, deployment or activations. |
| 8 | Not activated; bare route remains Latest. No live Top claim or default change. |

Dedicated local acceptance command, from `streampulse-web`:

```text
npx playwright test --config playwright.moments-readiness.config.ts --max-failures=1
```

The command now fails in global preflight before launching a browser when the
manifest/digest is absent or invalid, the dedicated local BFF has no JSON health
response and HTTP 200 `/readyz` database readiness on port 8081, or the
isolated portal is unavailable. The browser gate
then permits API GETs only to `localhost:8081` or `127.0.0.1:8081`; both are
loopback spellings used by the documented local launchers. This preflight is a
diagnostic, not approval of the manifest's references or real-data content.

Requires a separately started isolated `dev:local` portal and actual backend on
`http://localhost:8081`, plus `MOMENTS_READINESS_MANIFEST` and its independently
recorded `MOMENTS_READINESS_MANIFEST_SHA256`. The JSON manifest requires
`dataClass=approved_real_stored_irc`, approval/database-snapshot references,
rankingVersion, a fixed 1–30-day `period=custom` volume Explore path with
explicit UTC `from`/`to`, and >100 independently queried ordered ranked IDs.
It supplies expectations only, never API responses or synthetic
certification. A label/reference alone is not proof of approval. Optional
`MOMENTS_READINESS_PORTAL_URL` selects a loopback-only portal. Existing 5173 was
reused for regressions and not reconfigured or restarted.

The harness requests three logical real collection pages and checks at least
the 101st ordered ID, the exact frozen completed-day scope, the
`/ranked/availability` certificate boundary, API and rendered-row rank/ID/version
order, Saved-item persistence after a reload, detail, Back/refresh and three
viewport captures once valid inputs exist. Its network guard rejects hosted or
mutating data requests, including browser fetch/XHR paths outside `/v1/`.
It does not yet replace the remaining full phase-6 per-day database count,
category/coverage/source and concurrent-generation acceptance scenarios. Those
depend on the approved corpus and volume reconciliation contract and remain
explicit work, not implicit passes.

## Independent Follow-Up

Completed without production mutations or commits:

- Running source is now bound to parent backend 1453952 by the signed v0.2.65
  release manifest and receipt, both verified offline with exact Cosign identity
  and issuer. Private ops evidence holds the runtime details.
- Complete database-enabled parent/candidate runs have the same 55 failure
  records (53 top-level tests plus two subtests), with zero candidate-only
  failures. Exact assertions are in backend
  `docs/discovery-readiness-db-comparison.json`. Broad acceptance remains failed;
  baseline defects were preserved, not weakened or treated as a clean suite.
- Portal 4f1b912 was reproduced in a fresh detached checkout with independent
  root/portal lockfile installs and freshly rebuilt Pulse packages. The exact
  conservative input closure is [ranked-portal-inputs.json](2026-09-13-ranked-portal-inputs.json).
  Two stale browser locators were corrected. A failing screenshot-derived
  regression then led to scoped CSS repairs for leaked screen-reader-only text,
  duplicate Save text and the five-tab selection layout. The same narrow delta
  exists in the owning ranked portal worktree and its verification checkout.
- Isolated portal typecheck/build/overlap, 67 focused tests and all eight ranked
  mocked browser cases pass. This is now isolated source/dependency evidence,
  not only the original dirty portal. It remains mocked ranking evidence.
- Full synthetic schema backup/list/restore and migration 100017 -> 100018 ->
  100017 -> 100018 pass on original and restored disposable databases. A second
  test preserves 120 synthetic detector results and cursor signing state.
- The full synthetic catalogue HTTP handler, including all queries/encoding,
  returns 50 rows from 50,000 moments in about 21ms / 21,131 bytes. This is not
  the production endpoint budget. Race discovery/recovery tests pass, as do
  migration checksum validation and nine existing migration-plan tests.
- Aggregate-only ended-source inventory confirms retained input exists but the
  bounded recent sample lacks large-channel diversity. No identifying source
  records or raw chat were exported; no calibration run/certification occurred.

Phase 5 remains blocked by baseline suite defects plus representative-data and
deployment-budget/recovery gates. Phase 6 remains blocked by approved real
scoring/corpus evidence. Phases 7/8 still require their separate authorizations.
The new hashed backend/portal working deltas require an explicitly authorized
commit and image/publication process before they can be immutable release inputs.

## Non-GitHub Local Continuation

This continuation is restricted to local readiness preparation. No workflow,
external GitHub state, commit history, production configuration or deployment
was inspected or changed. Existing historical evidence above was not refreshed
into a new production-state claim. No new hosted probe was needed: the prior
reader-timeout diagnosis already provides a local regression; another HTTP
status alone would not establish whether that diagnosis still describes hosting.

- Reviewed the candidate's `docs/discovery-readiness-db-comparison.json`: 55
  failure records are shared, with empty candidate-only and parent-only lists.
  Assertions include missing schema columns/tables, fixture foreign-key and SQL
  parameter failures, and behavior/count mismatches. No candidate-only repair is
  justified by this report. The broad database suite remains failed; it was not
  rerun or relabeled as passing in this continuation.
- The isolated backend adds `scripts/discovery-calibration-inputs.py`,
  `scripts/test_discovery_calibration_inputs.py`, and
  `docs/discovery-calibration-inputs.md`. Preflight checks digest-bound JSON,
  identity/source uniqueness, channel/time split separation and minute bounds.
  It cannot certify scores, verify source authorization, or substitute for the
  later portal/database reconciliation manifest. Proposed minima are not lowered
  or treated as approved. No real-data manifest/export/evaluation was produced.
- Cross-checked the isolated portal/backend contracts: Top-only, at most 31 UTC
  days with exclusive API `to`, 50-item client pages, finite scores, matching
  versions, separate missing-category identity, eligibility reconciliation and
  continuation metadata guards. Main checkouts additionally contain independent
  volume/year-range WIP on both sides. That WIP was preserved and is not covered
  by the isolated candidate evidence or approved as a replacement Top metric.
- Verification: eight new Python unittest cases pass after first failing on the
  absent validator; both focused Go scorer diagnostic/ineligibility tests pass;
  nine additional Go query/cursor/projection/handler contract tests pass. A
  deliberately invalid CLI input returns `invalid_input` with `certified=false`.
  The 26 focused portal tests pass in the ranked worktree. Portal output includes
  React `act(...)` warnings and resolves dependencies from the main checkout;
  this run is not a fresh independent dependency-closure build. The earlier
  independent build evidence is not reissued for these new working files.

Exact remaining non-GitHub blockers:

1. User/scoring-owner review of metric meaning and ended-only/live policy, the
   proposed numerical freeze/rubric, plus exact split dates, category roster,
   bootstrap seed, pair selection, ties and missing-label rules. Current
   stream-relative score remains uncertified; real Top eligibility stays blocked.
2. Authorized private retained-input scope/destination and an independently
   verified representative corpus, including large-channel diversity, labels and
   complete preprocessing/emote evidence. No further acquisition is implied.
3. Real catalogue reconciliation, representative query/load budgets and recovery
   evidence, plus disposition of the shared broad-suite failures. Synthetic
   timings and migration rehearsals remain insufficient for these gates.
4. Approved calibrated persisted results and a real database reconciliation
   manifest for the no-mock full-stack category/coverage/source/pagination matrix.
   No fixture certification or healthy empty scope can replace this input.

No gate checkbox changes. Production diagnosis beyond safe public reads and any
production action remain outside this continuation's authorization. Latest remains
the isolated candidate's bare-route fallback, not completion of Explore.

**First-release interpretation (2026-09-24):** The preceding dated blocker list
and its "No gate checkbox changes" line record the original Top-first path. The
normative checklist above now checks only the approved metric decision. Its
scorer rubric, held-out labels and
calibrated persisted scores gate only a later Relative/Top release. For the
approved volume-first release, the open gates are authorized real stored-IRC
input and independent reconciliation, observed-count lineage, completed-day
certificate, catalogue/queue and source-write capacity, representative full
handler load, the no-mock category/coverage/source matrix, and separately
approved hosted activation and smoke. This clarification passes none of those
gates and does not change the current **BLOCKED** release status.
