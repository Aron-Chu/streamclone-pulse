# StreamPulse Site Feature Audit - Unused, Stale, and Half-Implemented Surfaces

Date: 2026-06-27  
Scope: `streamclone-pulse/streampulse-web` public site, analytics hub, setup, docs, dashboard legacy redirects, admin shell, and StreamElements roadmap fit.

## Executive Summary

The site is usable as a public analytics hub and channel-console front door, but it still carries several older portal concepts that are no longer true in the current implementation. The biggest cleanup targets are not visual polish; they are product-contract mismatches:

1. Authentication/account language is stale. `/login` redirects to `/analytics`, `/analytics/account` redirects to `/analytics`, and `auth.ts` is guest/no-op, but docs, tests, setup copy, and an unused `AccountPage` still talk about beta keys, device tokens, and account management.
2. ~~The setup install path is not production-ready (Chrome Web Store placeholder).~~ **Superseded:** `Setup.tsx` removed; `/setup` → `/analytics`; landing CTA points at `/docs#extension`.
3. `/admin` exists publicly in the SPA but has a no-op route guard and, against the local stack, fails as a raw CORS/fetch error instead of showing a clean operator-access state.
4. `/analytics/streams` is presented in navigation as both "Live now" and "Streams", but it immediately redirects to `/analytics`; there is no distinct streams directory route.
5. The public landing page advertises "Public API" as "Soon" without a route or docs page. That is fine as roadmap copy, but it is currently a dead resource card.
6. Existing Playwright tests are partly stale after the analytics-hub redesign: 21 passed and 9 failed in the targeted desktop subset, mostly due to old headings, removed beta-key UI, and removed account route expectations.
7. StreamElements should not be added as a public arbitrary-channel search feature. The repo already has a strong integration brainstorm; the right shape is an optional creator-authorized, server-side enrichment connector.

Recommendation: treat the current site as a public StreamPulse analytics hub first, then either fully remove the old beta/account portal shell or intentionally reintroduce real account auth. Do not keep the halfway state.

## What I Tested

### Source and Docs Reviewed

- `docs/pulse-extension/website-portal-requirements.md`
- `docs/website-portal/design.md`
- `docs/website-portal/tasks.md`
- `streampulse-web/src/routes/index.tsx`
- `streampulse-web/src/routes/public/*`
- `streampulse-web/src/routes/dashboard/*`
- `streampulse-web/src/routes/admin/*`
- `streampulse-web/src/lib/auth.ts`
- `streampulse-web/src/lib/apiClient.ts`
- `streampulse-web/src/lib/publicHub.ts`
- `streampulse-web/src/ui/components/analytics/*`
- `streampulse-web/tests/e2e/*`
- `docs/pulse-extension/streamelements-integration-brainstorm.md`

### Browser Routes Swept With Playwright

Tested against `http://localhost:5173` with the local StreamPulse BFF at
`http://localhost:8081` responding.

| Route | Result | Notes |
|---|---|---|
| `/` | PASS | Landing renders, public stats and hub calls return 200. |
| `/setup` | PASS with stale install target | Health check works, copy config works, install link is placeholder. |
| `/docs` | PASS | Static docs index renders. |
| `/docs/getting-started` | PASS with stale auth copy | Still tells users to paste beta keys. |
| `/docs/api-overview` | PASS with stale auth copy | Mentions beta key and V2 device token flows no longer present in client auth. |
| `/docs/missing-chart-start` | PASS | Coverage/backfill explanation is useful. |
| `/docs/privacy` | PASS | Basic privacy page renders. |
| `/status` | PASS | `GET /v1/public/status` returned 200. |
| `/login` | PASS redirect, stale product intent | Redirects to `/analytics`; no login screen exists. |
| `/analytics` | PASS | Public analytics hub loads with live matrix, search, corpus cards, moments feed. |
| `/analytics/streams` | PASS redirect, weak IA | Redirects to `/analytics`; no distinct streams page. |
| `/analytics/watchlist` | PASS | Watchlist route loads and calls `/v1/pulse/watchlist`. |
| `/analytics/moments` | PASS | Saved moments route loads and calls `/v1/pulse/bookmarks?limit=50`. |
| `/analytics/connection` | PASS | Health check works. |
| `/analytics/account` | PASS redirect, stale code remains | Redirects to `/analytics`; unused `AccountPage` still exists. |
| `/admin` | FAIL/DEGRADED local UX | Shell loads, but admin API calls fail CORS/fetch and show `Admin console unavailable (Failed to fetch)`. |
| `/dashboard` | PASS redirect | Redirects to `/analytics`. |
| `/dashboard/account` | PASS redirect | Redirects to `/analytics`. |
| `/dashboard/streams` | PASS redirect | Redirects to `/analytics`. |
| `/analytics/xqc` | PASS | Full analytics console loads and calls watch/live/channel/bookmark/history APIs. |
| `/analytics/xqc/s/test-stream` | PARTIAL | Stream route loads, but dummy stream only shows limited controls; expected for nonexistent ID. |

