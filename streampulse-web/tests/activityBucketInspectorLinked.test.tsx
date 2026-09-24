import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActivityBucketInspector } from '../src/ui/components/analytics/ActivityBucketInspector'
import type { HubActivityPoint } from '../src/lib/publicHub'

const point: HubActivityPoint = {
  t: Date.parse('2026-07-10T18:00:00Z'),
  viewers: 1000,
  chat: 120,
  seventv: 40,
}

describe('ActivityBucketInspector linked moment', () => {
  it('shows the whole bucket interval, rate units, and unscaled emote usage counts', () => {
    const start = new Date(2026, 8, 8, 23, 58).getTime()
    render(<ActivityBucketInspector rangeEmotes={[]} windowLabel="24h" windowMinutes={1440}
      selectedPoint={{ ...point, t: start, topEmotes: [{ name: 'LUL', count: 1200 }] }} hoverPoint={null} />)
    expect(screen.getByText('Sep 8, 11:58 PM – Sep 9, 12:04 AM')).toBeTruthy()
    expect(screen.getByText('Chat / min')).toBeTruthy()
    expect(screen.getByText('Emotes / min')).toBeTruthy()
    expect(screen.getByText('Top emotes · uses in this bucket')).toBeTruthy()
    expect(screen.getByTitle('1,200 uses').textContent).toBe('1.2K')
  })

  it('distinguishes unavailable measurements from zero and labels detection-only emote counts', () => {
    render(<ActivityBucketInspector rangeEmotes={[]} windowLabel="24h" windowMinutes={1440}
      selectedPoint={{ ...point, viewers: 0, chat: 0, seventv: 0, hasChatRollup: false }} hoverPoint={null}
      bucketMomentEmotes={[{ name: 'LUL', count: 12, sharePct: 100 }]} />)
    expect(screen.getByText('Chat and emote measurements unavailable.')).toBeTruthy()
    // The emote's missing-image fallback is not a measurement. Check each
    // labeled statistic rather than counting decorative dashes across the UI.
    for (const label of ['Viewers', 'Chat / min', 'Emotes / min']) {
      expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent).toBe('—')
    }
    expect(screen.getByText('Top emotes · uses in matching detections')).toBeTruthy()
  })

  it('retains measured zero for every bucket statistic', () => {
    render(<ActivityBucketInspector rangeEmotes={[]} windowLabel="24h" windowMinutes={1440}
      selectedPoint={{ ...point, viewers: 0, chat: 0, emotes: 0, seventv: 0, hasViewerRollup: true, hasChatRollup: true }} hoverPoint={null} />)
    for (const label of ['Viewers', 'Chat / min', 'Emotes / min']) {
      expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent).toBe('0')
    }
  })

  it('shows measured provider rates without converting omissions into zero or hiding lower bounds', () => {
    render(<ActivityBucketInspector rangeEmotes={[]} windowLabel="24h" windowMinutes={1440}
      selectedPoint={{ ...point, twitch: 0, ffz: 6, providerCoverage: { ffz: 'unavailable' } }} hoverPoint={null} />)
    const providers = screen.getByRole('region', { name: 'Selected bucket provider rates' })
    for (const [label, expected] of [['7TV', '40'], ['Twitch', '≥0'], ['BTTV', '—'], ['FFZ', '—']]) {
      expect(within(providers).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent).toBe(expected)
    }
    expect(within(providers).getByText('Viewer coverage unknown')).toBeTruthy()
  })

  it('drops the lower-bound prefix only for certified exact provider totals', () => {
    render(<ActivityBucketInspector rangeEmotes={[]} windowLabel="24h" windowMinutes={1440}
      selectedPoint={{ ...point, twitch: 3, bttv: 0 }} hoverPoint={null} providerTotalsComplete />)
    const providers = screen.getByRole('region', { name: 'Selected bucket provider rates' })
    expect(within(providers).getByText('Twitch', { selector: 'dt' }).nextElementSibling?.textContent).toBe('3')
    expect(within(providers).getByText('BTTV', { selector: 'dt' }).nextElementSibling?.textContent).toBe('0')
  })

  it('stays a bucket preview with a linked strip — never aria-label Moment inspector', () => {
    const onClear = vi.fn()
    render(
      <ActivityBucketInspector
        rangeEmotes={[]}
        windowLabel="24h"
        windowMinutes={24 * 60}
        selectedPoint={point}
        hoverPoint={null}
        linkedMoment={{ login: 'squeeex', displayName: 'Squeeex', label: 'Emote spike' }}
        onClearLinkedMoment={onClear}
        bucketLocked={false}
      />,
    )

    expect(screen.getByLabelText('Activity bucket inspector')).toBeTruthy()
    expect(screen.queryByLabelText('Moment inspector')).toBeNull()
    expect(screen.getByTestId('bucket-inspector-linked-moment').textContent).toContain(
      'Linked to selected moment',
    )
    expect(screen.getByText('Squeeex')).toBeTruthy()
    expect(screen.getByText('Emote spike')).toBeTruthy()
    expect(screen.getByText('Bucket activity · 6 min')).toBeTruthy()
    expect(screen.getByText('Moment bucket')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear selected bucket' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('labels the selected interval without duplicate badges', () => {
    const onClearBucket = vi.fn()
    render(
      <ActivityBucketInspector
        rangeEmotes={[]}
        windowLabel="24h"
        windowMinutes={24 * 60}
        selectedPoint={point}
        hoverPoint={null}
        linkedMoment={{ login: 'squeeex', label: 'Emote spike' }}
        bucketLocked
        onClearBucket={onClearBucket}
      />,
    )
    expect(screen.getByText('Bucket activity · 6 min · Filters moments below')).toBeTruthy()
    expect(screen.getByText('Bucket selected')).toBeTruthy()
    expect(screen.queryByText('Linked')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected bucket' }))
    expect(onClearBucket).toHaveBeenCalledTimes(1)
  })

  it('previews loaded matching detections without claiming a complete bucket total', () => {
    const bucketMoments = [
      { login: 'alpha', displayName: 'Alpha', streamId: 's1', offsetSeconds: 60, at: point.t + 60_000, label: 'Chat spike' },
      { login: 'beta', displayName: 'Beta', streamId: 's2', offsetSeconds: 90, at: point.t + 90_000, label: 'Emote burst' },
      { login: 'gamma', displayName: 'Gamma', streamId: 's3', offsetSeconds: 120, at: point.t + 120_000, label: 'Fast chat' },
      { login: 'delta', displayName: 'Delta', streamId: 's4', offsetSeconds: 150, at: point.t + 150_000, label: 'Reaction surge' },
    ]
    render(<ActivityBucketInspector rangeEmotes={[]} windowLabel="24h" windowMinutes={1440}
      selectedPoint={point} hoverPoint={null} bucketLocked bucketMoments={bucketMoments} bucketMomentsLoading />)
    const matches = screen.getByRole('region', { name: 'Matching moments in selected bucket' })
    expect(within(matches).getByText('Previewing 3 of 4 loaded · checking for more')).toBeTruthy()
    expect(within(matches).getAllByRole('listitem')).toHaveLength(3)
    expect(within(matches).getByText('Chat spike')).toBeTruthy()
    expect(within(matches).queryByText('Reaction surge')).toBeNull()
    expect(within(matches).getByText('Detector-selected moments only; this is not a list of every active channel.')).toBeTruthy()
  })

  it('does not turn an unavailable empty match list into a zero-detection claim', () => {
    const { rerender } = render(<ActivityBucketInspector rangeEmotes={[]} windowLabel="24h" windowMinutes={1440}
      selectedPoint={point} hoverPoint={null} bucketLocked bucketMomentsLoading />)
    expect(screen.getByText('Checking for matching detections…')).toBeTruthy()
    rerender(<ActivityBucketInspector rangeEmotes={[]} windowLabel="24h" windowMinutes={1440}
      selectedPoint={point} hoverPoint={null} bucketLocked />)
    expect(screen.getByText('No matching detections loaded. Check Pulse Moments below for the fetch status.')).toBeTruthy()
    expect(screen.queryByText('No matching detections in this interval.')).toBeNull()
  })
})
