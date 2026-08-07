# Live Activity lifecycle design

**Status:** Implemented locally (ledger + portal); hosted shadow/promotion pending  
**Date:** 2026-07-23  
**Owners:** StreamPulse backend (ledger and API), StreamPulse portal (activity experience)

## Summary

Replace the portal's browser-inferred `Pool Wire` lifecycle presentation with a
server-owned stream-session ledger and a primary **Live Activity** timeline.
The timeline answers one user question: which tracked streamers were confirmed
live or observed offline recently?

The current signal and coverage concepts remain useful, but they must not be
presented as Twitch lifecycle truth:

- **Live Activity** shows confirmed stream-session transitions.
- **Signal Wire** shows recent chat, emote, viewer, and peak activity.
- **Coverage** explains which channels StreamPulse is tracking and whether its
  metadata is current.

Twitch EventSub is a later accuracy and latency upgrade. It will feed the same
ledger; it is not required for the first implementation.

## Problem

The current `Pool Wire / Tracked live set / POOL Stable` presentation combines
three different ideas:

- an inferred `stream_opening` signal,
- browser-observed membership in the StreamPulse tracking pool,
- and the absence of a recently emitted local event.

`Entered live set` and `Left live set` describe StreamPulse roster membership,
not Twitch online or offline transitions. `POOL Stable` only means that the
current browser has not emitted a pool event. The state resets with the page and
can differ across browsers. These semantics are technically narrow but do not
match what users reasonably expect from a live activity feed.

## Goals

- Show durable, deduplicated `went_live` and `went_offline` events.
- Keep the same recent history across reloads and browsers.
- Use Twitch's stream start time when it is available.
- Label offline time honestly as an observation, not an exact Twitch stop time.
- Prevent failed polls, stale data, capacity changes, and IRC state from
  manufacturing lifecycle events.
- Keep tracking coverage and signal peaks visible in separately named surfaces.
- Allow EventSub to improve the ledger later without changing the portal
  contract or UI model.

## Non-goals

- Claiming coverage of all Twitch channels.
- Inferring an exact offline timestamp from metadata polling.
- Treating IRC connection state as stream lifecycle state.
- Treating entry to or eviction from the StreamPulse tracking pool as a Twitch
  lifecycle event.
- Replacing Pulse Moments or moving its inspector into the chart rail.
- Implementing EventSub in the initial release.
- Falling back to browser-local lifecycle inference when the server endpoint is
  unavailable.

## Product vocabulary

| Surface | Meaning | Example labels |
|---|---|---|
| Live Activity | Confirmed stream-session transitions | Went live, Went offline |
| Signal Wire | Recent measured activity and peaks | Chat spike, Emote burst, Viewer rise |
| Coverage | StreamPulse tracking and metadata health | 286 tracked channels, Metadata current |
| Pulse Moments | Durable investigation candidates | Existing moment labels and inspector |

Do not use `Pool Stable` in the lifecycle experience. A lack of events is not a
claim that Twitch, the tracked pool, or backend processing is stable.

## Lifecycle truth model

### Event semantics

`went_live` is emitted when a successful Twitch metadata observation first
confirms a new `stream_id` for a channel.

- `occurredAt` is Twitch `started_at`.
- `detectedAt` is when StreamPulse confirmed the stream.
- `timestampPrecision` is `twitch_started_at`.
- The event is not inferred from an early peak or IRC activity.

`went_offline` is emitted after two consecutive successful metadata
observations for that channel report no active stream.

- `occurredAt` is the second confirmation's detection time.
- `detectedAt` is the same server observation time.
- `lastSeenLiveAt` records the final successful live observation.
- `timestampPrecision` is `observed_after_confirmation`.
- Portal copy must say `Observed offline`, never imply an exact stop time.

### Healthy observation boundary

Absence is meaningful only for a channel included in a successfully completed
metadata request. Each reconciliation input must identify the requested channel
set and whether that request completed successfully.

- A failed, timed-out, partial, or stale request does not advance absence
  confirmation.
- A channel omitted because of capacity, eligibility, or tracking-pool changes
  does not advance absence confirmation.
- IRC disconnects and chat-ingest health do not affect lifecycle state.
- Reappearance before the second successful absence clears the pending absence.

