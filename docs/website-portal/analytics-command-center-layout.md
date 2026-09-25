# Analytics command center layout

## Moments review refinements (2026-09-08)

Follow-up audit implementation: at widths up to600px Moments collapses browse
controls behind a Filters button, hides the install utility and repeated heading
copy, and puts the first result above600px in the390px acceptance viewport.
Empty Saved omits filters and offers Find moments to save. Single-result review
omits Previous/Next and exhausted collection controls; selection outside the
loaded collection still has a scope notice. Narrow replay fallback is a48px
timestamped Watch on Twitch action. Provider detector kinds twitch/bttv/ffz now
select the emote comparison, matching explicit session signals.

Still open from the audit: reconcile Recent versus session measurement snapshots
(the detector-kind fix resolves the headline preference only), and make hosted
historical discovery operational. On2026-09-08 the hosted discovery route returns
404 while newsroom reports ready. The backend checkout registers discovery
routes and its focused tests pass, but database/browser acceptance requires an
isolated TEST_DATABASE_URL; these local tests do not establish hosted readiness.

Follow-up verification on2026-09-08: an isolated PostgreSQL16 container ran
`INTEGRATION=1 go test ./internal/analytics -run TestDiscovery -count=1 -v` with
the database-backed browser acceptance enabled. All discovery tests passed;
the browser suite passed9/9, including120 scorer-generated synthetic detections,
pagination beyond10, day/creator scope, measured-zero days, yearly navigation,
and390/768/1440px layouts. This is local synthetic acceptance, not a hosted
promotion. The temporary database container was stopped after testing.
Measured evidence now exposes the supplying snapshot's publication time and
session revision where supplied. The earlier Fanum story no longer appears in
the live index and its exact detail read timed out; the original rate discrepancy
cannot be reconstructed from the available responses.

Source trace found a distinct mismatch path: Recent used retained detector peak
counts while Sessions used the comparison's current minute counts. Recent now
uses those same comparison counts when event minute, IRC binding, and rollup
evidence match and both rates are finite/nonnegative. Zero remains measured data;
missing or mismatched evidence retains the detector snapshot. Measured evidence
identifies this verified-minute scope. This fixes a reproduced adapter mismatch;
it does not prove which snapshot revisions supplied the original Fanum values.
Focused validation passed53 unit tests, app/test TypeScript checks and build:ci.

Release reconciliation is still required for history: the current backend
release has newer Sessions code and migration numbering that conflicts with the
older discovery implementation. The tested older checkout must not replace the
current release wholesale. Hosted history remains unavailable until discovery
is reconciled with that release, migrated, projected, and smoke-tested.

Global activity and moment inspectors now animate measured content height over
240ms, including asynchronous bucket content. Wide layouts animate the chart's
column allocation. Reduced motion removes these transitions. Clicks outside
the chart, inspectors, moment list and Live Wire release pinned investigation;
Escape also releases it. Dismissal happens on click rather than pointer-down so
outside controls receive their completed click before the layout collapses.
The HTML entry includes a dark startup message and reload link if the application
module cannot start; this is a recovery fallback, not evidence of the cause of
an earlier transient blank page.

The Moments workspace uses a shared animated, keyboard-operable listbox for
Category, Occurred, Sort and Session Range. Disabled server windows remain
disabled. Escape restores trigger focus; reduced motion removes menu entrances
and chevron motion. Rapid query changes compose against the pending query so
typing after a filter selection cannot silently discard that selection.

Selected review adds paired bars for the backend's earlier measured average and
current per-minute rate, with separate scales for chat and emotes. Only ready or
new-activity comparisons with finite, nonnegative values render. Emote-use bars
are relative to the largest supplied count shown, not a share of total chat.
These are audience-reaction measurements, never replay counts or video quality
ratings. Missing replay mapping has a visible source-unavailable panel.

Replay checks distinguish pending archive publication from lookup failures. The
selected moment retries pending/growing archives or failed lookups every minute,
up to five times while the tab is visible; manual retry restarts this window.
Rechecking preserves an existing player during the request and transient lookup
failure, with a visible last-verified-source notice. A successful response that
no longer confirms the mapping removes the player. Exact broadcast identity,
verified timestamp alignment and observed archive duration remain required.

Session summaries expose their supplied lead reaction, offset, rates, comparison
and emotes. A session with multiple loaded detections shows a discrete timestamp
map and exact-selection buttons. The map spans loaded timestamps only; it does
not interpolate activity, establish full-session coverage or combine streams.

Saved omits the discovery category gallery and keeps storage details in a
disclosure. Saved detections support a device-local note of up to 1,000 characters;
notes survive reload and do not persist source capabilities or imply media
storage/account synchronization. Existing unreadable-storage protection remains.

The connected hosted discovery endpoint returned HTTP 404 during this local
review. Historical discovery remains a separate backend rollout dependency;
these presentation changes do not turn the ten-result Recent feed into a full
historical collection.

Current cross-surface loading, motion and interaction refinements are recorded in
[the 2026-09-08 interaction audit](./analytics-moments-interaction-audit-2026-09-08.md).
Arrivals animate once per supplied identity, with bounded stagger and reduced-motion
support; polling must not replay them or reset the user's table page. Emote Market
views use keyboard-operable tabs and one labeled panel. Moments loading reserves
card space without presenting fabricated content or an empty-result claim.

| | |
|---|---|
| **Status** | Active (2026-07) |
| **Surface** | `/analytics` hub landing — `AnalyticsLandingPage` + `figma-activity-hub` |
| **Code** | `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`, `PulseMomentsLivePanel`, `FigmaGlobalActivityPanel` |

## Current feed roles (owner-approved 2026-09-04 follow-up)

### Chart investigation and following Live Wire (2026-09-08)

This supersedes the hover sidecar and reaction-only Live Wire contracts below.
Hover keeps chart geometry stable and shows one compact absolute-time readout.
At idle, the same reserved space explains hover preview and click selection
instead of displaying empty metric slots; hover restores the measured values
without moving the plot.
Only click, tap or keyboard selection opens the detailed bucket inspector. Following
owner visual feedback, it docks beside the plot when the canvas is at least 760px
wide and flows below on narrower canvases, without an internal scrollbar.
The rail is a compact interval summary: measured totals, up to three supplied
emotes and a link to matching moments. It does not repeat a full emote ranking
or channel leaderboard and must fit within the plot height. Pulse Moments owns
the matching rows and explicit moment detail; its idle inspector is unmounted
and the list uses the released width. Restore up to three supplied emotes and
bounded cached creator profile enrichment, with initials when photos are absent.
All Global Activity ranges (30m, 24h, 7d, 1mo, 3mo, and 1 year) share the same
viewer layout: 42% of the chart field (6-48%), with the lower activity lane at
58-92%. The chart is 420px tall on desktop and 360px below 720px. Three visible
Y-axis ticks sit in an external gutter, with automatic bounds computed from the
visible samples. The timeline and navigator reserve that same gutter. Chat and emotes
remain aligned below viewers on the same time axis; raw values, gaps, coverage
styling, and navigator selection are unchanged.
Missing samples remain gaps. Polling preserves inspected timestamps; a viewport
already at the newest edge follows that edge. Reduced motion disables entrances.

24h runtime diagnosis (2026-09-13): local Vite requested the hosted
`/v1/public/hub?activityWindow=24h`, which reported requested/served1440 minutes,
six-minute buckets and `historical_projection`. The first response had240
measured buckets; a later refresh had239, displayed as240 slots with one missing
interval. It must not be described as240 measurements on every refresh.
The raw viewer maximum2438333 came from an untagged corpus fallback; the later
capture's236 coverage-tagged snapshots ranged217919-807637. The backend merge
retained corpus totals wherever roster snapshots were missing, mixing viewer
populations and inflating the auto domain. The local backend fix keeps those
holes unmeasured while preserving reaction buckets and all supplied snapshot
values, including real peaks and measured zero. No percentile clipping is used.
The portal also preserves verified-complete viewer peaks when gaps elsewhere
enable lower-confidence median smoothing. Desktop/mobile replay of that actual
capture through the corrected Go merge yields a129.5K-896.1K axis with unchanged
geometry. This is local captured-response verification, not a hosted release:
the running Vite still consumes the deployed backend until an authorized release.