### Focused Browser Clicks

| Feature | Result | Evidence |
|---|---|---|
| Landing `Sign in` | Works but mislabeled | Click routes to `/analytics`, not auth. |
| Landing `Install extension` | Works | Routes to `/setup`. |
| Landing `Open Analytics` | Works | Routes to `/analytics`. |
| Setup `Add to Chrome` | Broken target | Href is the literal Web Store placeholder. |
| Setup `Copy config` | Works | Button changed to `Copied`. |
| Setup `Run health check` | Works | Showed `Connected - Streamclone v0.3.0-rc4, 4ms`. |
| Analytics invalid search | Works | Shows valid Twitch login validation. |
| Analytics `xqc` search | Works | Routes to `/analytics/xqc`. |
| Analytics live matrix tabs | Works mechanically | Tab selection changes; data may still be loading/racy in tests. |
| Connection health button | Works | Shows ready/connected health state. |
| Moments add form | Works mechanically | Native validation blocks empty required fields. |
| Admin page | Fails unclearly | Shows fetch/CORS failure, not clean operator access copy. |
| Channel console tabs | Works | Emotes/Spikes buttons can be clicked and console remains live. |

### Targeted Playwright Test Subset

Command:

```powershell
npx playwright test tests/e2e/landing-routing.spec.ts tests/e2e/account-setup.spec.ts tests/e2e/setup-full.spec.ts tests/e2e/admin-console.spec.ts tests/e2e/route-smoke.spec.ts --project=desktop
```

Result: 21 passed, 9 failed.

Key failures:

- Landing and route smoke still expect old hero copy `Never miss the moment...`; current H1 is `See the moment chat exploded - before the clip exists.`
- Tests still expect an analytics heading named `StreamPulse analytics` or `Analytics`; the redesigned hub H1 is `StreamPulse` with separate hub branding.
- Tests still expect `/login` to show `Connect StreamPulse`; current `/login` redirects to `/analytics`.
- Tests still expect `/analytics/account` to render an Account page; current route redirects to `/analytics`.
- `setup-full.spec.ts` expects a `Beta key` input, but setup no longer has one.

These are mostly stale tests, but they reveal stale product surfaces too: docs and unused code still describe auth/account behavior that the current app no longer ships.

## Findings: Useless, Unused, or Half-Implemented Features

### 1. Beta-Key Login and Account Flow

Status: Remove or fully rebuild.  
Severity: High product confusion.

Evidence:

- `/login` is implemented as `<Navigate to="/analytics" replace />`.
- `/analytics/account` is routed to `<Navigate to="/analytics" replace />`.
- `auth.ts` says beta keys are legacy no-ops: `getBetaKey()` returns an empty string, `hasBetaKey()` returns true, `refreshPrincipal()` returns `{ id: 'portal', kind: 'guest' }`.
- `AccountPage.tsx` still exists and says `Beta-key access only - full accounts are deferred (AUTH-200)`, but no route reaches it.
- Docs still tell users to paste beta keys and describe device tokens.
- E2E tests are split between the new guest model and the old key model.

Why it is useless right now:

- There is no actual login screen.
- There is no user-visible beta-key entry point.
- The account page cannot be reached.
- The nav still has `Sign in`, but clicking it opens public analytics.

Recommendation:

