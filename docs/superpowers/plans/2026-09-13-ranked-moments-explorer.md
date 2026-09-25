# Ranked Moments Explorer Implementation Plan

Remaining readiness work is tracked in the [Ranked Moments Readiness continuation plan](2026-09-13-ranked-moments-readiness.md). It separates catalogue recovery, scoring calibration, release isolation, and explicitly authorized production verification; all future stages remain pending.

## Availability Correction: 2026-09-13

This correction supersedes Task 5's bare-route Explore default until hosted
ranking is actually ready. `/analytics/moments` now opens **Latest**, the existing
unranked live preview, not a chronological full catalogue or a substitute Top
ranking. Explore remains deliberate via `?view=explore`; tab navigation writes
that parameter explicitly. Empty Saved discovery returns to Latest. Explicit
History and legacy history URLs remain intact.

Read-only hosted observations at approximately 19:58 UTC:

- `/v1/public/hub?activityWindow=30m`: HTTP 200, 10 supplied live detections;
  the real local portal displayed 10, newest-first, without rank badges.
- `/v1/public/discovery/ranked?from=2026-09-13&to=2026-09-14&sort=top&limit=50`:
  HTTP 404, plain-text `404 page not found`. The portal identifies the ranked
  feature as not deployed, separately from HTTP 503 and healthy empty results.
- `/v1/public/discovery?month=2026-09&limit=50`: HTTP 503
  `discovery_unavailable`. History is not a working full-catalogue fallback.
- Explore and History offer **Browse Latest moments** recovery. Explore also
  links live activity. Neither failure silently substitutes unranked rows.

Verification executed for this correction:

- Regression red: five expected failures for bare-route/Saved defaults, distinct
  404/503 handling, and History recovery, before implementation.
- Focused Vitest: 79 passed across ranked transport/state/UI, catalogue,
  navigation, presentation, and route smoke. Route smoke emits JSDOM's
  `window.scrollTo` not-implemented diagnostics; assertions pass.
- `npm run typecheck` and `npm run build:ci`: passed; build includes the
  analytics overlap, routes, links, public-page and backend-origin checks.
- `discovery-ranked.spec.ts`: 8 mocked Playwright tests passed, with explicit
  Explore URLs, including 390/768/1440px, pagination and exact detail behavior.
- `moments-hosted-availability.spec.ts`: 1 real Playwright test passed against
  the existing `http://127.0.0.1:5173`, using the hosted API with no interception,
  fixture, clock override, backend override, or API mutation. It checked default
  routing, first-screen results at 390/1440px, no initial discovery request,
  actual 404/503 states, and recovery to Latest from both.
- Live screenshots: `streampulse-web/artifacts/moments-live-availability/`.
  The live check is explicitly opt-in with `PORTAL_LIVE_AVAILABILITY=1` and
  `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173`; it intentionally depends on current
  hosted availability and nonempty feed data, not deterministic CI fixtures.
- Repository-wide `git diff --check` reports an unrelated existing trailing
  blank line in `tests/pastVods.test.ts:161`; that WIP was not edited.
- Initial live runner attempt skipped because the opt-in environment did not
  reach the runner; the next attempt exposed a selector mismatch with the CSS
  arrow in link accessible names. Corrected selector and explicit environment
  forwarding produced the passing live result above.

**Remaining blocker:** Actual Top results are not restored. The route is absent
on hosted, and local backend production projections deliberately remain
ineligible without real cross-stream calibration/certification. Authorized
backend release/migration/activation and certification remain separate gates.
No deployment, production flag, scoring, schema, or backend configuration was
changed by this correction. Existing unrelated WIP was preserved.

> **For the AI agent working this:** Required sub-skill: use executing-plans to implement this plan task by task.

**Goal:** Implement the approved `/analytics/moments` Explore experience and its backend-owned ranked discovery contract without client-side ranking or false coverage claims.

**Architecture:** Extend the existing discovery projection and exact-moment detail path. The backend persists the canonical scorer output/version and serves one UTC-bounded, snapshot-bound ranked read with disjunctive facets and keyset pagination; the portal consumes that contract through the existing Moments workspace and preserves Latest, History, Saved, exact playback checks, and local Saved storage.

