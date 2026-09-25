# Ranked Moments Explorer

**Date:** 2026-09-13  
**Status:** For user review; design only  
**Owners:** `streamclone-pulse` (portal presentation) and `streampulse-backend` (read contract, ranking, persistence)

## 1. Summary

Add a single Moments exploration mode at `/analytics/moments`, using the existing Recent, History, Saved, selection, replay-verification, and watch handoff architecture. The default first tab is **Explore**, with **Latest**, **History**, and **Saved** alongside it; Explore defaults to **Today / All categories / Top**. Users can change the period and exact event category to answer “what were the best measured moments in this slice?” without implying that the result is all Twitch activity or that a detected moment is a playable clip.

This is a ranked catalogue experience, not a second live feed and not client-side sorting of the first 50 records. The backend must return a complete ranked page for the requested scope, with facets computed before pagination and a snapshot-bound cursor. Existing unranked chronological history remains available as History.

## 2. Goals and non-goals

### Goals

- Make Today / All / Top the first useful view.
- Support bounded exploration by exact category and period: Today, yesterday, this week, and a selectable custom range.
- Restore category browsing with a visible gallery/facet row, including zero-result categories and an always-available reset.
- Rank only measured public IRC detections using the existing backend scorer and a documented ranking version.
- Preserve exact detection identity, source verification, playback fallback, local Saved behavior, and stream timeline handoff.
- Make coverage, freshness, partial measurement, unavailable service, empty results, and replay availability distinguishable.

### Non-goals

- No new collector, autonomous ingest, VOD backfill, or browse-triggered materialization.
- No client scoring, “top of loaded page” ranking, or score fabrication for records without a score.
- No semantic merging of nearby detections, cross-stream deduplication, or editorial “best of” claims.
- No clip creation, ReplayForge job creation, account-synced Saved state, or Twitch OAuth.
- No replacement of Latest/Recent, History, or Saved; the explorer shares their existing stack and detail route.

## 3. Existing architecture and ownership

The portal remains a thin client over `streampulse-backend`. `AnalyticsMomentsPage` owns route state and presentation; `useDiscoveryCatalogue` owns transport/normalization; `MomentCategoryBrowser` is the visual category browsing component to restore; existing exact source checks own replay truth. The backend owns SQL, scorer reuse, ranking, facets, coverage semantics, signed cursors, and the feature flag. No portal package may calculate or reorder ranking.

The current `/v1/public/discovery` month endpoint and its `indexed_public_irc_streams` scope remain valid for History. The ranked explorer is a versioned extension or sibling read contract in `internal/analytics`; implementation must reconcile with the current WIP before activation rather than assume that the local WIP is deployed. The portal must continue using the hosted API by default and never use Streamclone watch port `:8090` as a BFF.

## 4. User experience

`/analytics/moments` is the canonical Moments route. Its top-level navigation has four tabs in this order: **Explore**, **Latest**, **History**, and **Saved**. Explore is the default first tab and owns the ranked view. Latest remains chronological/live-oriented, History remains calendar and chronological review, and Saved remains device-local. These tabs share one Moments stack and detail route; Explore is not a parallel page or data stack.

The Explore control bar contains:

- **Period:** Today (default), Yesterday, This week, Custom range.
- **Category:** All categories (default), exact measured categories supplied by the backend facets, and Unknown. Unknown means the event segment category was unavailable; it never means “use the creator’s current category.”
- **Sort:** Top (default for Explore), with chronological only where an existing collection explicitly requests it.
- **Reset:** clears category and custom dates and returns to Today / All / Top.

The category browser is a compact visual gallery/list backed by pre-pagination facets. Facets are disjunctive: their universe is the full eligible time+creator scope before the selected category filter, and each category count is computed independently. The universe includes distinct measured categories present in the scope, including categories whose detections are ineligible for Top; the selected category is retained with count zero when absent. A category selection changes the query and resets its cursor. Artwork is optional display metadata only and may not identify a frame or grant playback.

Rows use the established responsive Moments contract and expose creator, exact occurrence, category, measured reaction values, and the supplied ranking explanation/score label. The UI says “measured” or “detected” where appropriate, never “clip” unless a verified playable source exists. A missing replay mapping remains an explicit unavailable panel. Selecting a row opens the existing exact detail view; it does not merge neighboring detections or start a job.

## 5. Time and coverage semantics

All query boundaries are UTC calendar boundaries, serialized as ISO dates. The date picker displays both selected dates inclusively, while the API represents the displayed end date as the exclusive next midnight (`to = displayedEnd + 1 UTC day`). “Today” and “Yesterday” mean UTC dates returned by the backend, not the browser’s local date. “This week” means Monday 00:00 UTC through tomorrow 00:00 UTC, including Monday through today inclusive. Custom ranges use the same rule. The displayed date difference (`end - start + 1`) must be 1 through **31 UTC calendar days**. The backend accepts `from <= current UTC date`, permits `to <= tomorrow 00:00 UTC`, and evaluates the effective upper bound as `min(to, asOf)`. It rejects a future start or an exclusive upper bound beyond tomorrow with typed validation errors.