- If StreamPulse is public-first now, delete the account route component, remove beta-key docs from public pages, rename `Sign in` to `Open Analytics`, and update tests.
- If account auth is still planned soon, create a real `/login` with explicit phase copy and a working principal model. Do not leave a no-op auth facade with account copy.

### 2. Chrome Web Store Placeholder

Status: Fix before any public launch.  
Severity: High conversion break.

Evidence (as of 2026-06-27 audit):

- `Setup.tsx` had `CHROME_EXTENSION_URL = 'https://chrome.google.com/webstore/detail/streamclone-pulse/placeholder'`.
- Browser click audit confirmed the `Add to Chrome` href was exactly that placeholder.

Status update (post-cleanup): `Setup.tsx` was removed; `/setup` redirects to `/analytics`. Landing uses `CHROME_EXTENSION_URL = '/docs#extension'` (not the Web Store placeholder).

Why it is useless right now:

- The primary setup CTA sends users to a non-product Web Store URL.

Recommendation:

- Replace with the real Chrome Web Store URL when published.
- Until then, point to a release ZIP/load-unpacked setup doc or hide `Add to Chrome` behind a `Beta install` path.

### 3. Setup Extension Detection

Status: Needs replacement.  
Severity: Medium.

Evidence:

- `detectExtensionInstalled()` only checks `window.chrome?.runtime`.

Why it is weak:

- That detects the browser extension API surface, not the specific Streamclone Pulse extension.
- It can produce misleading install state unless the extension exposes an externally connectable handshake.

Recommendation:

- Use an explicit extension handshake if possible.
- Otherwise avoid saying the extension is detected; say `Chrome extension support detected` or keep the install step manual.

### 4. Setup Step 4 Copy Is Stale

Status: Update.  
Severity: Low-medium.

Evidence:

- Setup says: `Your dashboard will reflect watched channels once P2 pages land.`
- P2/dashboard/analytics pages have landed.

Recommendation:

- Replace with current behavior: `Open Twitch, start Pulse tracking, then open StreamPulse Analytics for the channel.`
- If watchlist state is now guest/public, explain exactly where tracked channels appear.

### 5. Public API Resource Card

Status: Either build it or remove from primary resource grid.  
Severity: Medium.

Evidence:

- Landing `ResourceGrid.tsx` renders `Public API` as `Soon` with no link.
- Roadmap also lists `Public API & spike alerts` as planned.

Why it is useless right now:

- It is a dead card in the resources section.
- Users who want API docs have no destination.

Recommendation:

- If public API is near-term, create `/docs/public-api` with current safe endpoints: `/v1/public/status`, `/v1/public/stats`, `/v1/public/hub`, and maybe public-safe `topmoment` concepts.
- If not near-term, remove the card from Resources and keep it only in Roadmap.

### 6. `/analytics/streams` and Duplicate Sidebar Navigation

Status: Merge or implement.  
Severity: Medium.

Evidence:

- `routes/index.tsx` redirects `/analytics/streams` to `/analytics`.
- `HubSidebar.tsx` has both `Live now` and `Streams` links pointing to `/analytics/streams`.
- Browser sweep confirmed `/analytics/streams -> /analytics`.

Why it is half-implemented:

- The navigation suggests a separate streams directory exists.
- The route simply returns users to the hub.

Recommendation:

- Fast cleanup: change both sidebar items to in-page anchors like `#hub-live-directory` and `#hub-rs-h`, or remove one duplicate item.
- Better product: implement `/analytics/streams` as a real directory with recent/live session filters, URL-stable sorting, and search.

### 7. Admin Console Route Guard

Status: Fix or hide.  
Severity: High for operator UX/security clarity.

Evidence:

- `AdminRouteGuard` returns children directly.
- Local browser test shows CORS errors against `/v1/admin/pulse/*` and `Admin console unavailable (Failed to fetch)`.
- Tests pass only with mocked admin APIs.

Why it is half-implemented:

- The page exists at `/admin`, but the real local API path does not give a clean operator access state in-browser.
- A public SPA route should not expose raw CORS failure as the main UX.

Recommendation:

