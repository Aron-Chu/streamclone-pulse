import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { HubActivityBarSeries } from '../src/ui/components/analytics/HubActivityBarSeries'
import { hubTimeDomain } from '../src/lib/hubTimeScale'
import type { HubActivityPoint } from '../src/lib/publicHub'

describe('HubActivityBarSeries', () => {
  const points: HubActivityPoint[] = [
    { t: 0, viewers: 100, chat: 10, seventv: 0 },
    { t: 60_000, viewers: 200, chat: 20, seventv: 0 },
  ]
  const domain = hubTimeDomain(points, 60_000)!

  it('renders one purple chat bar per measured non-zero bucket', () => {
    const { container } = render(
      <svg>
        <HubActivityBarSeries
          points={points}
          timeDomain={domain}
          height={100}
          paddingBottom={0}
          chatMax={20}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect.hx-chat-bar')).toHaveLength(2)
    expect(container.querySelectorAll('rect.hx-bar-segment--viewers, rect.hx-bar-segment--emotes')).toHaveLength(0)
  })

  it('skips segments whose value is 0', () => {
    const { container } = render(
      <svg>
        <HubActivityBarSeries
          points={[{ t: 0, viewers: 100, chat: 0, seventv: 0 }]}
          timeDomain={domain}
          height={100}
          paddingBottom={0}
          chatMax={1}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect.hx-chat-bar')).toHaveLength(0)
  })

  it('marks the live trailing bucket when its t equals the last in-progress point', () => {
    // Domain must span the trailing bucket too — otherwise it renders no bar at all.
    const pts: HubActivityPoint[] = [
      ...points,
      { t: 120_000, viewers: 50, chat: 5, seventv: 0, bucketComplete: false },
    ]
    const trailingDomain = hubTimeDomain(pts, 60_000)!
    expect(trailingDomain.endExclusive).toBeGreaterThan(120_000)
    const { container } = render(
      <svg>
        <HubActivityBarSeries
          points={pts}
          timeDomain={trailingDomain}
          height={100}
          paddingBottom={0}
          chatMax={20}
          trailingBucketT={120_000}
        />
      </svg>,
    )
    const live = container.querySelector('[data-live="true"]')
    expect(live).toBeTruthy()
    expect(live?.getAttribute('opacity')).toBe('0.4')
  })
})
