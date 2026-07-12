import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByText('Linked')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('uses Selected badge when the bucket is explicitly locked', () => {
    render(
      <ActivityBucketInspector
        rangeEmotes={[]}
        windowLabel="24h"
        windowMinutes={24 * 60}
        selectedPoint={point}
        hoverPoint={null}
        linkedMoment={{ login: 'squeeex', label: 'Emote spike' }}
        bucketLocked
      />,
    )
    expect(screen.getByText('Selected')).toBeTruthy()
    expect(screen.queryByText('Linked')).toBeNull()
  })
})