### Stream replacement

If a successful observation reports a new `stream_id` while a different stream
session is still active in persisted state, the reconciler closes the previous
session as `observed_after_confirmation` at detection time and opens the new
session from its Twitch `started_at`. The unique event keys keep both operations
idempotent. This handles a missed offline interval without merging two Twitch
sessions.

### Deduplication

The event ledger enforces a unique key on:

```text
(channel_id, stream_id, event_kind)
```

Repeated polls, retries, process restarts, and concurrent reconciliation cannot
create duplicate lifecycle rows. A new Twitch `stream_id` always represents a
new session.

### Source and precision

Initial event source:

```text
metadata_poll
```

Future EventSub source:

```text
eventsub
```

Source and precision are independent. EventSub can eventually provide a more
precise offline timestamp, while metadata polling remains reconciliation and
recovery.

## Persisted state

The backend needs two durable concepts.

### Current observation state

One record per channel holds the reconciliation state required across worker
restarts:

```text
channel_id
active_stream_id
active_started_at
last_seen_live_at
last_successful_observation_at
pending_absence_count
pending_absence_since
updated_at
```

`pending_absence_count` advances only on successful observations that explicitly
included the channel. It returns to zero when the active stream reappears.

### Lifecycle event ledger

Each immutable event contains:

```text
id
kind
channel_id
channel_login
channel_display_name
stream_id
occurred_at
detected_at
last_seen_live_at
timestamp_precision
title_snapshot
category_snapshot
source
created_at
```

The portal does not receive internal poll topology, credentials, or operator
details. Existing sanitized public channel identity and image fields may be
projected into the response.

## Reconciliation state machine

For each channel in a successful metadata observation:

1. No persisted active session and no live stream: persist the healthy
   observation only.
2. No persisted active session and a live `stream_id`: persist the session and
   emit one `went_live` event.
3. The persisted and observed `stream_id` match: update last-seen timestamps,
   clear pending absence, and emit nothing.
4. A persisted active session is absent for the first successful observation:
   set pending absence to one and emit nothing.
5. It is absent for the second consecutive successful observation: emit one
   `went_offline` event, clear active-session state, and clear pending absence.
6. It reappears before step 5: clear pending absence and emit nothing.
7. A different live `stream_id` appears: close the previous session as observed
   offline, open the new session, and emit the idempotent events for both
   transitions.
8. The metadata observation is failed, partial, stale, or does not include the
   channel: make no lifecycle transition.

The state update and event insertion must be transactional so a worker restart
cannot persist one without the other.

## Initial rollout behavior

The first deployment seeds the current observation state from successful
metadata without fabricating historical events.

- Currently live sessions may populate a separate current-state projection.
- Seeded sessions do not create retrospective `went_live` rows.
- Channels absent during seeding do not create `went_offline` rows.
- Only transitions observed after seeding enter the activity ledger.

This prevents a deployment-time flood of false offline events.

## Portal API

### Request

```http
GET /v1/portal/analytics/live-activity?window=6h&limit=20&kind=all
```

Supported query behavior:

- `window`: server-supported recent window, default `6h`.
- `limit`: bounded result count, default and maximum `20` for this surface.
- `kind`: `all`, `went_live`, or `went_offline`.

Results are newest first by `occurredAt`, with `detectedAt` as a deterministic
tie-breaker.

### Sanitized response

```json
{
  "asOf": "2026-07-23T12:00:00Z",
  "window": "6h",
  "completeness": "tracked_channels_only",
  "metadata": {
    "state": "current",
    "lastSuccessfulPollAt": "2026-07-23T11:59:40Z"
  },
  "events": [
    {
      "id": "stable-server-event-id",
      "kind": "went_live",
      "channel": {
        "id": "channel-id",
        "login": "channel_login",
        "displayName": "Channel Name",
        "avatarUrl": "https://sanitized-image-url"
      },
      "streamId": "twitch-stream-id",
      "occurredAt": "2026-07-23T11:53:12Z",
      "detectedAt": "2026-07-23T11:54:01Z",
      "lastSeenLiveAt": null,
      "timestampPrecision": "twitch_started_at",
      "title": "Stream title snapshot",
      "category": "Category snapshot",
      "source": "metadata_poll"
    }
  ]
}
```