Portal compatibility follow-up (2026-09-13): the shared public-hub normalizer now
recognizes only `source=historical_projection` plus
`projectionGeneration=hub_activity_scalar` with explicit roster snapshot coverage
and contributor metadata. In that mixed timeline, viewer rows lacking all roster
provenance become unavailable viewer samples, retaining chat/emotes and bucket
identity. All-unknown legacy timelines, other generations, partial snapshots,
measured zero and verified high peaks remain unchanged. A rejected peak timestamp
is reconciled with retained observations before summaries/cards/chart consume them.
The portal can therefore display the current hosted response correctly without
deploying the backend fix or replacing its transport. Actual non-intercepted local
browser verification at1440/390px returned240 six-minute buckets,235 roster samples,
five incompatible viewer intervals and the129.5K-896.1K axis; both the card and
chart summary reported807.6K. The backend correction remains pending release.

Hover now uses a permanently reserved header readout with absolute interval time
and unsmoothed measurements. It has no floating plot tooltip, does not resize the
chart on hover/leave, and retains the detailed click inspector. Incompatible viewer
samples are explicitly unavailable, not measured zero. Narrow layouts show three
time labels rather than eight; the full240-slot grid and navigator are unchanged.

Historical moment requests start on selection, not hover. Concurrent consumers
cannot cancel one another's shared transport. Cache entries retain response
status, reason and server boundaries. Failed or unavailable reads have Retry and
Clear selection controls and retain known matching rows; they never claim an
empty bucket. Retry-After applies across bucket requests to the same backend.

Live Wire follows newest by default. Pointer interaction, focused controls,
explicit pause, oldest order or scrolling into earlier rows holds new arrivals;
returning to newest after interaction resumes automatically. Resume live commits
the latest snapshot and restores the feed heading. Chart investigation does not
pause the independent feed. Existing identities do not reanimate on normal polls.

All / Reactions / Streams filters combine measured reactions with the optional
public-hub `liveActivity` projection. The owning backend reads at most 20 durable
lifecycle transitions from the last hour, using existing writer/read gates and
sanitized portal event fields. Broadcast starts use Twitch start precision;
ends disclose confirmation precision rather than claiming an exact end instant.
Pool Wire continues to describe collection membership, never broadcast ends.
Missing or disabled lifecycle serving leaves reactions available and labels
stream events unavailable. Lifecycle cards link to exact stream analytics and
have no reaction Save/Open moment actions. No new endpoint or collector is added.

Implementation is local; hosted lifecycle serving requires a backend release.
Local regression coverage includes cancellation sharing, retry/backoff, cached
unavailability, obsolete responses, zoom continuity, lifecycle identity/filtering,
polling while hovering, keyboard interaction and 390/768/1440/1920px layouts.

Local validation (2026-09-08): 84 focused frontend tests, portal production build,
app/test typechecks, overlap checks and focused Go hub/lifecycle tests pass.
The 26 chart/refinement/hub audit browser tests pass against production preview.
The full existing local audit is 28/29: the unrelated public landing test still
expects `details.sl-optional-demo`, absent from the current landing implementation.
No commit, deployment or hosted lifecycle availability is implied by these checks.

Selected Moments detail (2026-09-08): desktop's sticky card is bounded to the
viewport below the header and scrolls with wheel or keyboard, including content
below the replay preview. A new selection resets its internal scroll. At 850px
and below, detail returns to unrestricted document scrolling. Local checks cover
390/1370/1920px, keyboard Home/End, wheel scrolling and access to the final section.

### Live Wire action hierarchy and Recent cache continuity (2026-09-05 handoff continuation)

Live Wire remains the independent chronological discovery rail. Each detection
uses one full-width **Open moment** target; device-local Save, exact Stream
analytics and the fail-closed Show on chart action remain visually secondary.
Cards retain creator/avatar, category, occurrence age, reaction comparison,
measured chat/emote rates and supplied emotes. Score-width bars and nested
expansion are not reintroduced. The rail is 380px only when the analytical
canvas remains readable and stacks at narrower widths under the established
outer-rail contract.

Moments Recent may hydrate from the bounded public-hub cache before its
review-stable arrival queue commits the same records. That first usable snapshot
must render immediately: the page must not announce an empty collection it
already holds. Later distinct identities remain queued behind the explicit
**Show N new moments** control. Opening a card is an ordinary navigation button,
not a pressed/toggle control; selected review is exposed with `aria-current`.
Save, creator history and Stream analytics remain independent targets.

Local evidence: 24 focused Live Wire unit cases, the four-width outer-rail
browser contract (390/768/1440/1920), all 26 Moments workflow browser cases,
portal typecheck and the complete production build/check chain pass. Root also
opened a real hosted-data Live Wire row on development port 5173 and verified
the exact selected Moments route and a verified Twitch archive player mounted
without autoplay. This sample is not universal media availability, catalogue
activation, ranking validation or final field UX approval.

The older `analytics-hub-live-wire-ticker` browser file now asserts this same
outer-rail contract instead of its retired in-chart wrapper: one mount, 380px
desktop rail from 1440px, in-flow placement after Global Activity below that
breakpoint, an accessible Moments collection link, no horizontal overflow and
stable device-scale rendering. Its seven cases and the six discovery interaction
cases pass; hover, Save and filtering cannot replace the pinned inspector.

Independent Sol/high review found and root repaired four final contract gaps:
ordinary browsing now converges from cached rows to the healthy refresh while
only exact review holds arrivals; a missing detection category is never filled
from the creator's current live category; repeated row actions include creator,
reaction and offset in their accessible names; and the 24h E2E fixture contains
the full 240 six-minute buckets it advertises. The reviewer rechecked the fixes
and reported no remaining confirmed blocker in this bounded slice.

### Selected-bucket responsive contract (2026-09-05 handoff completion)

The embedded Pulse Moments selector keeps one semantic table and one selected
Moment Inspector. When the table has room it retains creator, occurrence,
reaction, chat/min and emotes/min; rank, category, viewers and top-emote cells may
be suppressed before horizontal scrolling is introduced. At narrow container
widths rows become two-column cards in this order: creator/time, category,
reaction, chat/emote measurements. Category and reaction cannot overlap, creator
identity cannot collapse to single-letter wrapping, and the document must not
become wider than the viewport. Column headers may be visually off-canvas only
while remaining available to assistive technology; rate cells expose their
labels in the card layout.

The Global Activity bucket inspector is inactive and visually absent at idle,
including wide layouts. Hover may show a temporary preview and explicit
selection may reserve the stable inspector slot; neither state replaces Live
Wire or the selected Moment Inspector. A selected bucket is cleared by its
named Clear control or the existing chart keyboard contract, not by an
undiscoverable click on unrelated moment content. Complete fixtures must report
complete provider coverage; UI tests must not restore score-width bars or hidden
compact-table columns to satisfy obsolete snapshots.

Evidence: 29 Analytics UX/chart/discovery browser checks, 33 Moments and outer
Live-Wire browser checks, 26 focused unit checks, typecheck and production build
pass. Actual local inspection covered hosted data at approximately 710px and a
fresh 390px render; existing 390/768/1440 and device-scale contracts remain.

### Hottest Live restoration (2026-09-05)

The channel discovery shelf is restored between overview/search and Global
Activity, using the existing `FigmaLiveChannelRail` and unchanged top-12
chat/emote-rate ordering. It does not replace the independent Live Wire feed,
selected-bucket investigation, Moments workspace or tracked-channel table.
The supplied pool can include tracking fallbacks: copy must not equate tracking
with confirmed current presence or reaction rate with clip quality. Empty and
unavailable responses must not claim everyone is offline.