- If `/admin` is meant for production behind Cloudflare Access, show explicit `Operator access required` when admin fetches fail due auth/CORS.
- If local admin is needed, route admin API through the same dev origin/Caddy CORS shape or document the required env/token.
- If neither is needed for public web, remove `/admin` from the Pages app and use an operator-only build/subdomain.

### 8. Docs Authentication Copy

Status: Update urgently.  
Severity: High support burden.

Evidence:

- `Docs.tsx` says users paste beta keys, device tokens arrive in V2, and dashboard/extension/portal calls require beta keys.
- Current `auth.ts` is guest/no-op and public analytics does not require key entry.

Recommendation:

- Split docs into `Current public analytics` and `Legacy/hosted beta archive` if the older flow still matters.
- Remove beta-key setup from Getting Started unless there is a working key field.

### 9. Test Matrix Drift

Status: Fix tests after product cleanup decision.  
Severity: Medium-high because CI can no longer tell intentional redesign from breakage.

Evidence:

- Targeted Playwright subset: 21 passed, 9 failed.
- Failures are stale route/headline/auth expectations.
- `featureMatrix.ts` still lists `/login` heading `Connect StreamPulse`, `/analytics/account` heading `Account`, and old landing heading copy.

Recommendation:

- Update route fixtures to the current public-hub model.
- Delete or rewrite tests around beta-key/account UI.
- Add explicit tests for the new desired behavior: `/login -> /analytics`, `/analytics/account -> /analytics`, no account link in top nav, and docs copy does not mention unavailable auth.

### 10. Saved Moments Manual Create Form

Status: Keep as internal/advanced or replace with picker.  
Severity: Medium UX.

Evidence:

- `/analytics/moments` asks users to manually enter `Channel login`, `Stream ID`, and `Offset (seconds)`.
- Empty submit is blocked by native required validation.

Why it feels half-implemented:

- Normal users do not know stream IDs.
- The main product promise is saving from extension/console moments, not hand-authoring database references.

Recommendation:

- Hide manual create behind `Advanced` or remove it.
- Replace with `Save from channel analytics`, `Import from URL`, or a channel/session picker.

### 11. Channel Search Opens Analytics but Also Starts Watch Tracking

Status: Keep if intentional; label it.  
Severity: Medium operational clarity.

Evidence:

- Opening `/analytics/xqc` calls `/v1/analytics/channels/xqc/watch` plus live/history/bookmark APIs.

Why it matters:

- Public search may have operational side effects if it starts tracking or reserves collector capacity.

Recommendation:

- Make the backend contract explicit: `open channel analytics` either only reads, or explicitly `starts/refreshes watch tracking`.
- If it mutates tracking state, consider a separate CTA: `Open analytics` vs `Track live`.

### 12. Public Hub Fallback Calls Hosted Production From Local Dev

Status: Make explicit.  
Severity: Medium.

Evidence:

- Browser route sweep showed local `/v1/public/hub` plus both local and hosted `https://api.streampulse.stream/v1/analytics/top100/readiness?topN=500` calls.
- `publicHub.ts` builds candidates from `getBackendUrl()` and `DEFAULT_PRODUCTION_BACKEND_URL`.

Why it can surprise developers:

- Local dev page reaches production data by default when the local hub needs Top-500 fallback.
- This is useful for demos, but confusing for debugging.

Recommendation:

- Gate hosted fallback behind a named env flag or show `source: hosted fallback` in dev UI/debug logs.

### 13. Landing `Sign in` CTA

Status: Rename.  
Severity: Medium.

Evidence:

- `TopNav.tsx` links `Sign in` to `/login`.
- `/login` redirects to `/analytics`.

Recommendation:

- Rename to `Open Analytics` or `Analytics Hub`.
- Only use `Sign in` once a real sign-in exists.

### 14. Account Page Dead Code

Status: Delete or rewire.  
Severity: Low-medium.

Evidence:

- `AccountPage.tsx` exists but route redirects away before it can render.
- It contains stale beta-key and server-side deletion copy.

Recommendation:

- Delete it if the public hub is guest-only.
- Or rewire `/analytics/account` to a real `Settings` page that manages backend URL, data export/delete, and optional future account login.

### 15. `Stream analytics coming soon` Affordance

Status: Mostly obsolete; verify with real bookmark data.  
Severity: Low-medium.

