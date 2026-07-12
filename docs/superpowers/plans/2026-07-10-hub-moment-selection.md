# Hub Moment Selection Intent Implementation Plan

> **For the AI agent working this:** Required sub-skill: use
> superpowers:executing-plans to implement this plan task by task.

**Goal:** Make hub moment initialization, explicit clearing, chart preview, and
the single dark inspector behave as one intentional selection model.

**Architecture:** `AnalyticsLandingPage` keeps ownership of moment, locked
bucket, and hover state. The hub starts without a selected moment so the range
rail and hover preview remain available. A key coordinates all linked surfaces
only after explicit user selection; `PulseMomentsLivePanel` never invents a
controlled selection.

**Tech stack:** React 18, TypeScript, Vitest, Testing Library, Playwright.

## Files

- Create `streampulse-web/tests/pulseMomentsLivePanel.test.tsx` — focused
  controlled-selection and banner regression tests.
- Modify
  `streampulse-web/src/ui/components/analytics/PulseMomentsLivePanel.tsx` —
  preserve controlled selection intent and suppress redundant bucket copy.
- Modify `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx` —
  start unselected and reject unresolved marker keys.
- Modify `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` — verify the full
  Live Wire → chart/table/rail/inspector interaction and sticky clear.

## Task 1: Add failing controlled-selection tests

**Files:**

- Create `streampulse-web/tests/pulseMomentsLivePanel.test.tsx`

**Step 1: Add a minimal real hub fixture and render helper**

Use `MemoryRouter`, `AnalyticsThemeProvider`, a two-row `network` feed, and
`hubCorpusPipelineFixture`. Mock GSAP in the same shape as existing analytics
component tests.

```tsx
const feed: LivePulseMomentsResult = {
  source: 'network',
  moments: [
    {
      login: 'xqc',
      displayName: 'xQc',
      streamId: 's1',
      offsetSeconds: 120,
      score: 92,
      label: 'Twitch emote spike',
      kind: 'emote_spike',
      at: Date.now() - 60_000,
      chatPerMin: 393,
      emotesPerMin: 133,
      viewers: 12_000,
      topEmotes: [{ name: 'DinoDance', provider: 'twitch', count: 123 }],
    },
  ],
}
```

The `PublicHub` fixture must contain the required aggregate, coverage,
pipeline, activity, emote-intel, top-emote, live-channel, and featured-session
fields. No network request is needed because no chart bucket is selected.

**Step 2: Add the no-initial-selection test**

```tsx
it('does not invent an initial selection for a controlled hub', async () => {
  const onSelectMoment = vi.fn()
  renderPanel({ selectedMomentKey: undefined, onSelectMoment })

  await waitFor(() => {
    expect(screen.getAllByText('Twitch emote spike').length).toBeGreaterThan(0)
  })
  expect(onSelectMoment).not.toHaveBeenCalled()
  expect(document.querySelector('.pulse-moments__peak-row.is-active')).toBeNull()
})
```

**Step 3: Add the explicit-clear regression**

```tsx
it('keeps an explicit controlled clear instead of auto-selecting again', async () => {
  const onSelectMoment = vi.fn()
  renderPanel({ selectedMomentKey: null, onSelectMoment })

  await waitFor(() => {
    expect(screen.getByText('Twitch emote spike')).toBeTruthy()
  })
  expect(onSelectMoment).not.toHaveBeenCalled()
  expect(document.querySelector('.pulse-moments__peak-row.is-active')).toBeNull()
})
```

**Step 4: Add the populated-feed banner regression**

```tsx
it('does not invite bucket selection while network moments are already visible', () => {
  renderPanel({ selectedMomentKey: null, onSelectMoment: vi.fn() })

  expect(
    screen.queryByText('Click an activity chart bucket to see spikes for that period.'),
  ).toBeNull()
})
```

**Step 5: Run red**

```bash
cd streampulse-web
npm test -- --run tests/pulseMomentsLivePanel.test.tsx
```

Expected: both controlled-selection tests report unwanted `onSelectMoment`
calls, and the populated-feed test finds the redundant bucket invitation.

**Commit:** Do not commit; the user has not authorized commits.

## Task 2: Implement the minimal controlled-selection behavior

**Files:**

- Modify
  `streampulse-web/src/ui/components/analytics/PulseMomentsLivePanel.tsx`
- Modify `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`

**Step 1: Remove controlled hub auto-selection**

Delete the hub-controlled auto-selection effect. Controlled selection comes
only from page-owned user interactions. Remove `momentKeyInList` from the
imports because the deleted effect was its only caller.

**Step 2: Gate the bucket invitation on an actually empty feed**

```tsx
if (
  feed.source === 'network' &&
  selectedBucketT == null &&
  allMoments.length === 0 &&
  activityWindow !== '30m'
) {
  return 'Click an activity chart bucket to see spikes for that period.'
}
```