The initial release supports only the four periods above. A cross-month request is one server query and one snapshot, not two client month requests. Calendar day facts remain month+creator facts and must not be relabeled as category-filtered counts. If a known indexed-retention boundary exists and the request starts before it, the backend returns typed `discovery_out_of_retention`; if no boundary is available, an old-looking request remains healthy and may return an honest empty result.

The public population is indexed public IRC streams with measured segment coverage, not all Twitch broadcasts. Missing minutes are gaps; measured zero is zero. Partial coverage is disclosed. A successful empty response means the indexed scope was read successfully and contains zero ranked records. HTTP 503 or an equivalent typed unavailable state means the catalogue cannot currently be trusted and must not render the empty state.

## 6. Ranking contract

Ranking is computed once by the backend from the existing heatmap reaction scorer and candidate detector. The implementation must expose the persisted version of that canonical scorer and a human-readable, non-editorial explanation such as “reaction score, measured minute.” The example version below is illustrative only. Raw scores may be compared across streams only after calibration/contract tests establish that property for the reused scorer output; otherwise ranked mode is unavailable rather than presenting a misleading global Top. No second scoring engine or missing-score-as-zero behavior is allowed.

The initial Top order is descending backend score, then `occurred_at DESC`, then stable `dm_` detection ID descending. This tie key is part of the API contract. The backend owns score normalization, eligibility, and any minimum evidence threshold; these values must be documented alongside the version and covered by contract tests. Diversification across creators/categories is explicitly deferred. A future “roundup” mode may add diversification, but it must be a separate named sort with separate acceptance criteria, never hidden inside Top.

Related detections remain separate rows unless an existing exact identity says they are the same detection. No arbitrary time-window merge, same-label merge, or creator merge is permitted. Exact source verification still uses stream identity, broadcast identity, timestamp alignment, and archive duration; rank never bypasses those checks.

## 7. API shape and pagination

The target read contract for this feature is the following new versioned public route. During contract reconciliation, an existing equivalent route may be adopted only if it preserves every field and semantic below; implementation must not silently reuse the chronological month endpoint.

`GET /v1/public/discovery/ranked?from=YYYY-MM-DD&to=YYYY-MM-DD&category=...&sort=top&limit=...&cursor=...`

Response fields:

```json
{
  "schemaVersion": 1,
  "state": "ready",
  "scope": "indexed_public_irc_streams",
  "from": "2026-09-13",
  "to": "2026-09-14",
  "asOf": "2026-09-13T12:00:00Z",
  "rankingVersion": "persisted-canonical-scorer-version",
  "sort": "top",
  "category": null,
  "facets": [{"category": "Just Chatting", "count": 12, "artwork": null}],
  "items": [],
  "nextCursor": null,
  "coverage": {"state": "partial", "indexedStreams": 42, "measuredMinutes": 900},
  "dataThrough": "2026-09-13T11:59:00Z"
}
```

`items` include the existing exact detection projection plus `rank`, `score`, and `scoreExplanation` only when valid. They do not include raw chat, credentials, handoff grants, or a playback URL. `facets` use the full time+creator universe before the selected category filter and before `limit`; they are not derived from the returned page. Missing category uses `categoryMissing: true` and the reserved request token `category=__unknown__`, with response label `Unknown`. A real category name normalizing to `__unknown__` is rejected; existing exact category IDs remain unchanged and no game IDs are invented.

The server default page is 50 and the hard maximum is 100. The client may request at most 100 and must not claim that one page is the full collection. Cursors are opaque, signed, scope-bound, and bind `from`, `to`, category, sort, `asOf`, ranking version, and catalogue generation. They use the complete ordering key `(score DESC, occurred_at DESC, id DESC)`, expire after 24 hours, and reject tampering or generation changes. A changed snapshot stops continuation and retains already loaded rows as the old snapshot; refresh replaces rows and facets with a new snapshot. Old and new pages are never mixed.

The feature is disabled until migrations, projection, representative query-plan checks, and hosted smoke evidence exist. Disabled or failed reads return 503 with `discovery_unavailable` (and `Retry-After` when appropriate), never HTTP 200 with `state=empty`. Empty is reserved for a healthy ready response with zero eligible items.

## 8. Data flow and selected detail