Creator names retain readable contrast; rate lines have consistent wrapping.
The horizontally scrolling shelf has visible scroll affordance, keyboard focus,
neutral missing-image surfaces and inline layout containment. No decorative
hover lift is needed. Six browser cases cover responsive navigation, full-shelf
resize and keyboard focus; typecheck and production build pass. Real-data
desktop/mobile inspection found and corrected overflow missed by the original
two-channel fixture. This does not close the separate hosted VOD mapping gap.

### Sequential review of loaded moments (2026-09-05 continuation)

Page-boundary follow-up: selected stored/session review exposes an explicit
**Load more moments into review** action using the existing cursor. Selection
and sort stay unchanged; no auto-fetch or auto-advance. Loading/errors are visible
inside review on mobile. Exhaustion means all supplied results, not all detected
activity. Unavailable collections do not show a false exhausted-state control.
The stored catalogue now enforces its1,000-item limit even when a final page
overflows it, and retains a narrowing-required notice when the server has no
further cursor. A successful session-page retry clears the prior page error.
Both defects were reproduced in failing-first tests before repair.

The existing selected detail now has Previous moment / Next moment controls and
an explicit position among loaded matches. It follows the currently filtered
display order in Recent, stored-day results, Sessions and Saved; it is not a
watchability rank or a global ordering. Navigation retains creator/day/month,
filters and sort in the URL. Each selection performs the existing exact-source
check and cancels obsolete detail work. No automatic preview, save, load-more,
collection admission or clip publication is introduced.

Controls stop at loaded boundaries without wrapping. An exact selected identity
outside loaded matches stays readable, with both controls disabled; there is no
nearest-time substitution. Back/refresh preserve URL selection. Keyboard focus
goes to the selected heading while the review scrolls below the site header so
Back and neighboring-moment controls remain visible on mobile. Existing flat
tokens and the single selected-detail surface are reused.

Verified with 81 targeted frontend tests and 28 rebuilt-portal browser cases,
including new exact-source navigation at390/768/1440px and outside-filter denial.
App/test typecheck, production build, route/link/overlap/public-page checks pass.
Real hosted-data Moments was also inspected locally: current examined detections
have reactions but report archive-pending sources. Historical serving activation,
real playback/publication and private history remain separate acceptance gates.

### Exact reaction measurement consistency (2026-09-05 continuation)

Live Wire and Moments now use one comparison presenter and preserve the
detector's reaction signal through the shared discovery adapter. Session rows
use the selected update's signal, not the session lead or the larger multiplier.
Partial/unavailable primary comparisons may fall back to a qualified other
metric, explicitly named; this is explanation, not a new ranking engine.

The owning backend recap now uses the actual broadcast start, matching the
heatmap's stream-relative offsets, rather than a minute-truncated start. Recap
measurements require an exact, unambiguous rollup; adjacent missing minutes
cannot supply counts. Recap list fallback in the shared console follows the
same exact-match policy, preserves supplied zero, and labels absent measurements
unavailable. Existing supplied recap measurements remain authoritative; this
frontend change does not conceal an old backend's contradictory counts.

The backend correction is local and has not been deployed. Hosted read-only
evidence confirmed that the old recap for offset70590 used the counts from
offset70530. The actual rebuilt portal shows the shared reaction headline, but
the old hosted recap requires a separately authorized release. Existing Live
Wire routes, chart pinning, source/ReplayForge gates, Saved persistence and
calendar behavior are unchanged. Neither real playback/publication nor
historical-service activation is closed by this consistency work.

### URL-backed comparative activity overview (2026-09-05 continuation)

This supersedes the one-year-only and local-control limitations in WS17 below.
Stored activity keeps global indexed-stream scope and explicit creator scope;
it is not personal viewing history. Month detail and Year overview share the
URL-backed `measure` choice (detections/chatMessages/emoteUses). `calendar=year`,
`year` and `years=3` restore the overview on refresh and browser Back. One year
remains the default; an explicit comparison shows up to three consecutive years,
bounded by 2011 and the current UTC year.

The overview reads only daily summaries, sequentially, at most three per active
scope. It does not also fetch a month of moment records. Cancellation prevents
obsolete creator/year batches continuing or replacing current results. A single
color scale applies across available displayed years; totals are not normalized
for coverage. Failed/unavailable years never become fabricated quiet grids.

Selecting a day returns to its exact month/day results, keeping the creator and
measurement; Back restores the comparative view and focused day. One roving
keyboard stop per year supports arrows/Home/End/Enter. Twenty-pixel cells fit
the full year in the desktop workspace; narrow views scroll within each year,
with a separate date-entry action and controls at least 44px high. Existing
mobile selected-detail behavior, Saved and exact media/handoff gates remain.

Local proof: 92 targeted unit tests, 12 browser regressions on the rebuilt portal,
and seven browser cases against the real PostgreSQL/projector/Go reader passed.
The database fixture contains 120 synthetic detector results, not actual media
or representative historical coverage. Hosted discovery currently returns 404;
activation, representative corpus/query plans/restore, real playback/publication,
private extension persistence and the rest of the goal remain open.

### Year overview (2026-09-05 local continuation)

Stored-day browsing now offers explicit Month detail / Year overview modes.
Year overview loads one bounded daily-summary response from
`/v1/public/discovery/activity?year=YYYY[&login=...]`; it does not download a year
of events. The existing global/creator scope remains separate from personal
Saved. Day selection opens the matching month/day collection with unchanged exact
moment identity and pagination. No billing, source lookup, collector or clip job
is triggered by reading a year.

The heatmap uses24px cells, weekday/month axes, a discrete muted legend and the
existing dark surfaces. Detection/chat/emote measures are displayed without
watchability scores. Hover/focus readout explains exact counts and partial
coverage; hover must preserve the cell's measured color. One keyboard tab stop,
arrow day/week navigation and Enter select; future cells cannot be selected.
Narrow layouts scroll within the heatmap and provide a44px-control date-entry
alternative. Missing years show unavailable copy, not a fabricated quiet grid.

The year selector browses one year at a time. Simultaneous multi-year comparison,
URL-persisted overview controls and real-corpus completeness remain open. No
claim that the multi-year reference is fully implemented is made by this step.
Existing month and Moments Back/Save/source checks remain required.

### Stored-day integration and density checkpoint (2026-09-05)

The day browser now places scope/measurement controls beside a compact monthly
calendar on desktop and stacks on narrow screens. It uses the existing dark
panel token. A local display selector chooses detected moments, chat messages or
emote uses; both cell values and shading use that measure. Whole-month totals
come from stored day facts, never the visible result page. Missing remains a
dash, measured zero remains zero, and coverage is explicitly partial. Detailed
collection caveats are disclosed rather than repeated above every result.

Below850px, selected review hides the calendar; Back restores the same browsing
scope and focused result. No second inspector, watchability score or automatic
media action was introduced. The multi-year activity overview remains open;
this monthly layout is not a substitute for that requirement.

The dedicated `playwright.discovery-database.config.ts` runs only when invoked
by the backend's opt-in Go integration harness. Six browser checks now pass
against the actual HTTP reader/PostgreSQL projection with120 detections produced
from synthetic minute measurements, on development5173 and fresh production4184.
They verify pagination independent of calendar totals, exact identity, scope,
Save/refresh/Back, missing versus zero, unavailable media, reduced motion and
390/768/1440px. The200% check uses CSS zoom, not browser-UI zoom. Screenshots of
the rebuilt application were inspected. Real corpus, media, retention/restore,
service activation and extension persistence remain open; hosted flags were not
changed. This supersedes the earlier missing isolated BFF-to-portal test gate,
not the representative-corpus or production acceptance gates.

### Exact watch-app navigation (2026-09-05 goal continuation)