Evidence:

- `momentLinks.tsx` can show `Stream analytics coming soon` when a saved moment lacks stream ID or route availability.
- `PORTAL_STREAM_ANALYTICS_AVAILABLE` is true now.

Recommendation:

- If missing stream IDs are expected, copy should say `Stream unavailable for this saved moment`, not `coming soon`.
- If missing stream IDs are legacy-only, add a migration/fallback or hide the disabled link.

### 16. Roadmap Copy vs Actual Product

Status: Keep but tighten.  
Severity: Low.

Evidence:

- Landing says `no vaporware`, but also carries `Public API` as a non-clickable `Soon` card and planned roadmap items.

Recommendation:

- Keep roadmap honest, but do not put planned items in the same visual weight as working resources.

## Feature Inventory: Keep, Fix, Replace, Remove

| Feature | Current State | Decision | Next Step |
|---|---|---|---|
| Landing hero | Works | Keep | Update tests for current headline. |
| Landing stats/live hub data | Works | Keep | Add source/debug label for hosted fallback. |
| Landing `Sign in` | Misleading | Replace | Rename to `Open Analytics`. |
| Landing `Public API` card | Dead card | Fix or remove | Create `/docs/public-api` or remove from Resources. |
| Setup health check | Works | Keep | Keep no-key health copy if current contract is public health. |
| Setup copy config | Works | Keep | Add success/a11y test if not covered. |
| Setup install CTA | Placeholder | Fix | Replace with real install target or beta install docs. |
| Setup extension detection | Weak | Replace | Add extension handshake or soften copy. |
| Docs index/articles | Render | Fix copy | Remove stale beta-key/device-token wording. |
| Status page | Works | Keep | Add incident history only if backend supports it. |
| Login route | Redirect only | Replace/remove | Rename nav or implement real login. |
| Analytics hub | Works | Keep | Stabilize headings/test selectors. |
| Hub channel search | Works | Keep | Clarify if search starts backend watch tracking. |
| Live carousel | Works | Keep | Ensure buttons only show enabled when overflow exists. |
| Live matrix filters | Works | Keep | Add URL state if directory becomes its own page. |
| `/analytics/streams` | Alias only | Fix | Implement route or change links to anchors. |
| Watchlist | Loads | Keep, clarify auth | Decide guest vs account ownership. |
| Saved moments | Loads | Keep, simplify create | Replace manual stream ID create with picker/save flow. |
| Connection page | Works | Keep | Possibly merge with Settings if account removed. |
| Account page | Unreachable/stale | Remove or rebuild | Delete stale component or make real settings. |
| Admin shell | Mock-test works, live local fails | Fix/hide | Add real guard and clean access state. |
| Channel console | Works | Keep | It is the strongest product surface. |
| Stream session console | Works for valid IDs | Keep | Add empty/error copy for invalid stream IDs. |
| StreamElements integration | Docs only | Roadmap, not site feature | Build connector only after auth/scope verification. |

## Roadmap

### Phase 0 - Decide Product Contract

Goal: remove the current half-auth state.

Tasks:

1. Decide: public guest analytics only, or real accounts/beta keys.
2. If public guest: remove `Sign in`, `/login` product copy, `/analytics/account`, `AccountPage`, beta-key docs, and stale tests.
3. If real accounts: implement `/login`, principal storage, account page, sign-out, data delete/export, and tests.
4. Update `featureMatrix.ts` and route-smoke expectations to current copy.

Exit criteria:

- No visible route or doc references a feature that cannot be used.
- Route smoke tests encode the chosen model and pass.

### Phase 1 - Fix Public Launch Blockers

Goal: users can install, understand, and navigate without dead ends.

Tasks:

1. Replace the Chrome Web Store placeholder.
2. Update setup copy and extension detection.
3. Rename `Sign in` to `Open Analytics` if no auth exists.
4. Add or remove the public API resource card.
5. Fix `/admin` behavior: clean operator access state or remove public route.

Exit criteria:

- Landing CTAs all lead to working destinations.
- Setup has no placeholder links.
- `/admin` never shows raw CORS/fetch errors to a normal user.

### Phase 2 - Clean Information Architecture

Goal: route names match actual pages.