1. Route state serializes the period/category/sort into the URL.
2. The hook requests one ranked snapshot, cancels obsolete requests, and retains the prior usable collection while a replacement loads.
3. The backend returns facets and the first ranked page from one read snapshot.
4. Additional pages append only after explicit user action; polling or filter changes never reorder an actively reviewed selection silently.
5. Selecting a row navigates using the existing exact identity fields. The detail view performs the existing source check and exact recap load, then offers the current Watch on Twitch, stream analytics, and ReplayForge handoff actions where independently authorized.
6. Save writes only existing device-local Saved metadata. Browsing never creates a bookmark, backfill, collector request, or ReplayForge job.

## 9. Error and loading states

- **Loading:** reserve result and facet geometry; do not announce empty.
- **Unavailable (503):** show catalogue unavailable, retry, and last-known freshness if present; do not show zero results.
- **Empty (200 ready):** show scope-specific zero state with Reset and a way to broaden period/category.
- **Partial coverage:** show indexed public IRC scope and measured-minute facts near the collection, not as an obscuring modal.
- **Expired/changed cursor:** discard continuation only, retain loaded rows, and offer refresh.
- **Malformed response:** fail closed as unavailable and report a bounded client error; do not salvage an untrusted rank.
- **Replay pending/failed/unavailable:** use the existing selected-detail states and exact-source language.

## 10. Phased implementation

1. **Contract reconciliation:** compare this design with current backend discovery WIP and release state; settle route/version, schema, score fields, range validation, generation behavior, and feature-flag wiring. Add no activation or deploy change.
2. **Backend read path:** persist/serve ranking fields and eligibility from the existing projector/scorer, implement facets-before-pagination, bounded cross-month query, signed snapshot cursor, typed 503/empty states, and query-plan/scale tests.
3. **Portal integration:** extend the existing discovery hook/types and `AnalyticsMomentsPage`; restore `MomentCategoryBrowser`; add URL state, reset, facets, ranked rows, continuation, and responsive/a11y states without another analytics mount.
4. **Exact review regression:** retain source checks, selected detail, saved local behavior, stream timeline, and ReplayForge handoff tests; verify no row action triggers ingest/backfill/job creation.
5. **Local evidence:** run focused Go and portal tests, `typecheck`, `build:ci`, overlap check, and the existing mocked discovery browser suite at 390/768/1440px. Database acceptance requires an isolated `TEST_DATABASE_URL` and is not replaced by unit tests.
6. **Activation gate:** keep the read flag off until representative data/query plans, freshness, rate limits, payload size, cursor invalidation, and hosted 503/empty/ranked smoke evidence are recorded. Deployment and flag activation require separate authorization.

## 11. Acceptance criteria and test plan

- Today / All / Top is the default URL state and produces a backend ranked request.
- Changing category, period, or sort resets continuation and never ranks only loaded records.
- Facets include zero-result categories within the healthy scope and include Unknown when applicable; Reset is always available.
- Today, Yesterday, Monday-based This week, 31-day custom range, invalid/future dates, and cross-month ranges have explicit contract tests.
- Ranking is stable across repeated reads at one generation; score ties follow the documented three-key order; no missing-score item appears as a ranked zero.
- Cursor tampering, wrong scope, expired cursor, generation change, and ranking-version change fail closed without duplicate/skip continuation.
- Healthy empty, 503 unavailable, stale/partial coverage, malformed response, and retry states render distinct accessible UI.
- Exact category is taken only from the event segment; unknown is never inferred from current stream metadata.
- Existing selected detail verifies the exact source and never claims playback from rank or artwork; unavailable playback remains actionable but honest.
- Saved remains device-local; browsing does not invoke ingest, backfill, Helix, or ReplayForge job creation.
- Portal overlap check passes with one analytics stack; responsive browser coverage passes at 390, 768, and 1440px without horizontal overflow.

## 12. Rollout gates and risks

The feature remains dark until the backend migration/projector is reconciled with the current release, isolated database tests pass on representative distributions, public edge rate controls are confirmed, and hosted smoke proves both ranked readiness and fail-closed disablement. Local synthetic acceptance is evidence of wiring only, not hosted readiness. No production flag activation is part of this spec.

Material risks are ranking credibility when evidence is sparse, query cost for cross-month facets, stale category/art metadata, cursor invalidation during projection refreshes, and users interpreting detections as playable media. Mitigations are backend-owned eligibility/versioning, hard range/page limits, snapshot cursors, explicit coverage/source language, and the existing exact playback verification.

## 13. Open review decisions

This spec intentionally fixes the product defaults, target route, UTC semantics, 31-day maximum, page maximum, ranking tie-break, and rollout gates. Backend reconciliation still verifies whether the target route should be versioned in the path or schema and maps the existing scorer fields; neither may change the user-visible semantics above. User approval of this document is required before invoking `writing-plans` or modifying product implementation.