Add `allMoments.length` to the memo dependency list. Remove
`momentKeyInList` from the imports because the initialization effect no longer
uses it.

**Step 3: Keep page state explicitly unselected by default**

```tsx
const [selectedMomentKey, setSelectedMomentKey] = useState<string | null>(null)
```

User clears, bucket locks, and range changes set `null`. A real user selection
sets a string key.

**Step 4: Reject orphan marker keys and remove the dead component import**

```tsx
import { isLiveWireEventFresh } from '../../ui/components/analytics/HubLiveWireFeed'
```

```tsx
onSelectMomentKey={(key) => {
  const moment = momentLookupPool.get(key)
  if (moment) handleSelectMoment(moment)
}}
```

**Step 5: Run green**

```bash
cd streampulse-web
npm test -- --run tests/pulseMomentsLivePanel.test.tsx
```

Expected: all focused tests pass with no warnings.

**Commit:** Do not commit; the user has not authorized commits.

## Task 3: Add full interaction regression coverage

**Files:**

- Modify `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts`

**Step 1: Assert explicit coordinated selection**

Add a test using the existing `installHubUxMock`:

```ts
test('Live Wire selection coordinates one inspector and clear remains cleared', async ({ page }) => {
  const errors = attachConsoleErrorGuard(page)
  await page.goto('/analytics')

  const liveWire = page.locator('#section-live-wire')
  const sodaChip = liveWire.locator('button.hub-live-wire__chip', { hasText: 'sodapoppin' })
  await expect(sodaChip).toBeVisible()

  // The range inspector remains the default until the user selects a moment.
  await expect(page.locator('.pulse-moments__peak-row.is-active')).toHaveCount(0)
  await expect(page.getByTestId('bucket-inspector-linked-moment')).toHaveCount(0)
  await expect(page.locator('.pulse-moments-live__side .pulse-moments__inspector')).toBeVisible()
  await expect(page.locator('.activity-bucket-inspector .hub-moment-rail')).toHaveCount(0)
  await expect(page.locator('.pulse-moments-live__banner')).toHaveCount(0)

  // Selecting Live Wire must update the same surfaces, not navigate.
  await sodaChip.click()
  await expect(sodaChip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.hx-moment-marker.is-selected')).toHaveCount(1)
  await expect(page.locator('.pulse-moments__peak-row.is-active')).toContainText('sodapoppin')
  await expect(page.getByTestId('bucket-inspector-linked-moment')).toContainText('sodapoppin')

  // Explicit clear must not be overwritten by default selection.
  await page
    .getByTestId('bucket-inspector-linked-moment')
    .getByRole('button', { name: 'Clear' })
    .click()
  await expect(page.getByTestId('bucket-inspector-linked-moment')).toHaveCount(0)
  await expect(page.locator('.pulse-moments__peak-row.is-active')).toHaveCount(0)
  await expect(page.locator('.hx-moment-marker.is-selected')).toHaveCount(0)

  await assertNoWhiteAnalyticsSurfaces(page)
  await assertNoConsoleErrors(page, errors)
})
```

If the marker class differs, use the current marker selected-state class from
`HubActivityChart.tsx`; do not weaken the assertion to a count that can pass
when no marker exists.

**Step 2: Run the targeted e2e test**

```bash
cd streampulse-web
npx playwright test tests/e2e/analytics-hub-ux.spec.ts --workers=1
```

Expected: the new test and existing hub UX tests pass.

**Commit:** Do not commit; the user has not authorized commits.

## Task 4: Verify the analytics boundary

**Files:** no new production files.

**Step 1: Run targeted unit and e2e tests**

```bash
cd streampulse-web
npm test -- --run tests/pulseMomentsLivePanel.test.tsx tests/hubLiveWireFeed.test.tsx tests/activityBucketInspectorLinked.test.tsx
npx playwright test tests/e2e/analytics-hub-ux.spec.ts tests/e2e/analytics-hub-live-wire-ticker.spec.ts --workers=1
```

Expected: zero failed tests.

**Step 2: Run required static gates**

```bash
npm run check:analytics-overlap
npm run typecheck
```

Expected: overlap check and both TypeScript projects exit successfully.

**Step 3: Inspect the focused diff**

```bash
git diff -- docs/superpowers/specs/2026-07-10-hub-moment-selection-design.md docs/superpowers/plans/2026-07-10-hub-moment-selection.md streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx streampulse-web/src/ui/components/analytics/PulseMomentsLivePanel.tsx streampulse-web/tests/pulseMomentsLivePanel.test.tsx streampulse-web/tests/e2e/analytics-hub-ux.spec.ts
```

Expected: no sibling-backend edits, no CSS changes, no scoring or API contract
changes, and no unrelated cleanup.

**Commit:** Do not commit; the user has not authorized commits.