Moments may offer **Review in Streamclone** when an explicit watch origin is
configured and the selected source check supplies an exact VOD and valid aligned
archive timestamp. Second/third session updates and Saved reopening use their
own identity, never the session lead or a persisted playback link. The original
Moments URL and display remain stream-relative; the watch URL is archive-relative
and includes immutable stream identity. Navigation cannot create a clip or grant
permissions. Public builds reject loopback targets; local targets use watch8090,
never Pulse BFF8081 or ReplayForge8095. No default origin or new backend API is
introduced. See the local-dev runbook for the separate two-app acceptance run.

Five browser checks passed against both freshly built applications with service
and media requests intercepted, including390/768/1440px clip review. They stop
before publication. Real playable sources, watch-service availability, Twitch
permission/publication and durable clip-journal acceptance remain open. This
checkpoint does not change Live Wire routing, approve a new paid tier, or close
calendar/history/storage requirements below.

### Stored-day discovery foundation (2026-09-04 goal continuation; not activated)

Recent now offers an explicit **Browse stored activity by day** mode, URL-backed
by `collection=history`, `month`, `day` and `creator`. Creator scope is separate
from the selected moment's `login`; opening a result cannot silently change the
scope. It reads the additive public discovery projection, not a count of the
ten-item hub feed. Scope changes cancel pending pages; selection alone does not
refetch or add an inspector. Existing Recent/Sessions/Saved links and exact
source actions remain. No Live Wire routing replacement is made here.

The calendar uses UTC dates and counts measured activity separately from
detections. Missing values are not zero; a measured day is still partial
coverage across indexed streams, not all Twitch. Existing search/category/sort
controls narrow loaded results and never relabel calendar totals. Pagination
loads50/page up to an explicit1000-row in-browser bound, then asks for a narrower
day/creator; no silent eviction. Stale/error/unavailable server states are
explicit. No fabricated calendar renders when the new backend is unavailable.

This is an in-progress implementation, not approval of a complete visual design,
history service, paid tier, media preview or native clipping. The owning backend
now has a bounded resumable scheduler and seven passing isolated PostgreSQL
integration tests (2026-09-05). Index/read flags remain disabled pending
representative corpus throughput, query-plan, retention/restore and actual
populated BFF-to-portal acceptance. Old settled projections no longer become
stale merely after15 minutes; scoped pending work and scanner health determine
freshness. No new public response fields or UI layout are introduced here.
The existing hosted-first Recent feed remains usable.

### Direct stream discovery follow-up (2026-09-04)

Live Wire's primary action is now **Stream analytics**, built from the exact login, immutable stream ID and offset via `discoveryAnalyticsHref`. It does not route through Moments/legacy Newsroom. The separate collection footer still opens Moments and saved items. Save and Show on chart are unchanged; missing chart coverage must not remove a valid exact analytics destination. Richer Moments range/category/preview designs are being evaluated separately, not authorization to relax source mapping or historical capability gates.

### Moments loaded-result browsing follow-up (2026-09-04)

Selected deep links outside the recent collection now make one bounded, cancellable recap read on selection (not a history poll). Hydration requires exact login, immutable stream, offset, an unambiguous row, and matching public ID when supplied; the session lead/nearest detection is never substituted. Creator portraits use the existing bounded profile cache. Recap emotes keep server-supplied counts and sanitized imagery, not invented minute rates or watchability labels. Occurrence may be derived from the exact source's validated stream start plus offset. Failure is retryable without losing selection. On mobile, selected review hides the filter form until Back; reactions precede unavailable-source copy. Actual VOD mapping/alignment and playback gates remain separately open.

Moments now exposes URL-backed search, category, occurrence window (all/30m/24h/7d/custom UTC), and newest/oldest/category ordering. These filter only already-loaded detections or session summaries; the separately capability-gated session Range remains the only history-fetch selector. Session index filtering uses its supplied lead occurrence/category and does not claim to search all updates. Custom Through dates include the whole UTC day, invalid bounds show a validation message, and undated detections remain available under Any loaded time. Clear filters removes client filters without altering the server history range.

Opening a result and browser Back preserve filter context and exact identity/focus. Switching Recent/Sessions/Saved explicitly returns to browsing rather than preserving an open inspector across views. A direct URL outside the loaded collection is not falsely labeled as saved. Selected detail shows up to five backend-supplied emotes through the existing sanitized image component; saved metadata still does not persist image/emote data. Flat controls and a single moving selected-tab layer replace decorative motion; reduced motion removes transitions. Real preview playback still requires authoritative VOD mapping/alignment, and is not established by these UI checks.

### Original-theme outer-rail restoration (owner follow-up, 2026-09-04)

The 2026-09-05 moment-browser and chart-lane revision below updates this presentation contract. The deployed site is a visual reference, not authorization to roll back measurement/source safeguards or import Explorer.

- Live Wire mounts once in `AnalyticsFigmaShell.rightRail`, outside the Global Activity card. At this revision's 1440px threshold (superseded by the September 24 canvas-width correction below), the frame uses180px navigation, a flexible analytical center and320px discovery rail. The frame may use up to2200px instead of leaving large unused gutters. The feed is sticky like the left navigation, bounded to the viewport with reachable overflow, not an overlay covering the plot.
- Below that historical threshold, the same feed appears after the network section and before secondary analytics. CSS changes visual layout without remounting the feed or resetting its queue. The skip link targets a real focusable child box, never a `display:contents` landmark.
- The original activity chart, navigator, provider lanes and measurement calculations remain. At content widths below1360px, an active bucket summary sits beneath the full-width chart and sizes to its content; this avoids a tall mostly empty side rail at the1262px review viewport. At1360px and wider, the chart can reserve320px for the side summary. Idle aggregate detail is hidden at either width.
- Bucket hover previews aggregate context only. Explicit bucket selection reveals its detections. Full moment detail appears only after exact moment selection; an absent or unresolved identity never substitutes the first result. The idle full discovery table is replaced by a link to the Moments workspace, while its data hooks still maintain the shared pool.
- Live Wire rows show creator/category/time, measured comparison, chat/emote evidence, emotes and Open/Save actions; Show on chart remains gated to exact loaded identity/bucket. Supporting text is at least12px and actions wrap. Hover changes the flat background, not card position/scale; reduced-motion safeguards remain.
- Moments Recent/Sessions/Saved remains the catch-up/review destination using the existing contracts. No separate editorial Newsroom identity, scoring, media preview service or ReplayForge job admission is added. Legacy Newsroom links and exact-source actions remain intact.

Local acceptance includes outer-rail geometry at390/768/1440/1920px, stable plot width on hover, no idle auto-inspector, exact selected identity, keyboard skip/focus/Save/Back/Escape, scoped existing watch-and-save checks, actual rebuilt-preview inspection, typecheck and build. It is not editorial ranking validation, production deployment, or proof of real Twitch playback.

### Moment browser and separate viewer lane (owner-approved 2026-09-05; local implementation)

- The hub always exposes its loaded moment list, existing spike filters and one Moment Inspector below Global Activity. `requireExplicitSelection` prevents automatic first-row substitution independently of list visibility. The inspector starts with “Select a moment”; empty/error/filter states retain it. Only an exact selected identity supplies detail.
- Chart buckets filter the browser through existing served-window fetching and caching. Clearing restores loaded moments. Row selection highlights only a bucket present in the served chart model; an absent bucket clears chart focus without inventing historical coverage. Live Wire keeps its exact-identity gate and single outer-rail mount.
- Viewer history occupies about one-third of one shared interaction canvas; chat bars and emote lines occupy the lower lane. Desktop plot height is336px; below720px viewport width it is280px. The time domain, navigator, hover timestamp, bucket selection, keyboard actions and provider lanes remain shared. Viewer coverage styling, raw readouts and gap semantics are unchanged. Series labels use one full or abbreviated label according to the chart container width. Interaction details live in the measurement disclosure; the omitted in-progress bucket remains visible beside the chart.
- At this revision's 1440px threshold (superseded by the September 24 correction below), the shell reserves180px for navigation and380px for Live Wire. Cards use16px padding and13px supporting text. Narrower layouts keep the same feed after network activity/moments and before secondary analytics.
- The moment browser uses compact content-height rows (about56px, expanding for wrapped content). The inspector is280–320px wide beside the list at browser-container widths of at least800px and stacks below otherwise. Narrow lists put detection text on a second line. Category, viewers and emote breakdown remain in selected detail rather than widening the compact list.
- Chart controls and provider lanes use12px spacing. Only a container at least1360px wide uses a chart-height bucket side rail; narrower containers place its selected summary below the plot. Hover never changes plot width.
- Local acceptance covers initial/cleared/unresolved selection, keyboard rows, filters, empty states, shared chart lanes, and390/768/1440/1920px geometry. Run portal typecheck, focused Vitest, existing chart/outer-rail Playwright checks, and the public-surface audit against a rebuilt preview. No additional CI job, API change, commit or deployment is implied.