**Tech stack:** Go, PostgreSQL migrations, pgx, React, TypeScript, Vite, Vitest, Playwright.

## Files

- `streampulse-backend/internal/analytics/discovery_api.go`: ranked query parsing, response, facets, cursor and route.
- `streampulse-backend/internal/analytics/discovery_projection.go`: persisted scorer/version and eligibility projection fields.
- `streampulse-backend/migrations/100014_ranked_discovery.up.sql`: additive ranking persistence/indexes.
- `streampulse-backend/migrations/100014_ranked_discovery.down.sql`: rollback.
- `streampulse-backend/internal/analytics/discovery_ranked_test.go`: unit and contract coverage.
- `streampulse-backend/internal/analytics/discovery_browser_test.go`: database/browser ranked acceptance additions.
- `streamclone-pulse/streampulse-web/src/lib/discoveryCatalogue.ts`: ranked DTO validation and request transport.
- `streamclone-pulse/streampulse-web/src/hooks/useDiscoveryCatalogue.ts`: scope/query/pagination state.
- `streamclone-pulse/streampulse-web/src/routes/analytics/AnalyticsMomentsPage.tsx`: `/analytics/moments`, four tabs, Explore defaults and controls.
- `streamclone-pulse/streampulse-web/src/ui/components/moments/MomentCategoryBrowser.tsx`: disjunctive category facets and reset.
- `streamclone-pulse/streampulse-web/tests/discoveryRanked.test.ts`: client contract tests.
- `streamclone-pulse/streampulse-web/tests/e2e/discovery-ranked.spec.ts`: mocked responsive browser acceptance.

## Task 1: Establish the backend contract with failing tests

**Files:** `internal/analytics/discovery_ranked_test.go`, `internal/analytics/discovery_api.go`.

1. Add tests for UTC parsing: inclusive displayed dates represented as exclusive `to`, `from` through current UTC date, `to` through tomorrow midnight, Monday-to-tomorrow week, and 1..31 displayed-day spans.
2. Add tests for exact category and mutually exclusive `categoryMissing` behavior; reject a real category that normalizes to the reserved unknown token.
3. Add tests asserting disjunctive facets use the full time+creator scope and retain a selected zero category.
4. Add cursor tests for ordering `(score DESC, occurred_at DESC, id DESC)`, scope/as-of/version/generation binding, tampering, expiry, and generation invalidation.
5. Run `go test ./internal/analytics -run 'TestDiscoveryRanked|TestParseDiscovery' -count=1` and record the expected compile/test failures before implementation.

## Task 2: Persist canonical ranking evidence

**Files:** `migrations/100014_ranked_discovery.up.sql`, `migrations/100014_ranked_discovery.down.sql`, `internal/analytics/discovery_projection.go`.

1. Add nullable `ranking_score double precision`, `ranking_version text`, and `ranking_eligible boolean NOT NULL DEFAULT false` to the discovery projection, with finite-score and version consistency checks.
2. Add an index matching the ranked read predicate and ordering, scoped by occurrence time and exact category metadata.
3. Update the projector to persist only finite output from the existing heatmap scorer, persist the scorer’s actual version, and mark missing/unvalidated cross-stream-comparable output ineligible.
4. Keep unknown event category as nullable measured-segment metadata plus an explicit missing-category predicate; do not infer a creator’s current category or invent IDs.
5. Add projector tests for finite/NaN/Inf/missing output, version persistence, exact category segment selection, and reprocessing stability.
6. Run `go test ./internal/analytics -run 'TestDiscovery.*Projection|TestDiscoveryRanked' -count=1`.

## Task 3: Implement ranked reads and route wiring

**Files:** `internal/analytics/discovery_api.go`, route registration file identified by existing discovery registration, `internal/analytics/discovery_ranked_test.go`, `internal/analytics/discovery_browser_test.go`.

