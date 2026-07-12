# Hub Moment Selection Intent Design

**Status:** Approved direction  
**Scope:** `streampulse-web` hub landing only  
**Routes audited:** `/analytics`, `/analytics/jasontheween/2026-07-10`

## Goal

Make hub selection feel intentional and non-duplicative: one selected moment,
one chart bucket preview rail, and one full Moment Inspector.

## Audit summary

The hub already has the correct component boundaries:

- `AnalyticsLandingPage` owns `selectedMomentKey`, locked bucket, and hover bucket.
- Live Wire, chart markers, Pulse Moments rows, chart accent, and the dark
  Moment Inspector consume the shared moment selection.
- The chart rail renders bucket facts plus a linked-moment strip. It does not
  render a second full inspector.

Three semantic defects remain:

1. The child auto-selection effect creates a linked moment on page load,
   displacing the range inspector and disabling chart hover preview. It also
   makes Clear immediately reselect a default.
2. Pulse Moments can show “Click an activity chart bucket…” while the table
   already contains moments.
3. A chart marker key missing from the current lookup pool can become selected,
   producing a marker state without matching inspector data.

The Jason session route resolves its date slug through the linked
`@streampulse/analytics-console` package. Its late viewer-coverage notice is
already deduplicated. Remaining recap/KPI/quality-banner duplication and
1024–1279px ordering issues are owned by the sibling backend package and are
outside this implementation slice.

## Selection contract

`AnalyticsLandingPage` remains the single owner of hub selection. Moment
selection is either a real moment key or `null`. The hub starts with `null` so
the chart rail owns its default range preview and chart hover remains
available. Only explicit user interaction creates a selected moment.

Selecting a moment clears a locked/hovered bucket. Locking or clearing a chart
bucket clears moment selection. Hover remains preview-only and cannot become a
durable selection.

## Component behavior

### `AnalyticsLandingPage`

- Initialize `selectedMomentKey` as `null`.
- Pass the controlled value to Pulse Moments.
- Continue deriving `selectedMoment` and `accentBucketT` from the page-owned
  key.
- Ignore chart marker keys that are not present in the current moment lookup
  pool.
- Keep the linked-strip Clear action as an explicit transition to `null`.

### `PulseMomentsLivePanel`

- Do not auto-select a controlled hub moment.
- Treat `null` or an omitted controlled key as an intentional blank
  inspector/table selection.
- Show the bucket invitation only when the network feed has no moments at all,
  not when a populated table is already visible or a filter merely has no
  matches.

### Chart rail and dark inspector

- The chart rail remains preview-only: range, hover bucket, or locked/accented
  bucket facts plus the short linked strip.
- The dark inspector beside Pulse Moments remains the only full moment-detail
  surface.
- No CSS or layout restructuring is part of this slice.

## Data and honesty constraints

- Use only backend-provided moments, scores, labels, emotes, and activity
  buckets.
- Do not add client Pulse scoring, inferred screener semantics, fake clips, or
  raw chat.
- Keep hosted API behavior and existing polling/fetch contracts unchanged.

## Error and empty states

- Unknown marker keys are ignored rather than represented as partial
  selections.
- A network feed with no moments may invite the user to inspect a chart bucket.
- A populated feed never shows that invitation.
- An explicit clear leaves the full inspector unselected until the user chooses
  a moment or bucket.

## Verification

Use tests first for each behavior:

1. Controlled hub rendering does not invent an initial selection.
2. Controlled `null` remains unselected.
3. A populated network feed suppresses the chart-bucket invitation.
4. Live Wire selection coordinates marker, table row, linked strip, chart
   accent, and dark inspector.
5. Clearing the linked strip removes the coordinated selection without
   immediate reselection.

Run:

```bash
cd streampulse-web
npm test -- --run tests/pulseMomentsLivePanel.test.tsx
npx playwright test tests/e2e/analytics-hub-ux.spec.ts tests/e2e/analytics-hub-live-wire-ticker.spec.ts --workers=1
npm run check:analytics-overlap
npm run typecheck
```

## Deferred session follow-up

In `streampulse-backend/packages/analytics-console`, separately:

- pass the chart-selected offset into `SessionRecapMomentsStrip`;
- consolidate chart-inline quality notices with their page-level owner;
- fix the three-column order reset at the `lg` breakpoint;
- evaluate gating the standalone recap when recap moments already own the same
  facts.

That work requires sibling-package tests and `npm install` in
`streampulse-web`; it is not mixed into this hub-only change.