### Watch-and-save replacement (owner-approved 2026-09-04; local implementation)

This section supersedes shared-slot, activity-bar, and editorial Newsroom presentation requirements below; their history is retained, not silently removed.

- `/analytics` retains Global Activity and its measured navigator. Live Wire is an independent page-level rail, never replaced by chart selection. Bucket investigation is beneath the chart; full moment review belongs to Moments. The rail is 320–360px only with enough container width to keep a readable chart; otherwise chart, Live Wire, then secondary analytics stack.
- Live Wire is newest-first within explicitly **loaded detections**. Exact identities are deduplicated, not nearby events from one login. New arrivals are queued during review. Open moment and Save do not require chart coverage; Show on chart does.
- `/analytics/moments` has Recent, Sessions, and Saved views sharing exact selected-moment context. Recent uses the hub; Sessions uses existing Newsroom contracts and selected-detail pagination. Historical capability gates remain. Newsroom URLs redirect preserving story identity, query, and hash; no Explorer implementation is imported.
- Source actions use exact selected stream/offset and checked source mapping. Watch live now requires fresh confirmed presence and is not replay. VOD playback remains unchecked. No embedded video, fake Play affordance, autoplay, new media service, or job admission is part of this iteration.
- Saved on this device is a versioned 200-item browser-local shortlist, with no silent eviction, media URLs, VOD IDs, or handoff authorization persisted. Storage failures use a labeled session-only fallback; opening a saved selection checks current source information.
- Flat existing surfaces, restrained mint accents, creator identity and measured evidence replace score bars, confidence decoration, feature-story framing and decorative gradients/glows. Existing chart scales/masks, homepage visuals, backend policy and release gates remain outside this local iteration.
- Acceptance requires targeted identity/storage/state/Back-focus/browser regressions, typecheck and production build, plus actual rebuilt local desktop/mobile inspection. This is not ranking-quality validation, hosted acceptance, or closure of historical-serving/production-memory findings.

This section supersedes the earlier Live Desk/Newsroom-first sidecar behavior below.

- **Live Wire** answers “What is happening now?” with a compact, chronological preview of backend moments from the last 30 minutes. The owner-approved presentation restoration removes per-card expansion; the existing Moments section remains the full measured collection, without another inspector or scoring system.
- **Newsroom** is a separate catch-up digest at `/analytics/newsroom`, with canonical story detail and grouped backend updates. It does not replace Live Wire when its endpoint is healthy. The hub no longer polls Newsroom just to fill the idle rail.
- Idle shows Live Wire; hovered/locked buckets replace it in the same slot. Explicit **Inspect on chart** requires an exact loaded moment/stream/bucket and moves focus to **Back to Live Wire**. Reading a card never fetches historical analytics.
- Rows expose creator identity, measured event/time, activity bars, state-aware comparison/evidence, emotes and direct canonical/VOD actions. Older detections use a separate disclosure. Previously seen identities remain remembered within a bounded30-minute history; NEW badges are limited to healthy network updates. Missing profile images use the existing bounded identity cache, not per-row analytics requests.
- Cards use flat site tokens with measured imagery and profile pictures. The shared rail must not clip content or introduce an independent scroll container. Newsroom retains Copy link, Analytics and Watch actions on detail.
- A recoverable historical hub read failure may make one recent-window recovery read. It preserves live health and labels the requested versus served range explicitly; no 30-minute response is represented as complete 24-hour history. Auth failures and rate limiting cannot trigger recovery fan-out. Both reads failing retain a measured snapshot, or fall back to labeled aggregate stats on cold load.
- No change to IRC capacity, deployed collectors, production data or ReplayForge activation is part of this UI repair.

## Previous Pulse Newsroom sidecar contract (2026-08; superseded where noted above)

Global Activity has one existing inspector slot, not a second rail. `ActivityNewsroomSidecar` owns that slot and switches its only mounted body:

| Page state | Shared sidecar body |
|------------|---------------------|
| Idle | `LiveDeskRail`: one lead verified story and at most two secondary headlines |
| Hovered loaded bucket | `ActivityBucketInspector` preview |
| Locked loaded bucket | `ActivityBucketInspector` |
| Resolved Newsroom story moment | Locked `ActivityBucketInspector` with a **Back to Live Desk** action |
| Newsroom unavailable, absent, or malformed | Existing `HubLiveWireFeed` rendered vertically in the same slot |

The Global Activity component is a query container. The current bucket summary follows the full-width chart until the component itself reaches 1360px; only then may it reserve a 320px side column. A viewport width alone does not prove that the chart has enough space after analytics navigation. The selected summary is not sticky; at wide sizes it can scroll within the chart-height column.

Mobile order is chart, lead Live Desk story, bucket inspector only after explicit selection, then **View Pulse Newsroom**. Live Desk and the bucket inspector must never be adjacent rails or simultaneously mounted.

### Story-to-chart resolution

- The page owns `selectedMomentKey`, bucket focus, and whether a Newsroom story initiated focus.
- A Live Desk story may select the chart only when its `publicMomentId` resolves to an already-loaded real moment, its `streamId` is an exact match, and that moment's bucket exists in the currently served activity points.
- Successful resolution reuses the loaded moment. It does not construct a synthetic `FigmaMomentRow`, request `/hub/moments`, or prefetch a historical bucket.
- Any failed identity, moment, or served-bucket check navigates to `/analytics/newsroom/:storyId`.
- **Back to Live Desk**, range changes, and ordinary chart/moment selection clear Newsroom-owned focus and restore normal bucket fetching behavior.

### Newsroom contract and routes

- `/analytics/newsroom` is the canonical live/24h/7d editorial index. `/analytics/newsroom/:storyId` is canonical detail. Both routes precede dynamic channel routes and use the analytics shell with `hideSidebar`.
- The portal accepts only `schemaVersion: 1` envelopes and strict server-owned comparisons. Every versioned envelope must carry a real writer `dataThrough` watermark, including `unavailable`; a response without that watermark fails closed to the existing Live Wire fallback.
- Story sparkline samples are backend-owned, chronological, and capped at twelve. Omitted minute timestamps break the line; the browser never fills gaps or calculates baselines.
- `ready` renders Live Desk, `empty` renders **Quiet now**, and `stale` preserves the last valid stories with their data-through age. `unavailable`, an absent endpoint, or malformed data uses the existing Live Wire fallback in the same sidecar.
- Initial loading may use a skeleton. Refresh preserves current content. The first healthy response silently establishes a baseline; only a new notification-eligible story or a lifecycle transition with a higher revision is announced. Polls, late corrections, ordinary signal updates, relative-time changes, and stale recovery are silent.
- Story actions are three distinct, aligned destinations: Analytics, Watch live/VOD (or disabled Replay unavailable), and Copy link. Numeric breakout scores are absent from Newsroom.