1. Parse `from`, exclusive `to`, `category`, `categoryMissing`, `sort=top`, `limit` 1..100, and opaque cursor with the approved UTC and 31-day bounds.
2. Read one repeatable-read snapshot and catalogue generation. Compute disjunctive facets from the full time+creator scope before selected category filtering and page limiting; include measured categories with ineligible detections and selected zero categories.
3. Select only eligible finite canonical scores for Top; return the persisted ranking version and score explanation. Refuse ranked mode when cross-stream comparability is not validated.
4. Apply exact category predicates, including the mutually exclusive nullable missing-category predicate, then keyset paginate using the complete stable ordering key.
5. Sign cursors with the existing shared generation/signing-key mechanism and bind all scope, snapshot, ranking-version, and ordering state. Return typed unavailable, out-of-retention, invalid cursor, and healthy empty responses.
6. Enforce response byte/concurrency/rate guardrails using existing discovery limits. Ensure reads never materialize, call Helix, enqueue backfill, or start collectors.
7. Run focused Go unit tests and isolated PostgreSQL discovery acceptance when `TEST_DATABASE_URL` is available.

## Task 4: Add portal transport and state

**Files:** `discoveryCatalogue.ts`, `useDiscoveryCatalogue.ts`, client tests.

1. Define validated ranked response types, including coverage, persisted ranking version, facets, category missing state, score explanation, and typed unavailable/empty outcomes.
2. Serialize the four UI periods to UTC `from` and exclusive `to`; reject invalid ranges before transport.
3. Request the complete backend ranked page, append only explicit Load more results from the same snapshot, and preserve old loaded rows when continuation is invalidated until an explicit refresh replaces the snapshot.
4. Never sort, score, deduplicate, or synthesize missing score in the client. Fail closed on malformed rank data.
5. Add tests for URL/query serialization, date boundaries, facets, empty/503 distinction, cursor invalidation, and no first-page-only ranking.

## Task 5: Integrate Explore into the existing Moments workspace

**Files:** `AnalyticsMomentsPage.tsx`, `MomentCategoryBrowser.tsx`, existing Moments CSS/components, route tests.

1. Make `/analytics/moments` canonical with first tab Explore, followed by Latest, History, and Saved. Preserve existing detail routing and `view` compatibility.
2. Default Explore to Today / All categories / Top. Add accessible period/date controls, exact category controls, reset, facets, coverage/freshness disclosure, results, empty/unavailable/error states, and explicit Load more.
3. Restore the visual category browser using backend facets. Keep selected zero categories, expose Unknown only through the mutually exclusive missing-category contract, and never derive facets from loaded rows.
4. Preserve exact moment selection, source verification, replay fallback, stream timeline, Watch on Twitch, ReplayForge handoff, and device-local Saved behavior.
5. Verify no browsing action triggers ingest, backfill, Helix, or ReplayForge job creation. Maintain one analytics mount and existing responsive list/card contract.
6. Add mocked browser coverage at 390/768/1440px for defaults, period/category changes, facets, empty/unavailable, pagination, cursor refresh, exact detail, and Saved.

## Task 6: Verification and release gates

**Files:** existing check scripts only if required by current commands; no production or ops files.

1. Run `go test ./internal/analytics/...` or the narrow package subset after baseline comparison; fix only regressions caused by this feature.
2. Run portal `npm run typecheck`, `npm run build:ci`, `npm run check:analytics-overlap`, focused Vitest, and the documented mocked discovery Playwright suite.
3. Run `git diff --check` in both repositories and inspect scoped status/diff; do not stage or commit.
4. Audit every approved requirement: route/tabs/defaults, UTC bounds, facets, ranking evidence/comparability, cursor snapshot semantics, availability/empty honesty, exact playback, Saved, no autonomous work, and hard limits.
5. Report local evidence separately from hosted truth. Leave `PULSE_DISCOVERY_READ_ENABLED` and any production ranking flag unchanged; no deploy or external contact.

## Self-check

- Every spec section maps to Tasks 1-6: UX/defaults (5), time/coverage (1/3/4), ranking/persistence (2/3), API/pagination (3/4), detail/data flow (5), errors (3/4/5), rollout/risks (6).
- No client scorer, first-page ranking, arbitrary merge, or browse-triggered work is introduced.
- The persisted scorer version and nullable category-missing predicate are used consistently across migration, backend DTO, and portal types.
- The only intentionally runtime-dependent value is the existing canonical scorer version; ranked serving is unavailable until its persisted comparability evidence exists.