Tasks:

1. Make `/analytics/streams` a real streams/live directory, or remove it as a route.
2. De-duplicate sidebar `Live now` and `Streams` links.
3. Convert `Settings` to a real settings page or rename it to `Connection` only.
4. Give invalid stream IDs a friendly empty/error state.
5. Decide whether watchlist/saved moments are guest-local, backend-public, or authenticated user data.

Exit criteria:

- Every nav item has a distinct purpose.
- No route exists only as a confusing alias unless it is explicitly legacy redirect behavior.

### Phase 3 - Make Saved Moments Product-Grade

Goal: saved moments feel like a natural output of analytics, not a manual database form.

Tasks:

1. Add `Save moment` from the channel/stream analytics console.
2. Replace manual `Stream ID` entry with a channel/session picker.
3. Support importing from a StreamPulse analytics URL with `?t=`.
4. Rename `Stream analytics coming soon` to a precise missing-data state.

Exit criteria:

- A user can save a moment without knowing internal stream IDs.
- Saved moment links always lead somewhere clear or explain why they cannot.

### Phase 4 - StreamElements Connector Research

Goal: verify the integration before placing it on the site.

Important product rule:

StreamElements should be optional creator-owned enrichment. It should not replace Streamclone chat/emote rollups, Twitch VOD backfill, coverage truth, public Top-500 awareness, or backend Pulse scoring.

Research tasks:

1. Create a test StreamElements account/channel.
2. Verify auth flow, token type, scopes, and refresh behavior.
3. Verify Astro WebSocket topics and payloads for activities, session updates, stream status, tips, loyalty redemptions, giveaways, and optional chat.
4. Verify REST snapshots for activities, sessions, leaderboards, loyalty/store, bot status, and overlays.
5. Capture redacted fixtures and document rate limits/reconnect behavior.
6. Decide retention policy before storing chat, tip messages, donor details, or loyalty details.

Do not ship yet:

- Browser-extension-held StreamElements tokens.
- Public arbitrary-channel StreamElements analytics.
- Raw chat storage from StreamElements by default.
- Exact tip/donor details in public or extension surfaces.
- Bot/overlay write endpoints.

### Phase 5 - StreamElements Private MVP

Goal: connected creators get useful private context in the portal.

Candidate features:

1. `Connect StreamElements` portal settings flow.
2. Server-side encrypted token storage.
3. Connector health card: scopes, Astro status, last event, reconnect count.
4. Creator-private activity rail on channel/stream pages.
5. Pulse peak badges like `raid nearby`, `redemption nearby`, `tip nearby`, always secondary to Pulse reason badges.
6. Optional BFF payload block: `integrations.streamelements`, sanitized and hidden when disconnected.

Exit criteria:

- Disconnect removes all enrichment from API payloads.
- Extension never receives tokens or private raw details.
- Pulse coverage state remains visible and unchanged.

## Suggested Deletions or Replacements

Highest-confidence removals:

1. Remove or rewrite public beta-key docs unless real beta-key entry returns.
2. Remove `AccountPage.tsx` or route it as a real `Settings` page.
3. Remove the `Public API` non-link card until `/docs/public-api` exists.
4. Remove duplicate `/analytics/streams` sidebar entries until the route exists.
5. Remove old Playwright expectations for `Never miss the moment`, `StreamPulse analytics`, `Connect StreamPulse`, and `Beta key` setup fields.

Highest-confidence replacements:

1. `Sign in` -> `Open Analytics`.
2. `Add to Chrome` placeholder -> real Web Store URL or beta install docs.
3. `Stream analytics coming soon` -> `Stream unavailable for this saved moment`.
4. Manual saved moment form -> channel/session picker or URL import.
5. Raw admin fetch failure -> `Operator access required` with Access/login guidance.

## Verification Notes

- Manual Playwright browser route sweep completed for 21 routes.
- Focused Playwright clicks completed for CTAs, setup health/copy, analytics search, matrix tabs, connection health, moments validation, admin route, and channel console tabs.
- Targeted Playwright test subset completed: 21 passed, 9 failed.
- The failures were not fixed in this audit because the task was to inventory and report stale/unused features, not to change the product contract.