**Section roles (avoid duplication):**
- **Hottest live** — activity-ranked live pool cards (shared `rankLiveChannelsByActivity` with chart inspector “Top live by activity”); viewers are secondary context
- **Live Desk / Pulse Newsroom** — clustered broadcast stories with a canonical timeline; Live Wire remains the compatibility fallback while Newsroom reads are unavailable
- **Pool Wire** — compact lifecycle heartbeat in the command header (`POOL Stable` when quiet)
- **Emote Market** — leaders / concentration / provider; breadth & rotation gated on backend market fields
- **Channel Screener** — multi-view tracked table (Overview / Momentum / Coverage / Anomalies)
- **Top clips** — only when sanitized public published clips exist (never beta candidate queue)

## Section order (top → bottom)

1. Command-center hero (search, Hottest live rail, coverage strip)
2. **Network activity** — `figma-activity-hub`: chart stack (plot + navigator + fixed provider lanes) with one shared Live Desk / bucket-inspector sidecar → Pulse Moments embedded two-up
3. Emote Market, Top clips (if any), Channel Screener, Coverage

## Pulse Moments embedded layout (2026-07)

Side-by-side grid inside `.pulse-moments-live--embedded`:

| Column | Component | Behavior |
|--------|-----------|----------|
| **Left (~1.85fr)** | `MostReactedMinutesTable` | Full-width table; `align-self: start` so rows do not stretch when the side column is taller |
| **Right (~0.72fr, min 240px)** | Moment inspector + Selected minute emotes | Flex column; inspector fixed height; bursts panel **fills remaining column height** |

### Moment inspector (pulse-live)

- KPI row uses `pulse-moments__inspector-kpi-row--live-compact`: **Emotes / min**, **Chat / min**, and **Viewers** stay on **one row** (container queries must not wrap live-compact to 2 columns).
- Top emote hero + action buttons (`View moment`, VOD jump, Analytics) sit above the bursts panel.

### Selected minute emotes

- `TopEmoteBurstsPanel` variant `pulse-live` — title **Selected minute emotes**, subtitle **Emote breakdown (by share)**.
- Embedded hub: panel is `flex: 1` in the side column; list body scrolls inside the filled area (`overflow-y: auto`), not a fixed `max-height` chip.
- Empty state still expands to column bottom with centered hint copy.

### Do not regress

- Do not move moment inspector into the chart rail on hub landing (side panel stays in Pulse Moments grid).
- Do not reintroduce `min-height: 11.5rem` on embedded bursts body (session/`?figma=1` dashboards may keep reserved height).
- Do not stretch the moments **table** to match side height (no dead gap under table rows).

## Chart bucket inspector rail (2026-07)

Shared sidecar of network activity chart (300–360px only when its query container can preserve a 720px chart; otherwise stacked):

- **Idle state is Live Desk**; hover or a locked bucket replaces it with the preview-only Activity Bucket Inspector. Never becomes a second Moment Inspector.
- **Selected / preview bucket:** thin **1px full-panel outline** (not thick left bar).
- Emote rank list may use `fill` to distribute rows; provider mix removed from rail.
- Footer (default range): **Top live by activity** — live pool channels ranked by chat/emote rate.

### When a Pulse Moment is selected

- Full moment detail stays in the darker **Pulse Moments** side inspector only.
- Chart accent highlights the moment’s bucket.
- Rail shows **that bucket’s preview** (emotes + stats) plus a short **“Linked to selected moment”** strip (channel · label · Clear).
- No `HubMomentRailBody` / teal moment clone in the rail.

### Do not regress

- Do not place Live Desk and the bucket inspector in separate rails or render both at once.
- Do not synthesize or fetch a bucket solely to satisfy a Newsroom story click.
- Do not reintroduce `.activity-bucket-inspector--moment` as a full moment body.

## Global Activity navigator (2026-08)

The chart owns a client-side `HubChartNavigator` between the time axis and the fixed provider lanes. It changes only the visible subset of the already-loaded 30m / 24h / 7d response; it never changes the requested server range, coverage totals, Newsroom/Live Wire selection, or provider ordering.

- Purple capsule selection with no boxed end handles; invisible 44px handle targets expose visible focus indicators.
- Drag the full-range track or outside a zoomed selection to create a brush. Drag the selected window to pan. Drag either handle to resize with a minimum two-bucket span.
- Ordinary vertical wheel scrolling over the plot or navigator moves the page and is never consumed. Alt+wheel zooms around the cursor; Shift+wheel or horizontal trackpad motion pans the hub navigator's zoomed view. Ctrl/Meta+wheel remains available to browser zoom. The shared `PulseMultiSignalChart` uses the same explicit Alt+wheel zoom rule, while the hub navigator also handles horizontal panning. `preventDefault()` happens only when a surface actually changes its view. Touch surfaces keep `touch-action: pan-y` for the same reason.
- A Zoom graph action is visible beside the range selector above the plot. It uses the same halving rule and locked-bucket focus as the navigator's Zoom in button below the plot, so zoom remains discoverable without an accidental wheel gesture.
- While zoomed, the chart header shows the visible-versus-loaded bucket count and a Show full range action. Resetting the view keeps the selected bucket and its moments filter; the persistent count makes the local zoom clear even when the navigator is below the fold.
- Arrow keys adjust a focused handle, Shift+Arrow moves five buckets, Home/End clamp to the domain, and Reset or a double-click on the navigator track restores the full loaded range.
- Panning can leave a locked bucket outside the visible span without clearing its investigation. In that state, Show selected bucket recenters the current span around the locked bucket.
- Pointer cancellation restores the last committed range. All mutations clamp indices and prevent inverted handles.
- The navigator exposes two ARIA sliders, a concise interaction hint, and a polite visible-range announcement.

## Verification

### Audit repair addendum (2026-09-04)

- Existing discovery remains organized as Overview, Moments, Emotes, and Channels; no parallel Explorer surface is introduced.
- Breadth, Rotation, Momentum, and Anomalies are omitted from primary tabs until their backend-owned fields exist.
- Moment headers expose one primary analytics destination. Active filters name their scope and provide Reset.
- Newsroom detail failures preserve any independently available index summaries and offer Retry, Back to Newsroom, live stories, and Global Activity without synthesizing detail.
- Provider links require provider-qualified IDs; unresolved IDs render without an external link. Empty sparkline data renders copy, not decorative geometry.
- Closure of the approved audit's density findings: the Channel Screener is the single channel collection (the repeated featured channel strip is not mounted). Overview keeps tracked channels/viewers; window peak measurements and collection diagnostics are optional disclosures. The idle sidecar is a compact story teaser, not another full moment collection. The chart, shared bucket sidecar, and full Pulse Moments inspector retain their existing selection contract.
- Mobile exposes the same four section jumps — Overview, Moments, Emotes, Channels — with 44px controls. Secondary interface text is at least 12px; layout must wrap instead of shrinking labels.
- A confirmed offline event establishes an end window between last confirmed live and offline detection. It does not validate an old mutable `EndedAt`; session KPIs show measured span, and Data Quality discloses the end-window evidence.

```bash
cd streampulse-web
npm run check:analytics-overlap
npm run dev:hosted
PORTAL_E2E_MOCKED=1 npx playwright test tests/e2e/analytics-newsroom.portal-mocked.spec.ts --workers=1
npx playwright test tests/e2e/analytics-hub-chart-contract.spec.ts tests/e2e/analytics-hub-live-wire-ticker.spec.ts --workers=1
```

Manual: confirm one shared sidecar at 390, 768, 1280, 1440, and 1600px; any side-by-side chart remains at least 720px wide. Exercise story selection, Back to Live Desk, canonical detail refresh and browser history, all fallback states, keyboard/focus behavior, and reduced motion. Verify a resolved loaded story makes no `/hub/moments` request, and that unavailable Newsroom reads preserve the current Live Wire behavior without adding a second rail.

## Related