`metadata.state` is one of `current`, `degraded`, `stale`, or `unavailable`.
Degraded metadata does not cause the endpoint to manufacture events. The portal
may continue to show the last successful response with an explicit health
notice and update time.

### Error behavior

- Endpoint failure displays `Live activity unavailable` and the last successful
  update when one exists.
- The portal does not infer replacement events from pool snapshots.
- A successful empty response displays the defined empty state, not an error or
  stability claim.

## Main portal experience

### Panel

**Title:** Live Activity  
**Subtitle:** Recent streamer status changes

The default view covers the latest six hours, shows at most 20 rows, and sorts
newest first.

Filters use a compact segmented control:

- All
- Went live
- Went offline

### Timeline row

Each row shows:

- channel avatar and display name,
- `Went live` or `Went offline`,
- relative time with exact time available in details or tooltip,
- title and category snapshot when available,
- `Confirmed start` for Twitch start timestamps,
- `Observed offline` and last-seen-live detail for poll-confirmed endings.

Missing title or category remains absent or explicitly unavailable. The UI does
not invent values.

Selecting a row opens the existing channel analytics context. It does not add a
second Moment Inspector or move the inspector into the chart rail.

### New-event behavior

The portal records server event IDs present in the initial successful response.
Only IDs first received after that baseline may receive a restrained `New`
marker. Reloading the page does not reinterpret old events as new lifecycle
transitions.

### Empty and degraded states

Successful empty state:

```text
No confirmed stream changes in the last 6 hours
Last checked <relative time>
```

Degraded state keeps the timeline honest:

```text
Live activity may be delayed
Metadata last updated <relative time>
```

Unavailable state:

```text
Live activity unavailable
Last successful update <relative time>
```

Never replace these states with `POOL Stable`.

## Coverage placement

Tracking-pool status moves to a compact Coverage diagnostic outside the
lifecycle timeline, for example:

```text
286 tracked channels - metadata current
```

It links to existing coverage diagnostics. Copy must say that the pool covers
StreamPulse-tracked channels, not all Twitch channels. Pool membership changes
may remain available for operations diagnostics, but they are not user-facing
stream lifecycle rows.

## Signal Wire placement

The current fresh peak/momentum lane remains separate and is renamed or labeled
as **Signal Wire**. It stays attached to chart and Pulse Moments workflows and
uses measured labels such as:

- Chat spike
- Emote burst
- Viewer rise

It must not emit `Went live` or `Went offline` from peak inference. Pulse Moments
continues to own durable investigation and the existing two-up inspector layout.

## Rollout

Independent controls (defaults **off** in production until evidence gates pass):

| Writer (`LIVE_ACTIVITY_LIFECYCLE_WRITER_ENABLED`) | Shadow (`LIVE_ACTIVITY_LIFECYCLE_SHADOW_ENABLED`) | Portal read (`LIVE_ACTIVITY_LIFECYCLE_PORTAL_READ_ENABLED` / `VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED`) | Expected behavior |
| --- | --- | --- | --- |
| false | false | false | No collection and no promoted lifecycle surface |
| true | true | false | Ledger writes + genuine per-poll shadow metrics/evidence; portal panel omitted |
| true | false/true | true | Promoted server-owned Live Activity (writer must remain on) |
| false | any | true | Backend returns `live_activity_disabled`; portal must not present historical ledger as active |

Do not treat a single boolean as all three stages. Do not reintroduce browser-local
Pool Wire inference when portal read is disabled. Production builds ignore
`sessionStorage sp.liveActivityPortalRead`; that override is limited to
development/test modes for intentional E2E opt-in.

### Concurrent observation ordering

Advisory locks serialize per-channel transactions but do not guarantee
`ObservedAt` arrival order. Policy:

- Newer committed observations win; older live observations never regress state.
- A late-arriving confirmed absence may still complete a pending offline when it
  is a distinct sibling confirmation for the same live session (`ObservedAt`
  after `LastSeenLiveAt`, distinct from `PendingAbsenceSince`). Offline
  `occurredAt` uses the later confirmation time so reversed lock order still
  yields exactly one offline and inactive final state.
- Duplicate delivery remains idempotent via `(channel_id, stream_id, event_kind)`.

### Metadata poll health

