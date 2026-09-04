# Live Wire moment system

| | |
|---|---|
| **Status** | Active (2026-09) |
| **Surfaces** | `/analytics` Live Wire activity rail, Pulse Moments, Global Activity |
| **Owners** | StreamPulse backend detection; portal projection and interaction |

## Product role

Live Wire is the command center's browse-and-focus layer for verified moments in
currently live broadcasts. It is not a one-card alert, a Pulse Explorer replacement,
or an independent client-side ranking model.

- **Live Wire** answers: _what measured audience reactions are happening across
  current streams, and where are they on the activity chart?_
- **Pulse Explorer** answers: _which exact broadcasts had meaningful activity,
  how did their qualified moments develop over live, 24h, or 7d, and what
  approved outside context was matched?_
- **Pulse Moments** answers: _what are the detailed minute facts and evidence for
  the selected moment?_

Live Wire therefore owns the Global Activity right rail while idle, where its
cards can directly preview or select chart buckets. A chart preview or locked
selection replaces the visible rail pane with the bucket inspector. Pulse
Pulse Explorer remains a separate route and is represented on the overview only
by a navigation link. It groups the qualified pipeline by exact stream session;
it does not turn Live Wire into a general news or social feed.

## Authoritative moment pipeline

The backend owns detection and score semantics. For an ordered set of
one-minute rollups from one exact stream session:

1. **Identity and coverage gate.** Accept only the current canonical stream
   identity. Closed sessions, stale aliases, future offsets, materially
   over-age offsets, missing windows, and corpus-only data fail closed.
2. **Extract six signals.** Chat count, total emote count, viewer change,
   provider-specific emote activity, top-emote dominance, and top-emote
   novelty are calculated per minute. Count signals use `ln(value + 1)`.
3. **Normalize within the broadcast.** Each signal is independently converted
   to a population z-score across that stream. A moment is surprising relative
   to its own audience, not merely large because the channel is large.
4. **Calculate reaction score.** Only positive surprise contributes:

   ```text
   R = clamp(0, 100,
       round(30 * (
         .25·chat_z+ + .20·emote_z+ + .15·provider_z+
         + .10·dominance_z+ + .10·novelty_z+
       ) / .80))
   where z+ = max(0, z)
   ```

   Viewer momentum is emitted separately as context and is excluded from `R`.
   This prevents a raid or directory movement from becoming "Most Reacted"
   without chat or emote evidence.
5. **Causal smoothing.** Apply a forward-only EWMA with alpha `0.5`. A future
   minute can never retroactively increase an earlier minute.
6. **Collapse one event to one peak.** At score `20` or above, non-maximum
   suppression retains the strongest minute within a three-minute radius.
   Equal scores choose the earlier minute deterministically.
7. **Qualify peaks.** Require at least five completed measured rollups, remove
   the still-open live minute, reject score zero and viewer-only reasons, then
   retain peaks at or above 25% of that session's maximum reaction score. A
   session exposes at most 20 qualified peaks.
8. **Attach evidence.** Emit the server score, reason/kind, event minute,
   stream offset, up to three top emotes, confidence, viewer context, category, and the
   measured event-minute comparison with the current stream's history before
   the event. Missing comparison coverage remains explicitly unavailable.
9. **Build the network set.** Inspect up to 12 IRC-eligible live channels,
   consider at most five peaks per channel, rank candidates by reaction score,
   then chat rate and offset, and return at most 10 network moments.

The formula above documents the current `v1:reaction-v1` backend contract. A
weight or threshold change requires a scoring-version change, fixtures, and a
relevance evaluation; it must never be silently reproduced or tuned in the
browser.

## Portal projection

The browser may filter and reorder the bounded backend result, but it does not
change membership or calculate a new score.

### Scope

- **Current streams** is the default and shows every loaded qualified moment
  for the current live sessions, including moments older than 30 minutes.
- **Last 30m** narrows that same loaded set to fresh detections.
- The portal removes only same-channel detections within a 10-minute display
  window. The distance is absolute so newest-first input cannot accidentally
  discard every earlier detection from a channel.

### Signal and category

- **All signals**, **Chat**, and **Emotes** filter by the backend-authored
  dominant kind. Viewer-only events are not promoted as reaction moments.
- Category keys are normalized only for matching. Display labels preserve the
  backend value; absent categories are grouped as **Uncategorized**.
- Category facets are derived after the signal filter so their counts always
  describe the visible candidate set.

### Ordering

| Order | Deterministic keys |
|---|---|
| Newest first | event time desc → backend score desc → stable moment identity |
| Strongest first | backend score desc → event time desc → stable moment identity |
| Category groups | group peak score desc → group latest event desc → label; moments within each group newest first |

No option implies global completeness beyond the returned network cap. The UI
labels the result **Backend-scored snapshot** for that reason.

## Chart interaction

Selecting a loaded moment uses a restrained two-part transition: its card
settles into a full perimeter outline, and its resolved chart bucket draws a
vertical line with a centered node and a single expanding ring. The outline is
the persistent state; there is no left-edge selection stripe. Reduced-motion
mode renders the same final state without animation.

- Hovering or focusing a card softly accents its loaded activity bucket without
  replacing the Live Wire pane. A detection in the omitted trailing open
  interval may resolve to the immediately preceding completed bucket, which the
  inspector labels as a nearest-completed relationship.
- Leaving or blurring clears only the preview.
- Clicking locks the moment and bucket, exchanges the rail for the existing bucket inspector,
  and feeds the detailed Pulse Moments inspector.
- **Back to Live Wire** or Escape clears the lock and restores the preserved
  filters and moment-list scroll position.
- A card becomes a selection button only after exact stream identity and a
  truthful already-rendered bucket are proven. Otherwise the rail keeps it
  visible but disabled with a pending-bucket explanation; it never redirects a
  click to channel analytics and never synthesizes or fetches a bucket just to
  make an interaction appear to work.
- Keyboard focus has the same preview behavior as pointer hover. Reduced-motion
  mode removes lift and entrance motion without removing focus indication.

## Capacity boundary and next expansion

The redesigned surface displays the complete current bounded response (up to
10 network moments) in one dense, vertically scrollable editorial rail. Increasing
that cap is not a CSS change: the backend would need cursor pagination or a
category-aware retrieval contract so low-volume categories are not starved by
the top-12 channel scan. That work belongs with Explorer cursor pagination and
relevance evaluation, not an unbounded portal fetch.

## Acceptance checks

- Current streams can show multiple well-separated moments from the same
  channel; detections within 10 minutes remain collapsed.
- Signal/category filters and all three order modes are deterministic.
- Cards contain only backend-provided evidence and never manufacture a
  comparison, confidence, image, or score.
- Hover/focus previews and click selection address an exact or disclosed
  nearest-completed served chart bucket without navigation.
- Non-resolving rail cards remain visibly disabled instead of becoming links.
- At most three real backend-provided emotes appear on each card.
- No horizontal overflow at 390, 768, 1119, 1280, 1440, and 1600px.
- The activity rail sits beside the chart at the ordinary 1119px app viewport
  and directly after it at narrow widths.
- Pulse Explorer is a separate route; `/analytics` does not request or render its broadcast feed.
- Live Wire and Pulse Explorer surfaces use neutral backgrounds, equal perimeter
  borders, and semantic color only—no decorative gradients, glow, or left stripe.