- [`analytics-figma-parity-requirements.md`](analytics-figma-parity-requirements.md)
- [`analytics-product-refactor-audit-2026-07-10.md`](analytics-product-refactor-audit-2026-07-10.md)
- [`design.md`](design.md)
- [`../design/streampulse-analytics-hub-design.md`](../design/streampulse-analytics-hub-design.md)
# Discovery inbox and optional preview refinement (2026-09-04)

**Selected-preview update (2026-09-05 implementation continuation):** supersedes
the explicit-click initial-load behavior below, following the owner's request
for automatic previews. Once the selected detection's exact VOD mapping is
verified, mount its official player automatically with `autoplay=false` when
the container supports the player's minimum width. Never mount players for the
result grid or pending/invalid sources. Closing unloads the selected iframe;
reopening is explicit. Source changes get their own preview; automatic loading
does not move keyboard focus. Narrow layouts retain exact external playback.
This does not add exact-frame thumbnails, media storage, or Library sync.

**Live Wire entry action:** Open moment is the primary exact-identity link to
the Moments review; Stream analytics is a secondary contextual link. Save and
Show on chart remain independent, and Show on chart requires a loaded bucket.
Reviews opened from Live Wire or shared links retain an exact result-row focus
target for Back when that detection exists in the loaded collection.

Owner-approved follow-up replaces the older-detection expanding stack with at most five visible, date-labeled detections and a Moments workspace link. A quiet30-minute window must not hide all older results or imply collector failure. Preserve exact chart selection and review/focus holds.

Moments uses the available width for results until selection; selected desktop detail can load the official Twitch VOD iframe only after a verified source mapping and an explicit click. No autoplay, source substitution, clip creation or ReplayForge job admission. Below Twitch's400px minimum player width retain the external VOD action. The iframe origin is allowlisted narrowly in the existing CSP; no script/connect wildcard is added. Actual media playback remains a separate acceptance check from mock iframe-URL tests.

## Exact archive-origin contract integration (2026-09-04 goal continuation)

The owning backend now has a local additive `vodAlignSeconds` / `vodDurationSeconds` / `vodTiming` implementation for exact selected stream detail. Explicit zero differs from absent alignment. Signed fractional alignment maps stream offsets to archive offsets; missing evidence and out-of-range detections do not become timestamp links. Moments and shared stream-analytics recap/selection consumers preserve this distinction. A generic archive link, where retained in stream analytics, is explicitly labeled as lacking the moment time. Saved evidence, current navigation, charts and the restored homepage are unchanged.

The matching synthetic response fixture is verified by backend JSON serialization and consumed by portal tests; it is not a real playback receipt. Local implementation does not deploy the contract to the hosted-first portal's API. Actual mapped-source playback and native clip creation remain open. The full calendar/global-catalogue/creator-scope goal remains tracked separately in the existing control-plane audit ledger; no top-ten sample is presented as a complete daily activity history.

## Mockup integration and sampled playback verification (2026-09-06)

This additive checkpoint supersedes the preview-pending statement above for two
sampled broadcasts only. It does not reinstate the older shared chart sidecar.
Live Wire remains independent of chart hover: flat chronological rows expose
creator/category/time, supplied emote imagery and measured evidence, with quiet
actions. Selecting chart evidence does not replace the discovery feed.

Moments uses a responsive result grid before selection and an independently
sized result list plus review panel after selection. The selected panel places
the full-width 16:9 preview before Save/source actions, measurements and supplied
reaction chips. Source diagnostics are a disclosure when a source is verified;
unavailable sources keep their explanation visible. Phone review is full width;
measurement cells stack and disclosure/fallback targets are at least 44px.
Existing site tokens, fonts, dark surfaces and focus indicators are retained;
there is no decorative gradient or homepage change.

The HTML meta CSP now agrees with the existing header allowlist for the official
Twitch player. Acceptance asserts the iframe document actually loads, not merely
that its `src` is correct. Actual hosted-source playback was also checked without
mocking: OhnePixel stream `317684314595` loaded VOD `2865942971` at 25643 seconds,
and supertf stream `320095765470` loaded VOD `2865483303` at 17053 seconds. Each
video advanced after an explicit Play click. Playback availability for other
archives, native clip creation and the full history/library goal remain open.

Evidence is retained in the portal's local `artifacts/real-playing-*.png` and
`artifacts/final-*.png`; the control-plane audit ledger records tests and worker
review. This checkpoint is local only and does not publish the dirty portal.

### Stored catalogue artwork (local, default-off backend capability)

Initial stored-history cards may now receive exact-broadcast `archiveArtwork`
metadata from the bounded background cache. It is lazy-loaded and explicitly
labeled **Broadcast thumbnail · not the moment frame**. It is not a playable
preview, a category image, or a live-channel thumbnail. There is no per-card
source check or player mount. Malformed optional artwork is ignored while the
detection remains usable. A newer selected-source result takes precedence and
can suppress cached artwork; source actions still require exact verification.
Saved-on-device records exclude artwork URLs and retain their existing scope.

This additive wiring does not change the homepage, chart measurements, independent
Live Wire placement, selection behavior, or typography. It does not activate the
hosted catalogue. Recent hub moments can also carry optional cached artwork into
the Moments gallery, without images in the compact Live Wire rail. Backend migration,
capacity/Helix-budget evidence and real imagery acceptance remain separate gates.

Review navigation keeps one browser-history entry per visit. Selecting Next or
Previous replaces that visit's selected identity; browser Back restores the
originating filtered results and focus, and Forward restores the latest selected
neighbor. It does not create a browser-history entry for every arrow click.

Moments cards use the entire noninteractive card area as the primary review
target, including artwork and emotes. The native headline button supports Enter
and Space. Creator history, Save, and Stream analytics remain independent controls;
Stream analytics preserves the exact login, immutable stream ID and source offset.
Emote hover evidence remains available. Opening a card selects the moment rather
than automatically claiming playback availability.

### Category metadata delivery (local integration)

Category navigation prefers exact optional `categoryId`/`boxArtUrl` carried by
the backend detection. The portal validates standard and IGDB Twitch box-art
URLs against that ID. Invalid metadata is discarded without losing detections;
the rejection marker survives repeated normalization. A name group with
conflicting identities cannot choose another detection's artwork. Existing five
compatibility images remain only when explicit metadata is wholly absent;
unknown/failed/conflicting art renders neutral initials. No per-card lookup,
player mount, category-as-moment preview or saved-media persistence is added.

Card primary accessible names contain the visible reaction label, creator and
source offset; nearby same-creator detections remain distinguishable. Keyboard,
Save, exact analytics links and review Back retain their established behavior.

Avatar enrichment uses a canonical normalized login-set key, so reordering the
same first20 identities does not reset portraits or restart requests. Result
and selected-detail consumers share pending exact-login reads within one API
origin. Each consumer can cancel independently; the final cancellation aborts
the request and cannot cache an abandoned response. Existing per-surface three
workers/20 identities and120-entry cache remain, with an aggregate20 pending
identity cap. Enrichment remains cosmetic portrait data only.

### Missing-artwork reaction snapshot

An unselected result without exact archive artwork may use a compact reaction
snapshot to avoid collapsing into an undifferentiated text card. It may contain
only that detection's supplied chat/emote rates, backend-indicated signal
emphasis, supplied comparison and supplied emote imagery. It is labeled
**Measured evidence · not footage** and must not
look or behave like a player. It performs no source request and has no separate
action. Exact archive artwork, when supplied, replaces it; selected-review lists
remain compact. Category art, mutable live thumbnails and guessed VOD frames are
never substitutes for moment imagery.

### Saved-item preparation revalidation

Saved-on-device records remain metadata-only and never persist a VOD ID, media
URL, ReplayForge handoff reference or source-rights claim. Selecting a Saved item
may add its exact non-negative `momentOffsetSeconds` to the existing sanitized
selected-stream GET. The backend performs the existing bounded exact
login/stream/current-trusted-VOD/offset candidate lookup and omits `handoffRef`
unless exactly one candidate with a positive containing source window is
currently eligible. Resolution repeats current-source and uniqueness checks, so
a later duplicate or changed VOD fails closed.