Distinct watermarks:

- `pollCompletedAt` — latest attempted batch completion
- `lastSuccessfulPollAt` — latest batch with ≥1 successful channel (not advanced on all-failed)
- `lastFullySuccessfulAt` — latest fully successful batch

Partial batches are never `current` and age `degraded → stale → unavailable`
from `pollCompletedAt`. Pending-absence metrics refresh once per poll batch,
not per channel apply.

### Stage 1: ledger and endpoint

- Add persisted observation state and lifecycle events in the backend.
- Reconcile only successful metadata observations.
- Expose the sanitized portal endpoint behind the existing portal BFF boundary.
- Add event, pending-confirmation, delay, dedupe, and metadata-health metrics.
- Writer may be enabled for local/dev; production writer stays off until Stage 2.

### Stage 2: shadow validation

- Enable writer + shadow without portal read promotion.
- Compare emitted events with the underlying successful metadata observations.
- Exercise worker restart, retry, disappearance, reappearance, and stream-ID
  replacement cases.
- Do not promote based only on browser screenshots.

### Stage 3: portal promotion

- Enable portal read only after the accuracy gates pass.
- Replace the primary Pool Wire presentation with Live Activity.
- Remove browser-local lifecycle inference from the primary experience.
- Move pool membership to Coverage diagnostics.
- Keep the existing peak feed as Signal Wire.

### Stage 4: EventSub upgrade

- Write EventSub transitions into the same ledger and unique keys.
- Keep metadata polling as reconciliation and recovery.
- Prefer the more precise source while preserving provenance and timestamp
  precision in each event.

## Accuracy and release gates

The lifecycle experience is ready for promotion only when all of these are
demonstrated:

- The same server history appears across browsers and reloads.
- Worker restarts and retries do not duplicate events.
- A failed, partial, or stale metadata poll creates no lifecycle transition.
- IRC disconnects create no lifecycle transition.
- Capacity eviction and tracked-pool changes create no lifecycle transition.
- One successful absent observation creates no offline event.
- Reappearance before the second confirmation clears pending absence.
- A second consecutive successful absence creates exactly one `went_offline`
  event within two successful polling intervals.
- A new `stream_id` creates a distinct stream session and one `went_live` event.
- A directly observed stream replacement closes the previous session without
  merging it into the new one.
- Starts display Twitch `started_at` as `Confirmed start`.
- Endings display detection time as `Observed offline` and expose last-seen-live.
- Metadata freshness and degradation are visible without fabricated rows.
- Endpoint failure does not activate browser-local lifecycle inference.

## Observability

Record at minimum:

- lifecycle events emitted by kind and source,
- unique-key dedupe conflicts,
- pending offline confirmations,
- start detection delay,
- offline confirmation delay,
- successful and failed metadata observations,
- age of the last successful metadata observation,
- lifecycle endpoint errors and response freshness.

Metrics must not include raw chat or private operator data.

## Required tests

Backend tests:

- first live observation emits one start,
- repeated matching stream ID emits nothing,
- first absence remains pending,
- second healthy absence emits one ending,
- reappearance clears pending absence,
- failed and partial polls do not advance pending state,
- unrequested and capacity-evicted channels do not advance pending state,
- restart and retry preserve deduplication,
- new stream ID creates a new session and closes the old one,
- initial seeding creates no historical event flood,
- endpoint filters, ordering, limits, health, and completeness are sanitized.

Portal tests:

- all three filters show the correct server rows,
- confirmed starts and observed endings use different precision copy,
- empty, degraded, stale, unavailable, and recovered states remain distinct,
- new markers are based on server IDs received after baseline,
- reload uses server history rather than inferred pool events,
- selecting a row opens existing channel analytics context,
- Coverage and Signal Wire remain separate from lifecycle,
- no second Moment Inspector or chart-rail inspector is introduced.

## Completion claims

An implementation may claim a server-owned Live Activity lifecycle feed only
after the ledger, endpoint, portal tests, shadow evidence, and promotion gates
above pass. It must not claim:

- exact Twitch offline timestamps from metadata polling,
- all-Twitch coverage,
- EventSub support before it is implemented,
- lifecycle accuracy based on tracking-pool membership,
- or global stability from an empty recent-event window.