The portal may show **Prepare clip in ReplayForge** only when that same fresh
selection response also proves a timestamped exact VOD and the default-off
ReplayForge origin is configured. A cached hub reference or saved metadata is
not sufficient. Opening the selection or handoff URL is read-only and does not
admit a clip job; ReplayForge still performs its own sign-in and source-rights
checks. Pending, expired, ambiguous and unavailable sources remain readable and
retryable without substituting another broadcast.

The same fresh exact-selection rule applies to Recent and Sessions. Feed-level
and chart-inspector references are display metadata only; those surfaces route
into exact moment review and cannot launch ReplayForge directly. The exact portal
refresh, browser-side ReplayForge resolver request and ReplayForge response are
non-cacheable.

When the reaction snapshot already renders supplied emotes, the result card does
not repeat the same emotes in a second strip. Cards with exact archive artwork,
compact selected lists and selected detail retain their relevant emote evidence.

### Stored-history category and freshness scope

Stored-history category selection is part of the catalogue request, cursor and
request-generation identity. Selecting a day or creator preserves that category;
changing it aborts the previous request and pagination cannot commit into the new
scope. Returned items must match the requested exact category. Calendar totals
remain explicitly month-and-creator scoped, so category selection does not relabel
whole-month totals as category totals. Search, occurrence and sort remain local to
the supplied collection.

The month view exposes a restrained **Collection status** region for ready/stale
state, oldest projector check in scope and latest supplied measured time. Missing
timestamps render as unavailable. These timestamps do not claim continuous or
complete history, and the existing partial-coverage and stale disclosures remain.

This uses the existing default-off stored catalogue only. Recent remains the
bounded ten-item hub feed: there is no honest cursor or hosted-safe continuation
endpoint for Recent, and `/v1/public/hub/moments` is a bucket-scoped ranking rather
than a chronological next page. Do not join the stored catalogue to Recent or add
“Most reacted” ordering until the backend contract and ranking meaning are approved.

### Live Wire compact action hierarchy

The independent rail keeps one compact action group per detection. **Open moment**
is the mint, primary exact-identity destination; **Save**, **Analytics**, and the
conditional **Chart** action are quiet sibling controls. Chart is present only
when the parent proves the exact detection maps to a loaded bucket. The group is
one 44px row when it fits. At the narrowest stacked-rail width, Open occupies the
first row and three equal-width secondary controls occupy the second; labels and
hitboxes may not overlap or clip. It must not become a full-width outlined card
button or scatter secondary actions away from the group. Each control retains a
specific accessible name, keyboard focus treatment and at least a 44px target
without nesting links or buttons. The compact label `Analytics` still resolves
the exact login, immutable stream ID and source offset; it is not a generic
creator route.

This refinement changes presentation only. It does not change feed ordering,
source truth, saved-device scope, selection holds, comparison measurements,
category provenance, or the separate Moments review/player contract.

### Selected bucket context

The compact chart rail labels bucket duration and the full local date/time interval, including date rollover. Its selected-bucket viewer, chat, and emote values stay visible while the chart header previews another bucket on hover. Chat and emotes are the chart's existing per-minute rates; top-emote counts remain uses across the bucket, or explicitly uses in matching detections when that fallback supplies them. Missing measurements render as unavailable, never measured zero. On wide layouts the rail spans the chart column, with the breakdown and provider rates grouped below the selected values at consistent spacing. It uses the existing chart height without an internal scrollbar; narrow layouts flow below the chart. Detailed detections remain in Pulse Moments below. Section navigation uses the same wrapping, 44px targets, focus styling, and hash-selected state at every width where the horizontal navigation is visible.

The rail uses “Bucket selected” for an explicit chart selection and says that it filters the moments below. Its Clear selection action removes that filter. The label avoids implying that a lock icon denotes restricted access.

The September 23 responsive correction supersedes the older 1360px docking threshold described above. A selected bucket summary docks beside the chart when the activity container reaches 1200px; otherwise it follows the chart in reading order. The docked layout must leave at least 720px for the actual plot canvas, not just its outer column. At the former 1040px threshold the canvas fell to about 599px, while the 1262px review viewport still has enough room to show the summary beside the plot.

The September 24 outer-rail correction moves the sticky left-navigation/Live Wire three-column layout from 1440px to 1536px. At 1440px the former outer rails reduced the actual Global Activity chart canvas to about 650px; the single-column, in-flow Live Wire layout preserves a canvas of at least 720px. At 1536px the sticky rail enters with the selected-bucket canvas above that floor. Live Wire remains one mounted component across the breakpoint, and the bucket inspector still uses its own 1200px activity-container threshold. The local browser audit checks both sides of the 1536px boundary.

### September 8 moment-selection corrections

Selecting a Pulse Moments row opens its inspector without selecting a chart bucket
or replacing the default collection with a bucket request. Chart selection remains
an explicit filter. The moment browser uses two columns only when its container
has at least 1120px; narrower layouts stack the inspector and bound channel names
so they cannot cover timestamps. Re-normalizing emote shares retains their
estimated provenance and labels the denominator as the listed emotes when needed.

Session rows use the unique exact minute's measurements and emotes when present;
otherwise they label the detection snapshot. The selected row includes an inline
review and a source action, with timestamped links only when VOD alignment is
verified. Pulse scores show their /100 scale and explain that they rank reactions.

The global chart puts detailed coverage text behind a disclosure. Hover previews
explicitly preserve the pinned interval. Interval labels consistently display the
exclusive end boundary. Ordinary wheel scrolling moves the page; Alt+wheel zooms,
Shift+wheel pans, and a visible Reset zoom control restores the full window.
The Moments category strip is more compact, and its mobile Filters toggle is
hidden on desktop.

Local validation: portal typecheck and build:ci; 30 focused portal unit tests and
5 analytics-console unit tests; hub regression checks including 390/986/1440px
selection, keyboard navigation, containment, and wheel/reset behavior. Browser
verification of jasontheween's September 8 8:50 PM moment showed 416 chat/min and
94 emotes/min consistently in the row, inspector, and inline review, with a
1h54m19s source link. The wider production-preview public audit still has an
unrelated homepage optional-demo assertion targeting missing
`details.sl-optional-demo`; these checks are not a hosted deployment receipt.

### September 12 Moments navigation simplification

The owner-requested navigation is **Latest → History → Saved**. This supersedes
the separate Recent/Sessions/Saved workspace described above. Latest explicitly
labels its ten-detection live-feed scope; occurrence/month filters do not pretend
to search an archive behind that small feed. Search, category and ordering apply
to loaded results. The backend selects the highest-scoring detected peaks from
currently live sessions before Latest sorts the supplied set by occurrence time.
Those peaks can predate the Global Activity chart range; the hub response labels
the feed `livePulseMomentsScope=current_live_session_peaks` for this reason.
Saved remains a browser-local shortlist.

History exposes the **Activity calendar** and groups indexed detections by creator
and immutable broadcast identity. A card opens the existing stream timeline at
`/analytics/:login/:streamId`; it does not open a second session-detail workspace.
Cards report loaded detection counts, not full-broadcast coverage. After choosing
a day, the calendar collapses behind “Change day or creator” to keep broadcasts
visible on mobile. Coverage details and shading controls share one disclosure.

The existing stream console is the broadcast home for its measured timeline and
recap. Return navigation preserves the originating Moments URL. A selected stream
minute can be saved through the portal-owned action. Old `view=sessions` links
resolve their authoritative story identity into this same console; unresolved
links retain a retry action, and exact offsets transfer only for matching stream
and creator identities. Old `collection=history` links still select History.

Dropdown surfaces use an opaque panel color. A failed discovery service remains
an explicit unavailable state with retry and a creator-broadcast fallback, never
an empty archive. Local hosted discovery returned HTTP 503 during verification;
fixture calendar tests are UI evidence, not proof of hosted archive availability.
