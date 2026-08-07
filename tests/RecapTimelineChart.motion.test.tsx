import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PulsePayload } from '../src/shared/messages.ts'

const capturedOverviewProps: Array<Record<string, unknown>> = []

vi.mock('../src/ui/PulseOverviewChart.tsx', () => ({
  PulseOverviewChart: (props: Record<string, unknown>) => {
    capturedOverviewProps.push(props)
    return <div data-testid="mock-pulse-overview-chart" />
  },
}))

vi.mock('../src/ui/SevenTvEmotePanel.tsx', () => ({
  SevenTvEmotePanel: () => null,
}))

vi.mock('../src/ui/StreamActivityChartHeader.tsx', () => ({
  StreamActivityChartHeader: () => null,
}))

vi.mock('../src/ui/PulseEmoteImg.tsx', () => ({
  PulseEmoteImg: () => null,
}))

import { RecapTimelineChart } from '../src/ui/RecapTimelineChart.tsx'

function samplePayload(): PulsePayload {
  return {
    login: 'demo',
    streamId: '1',
    isLive: false,
    tracking: true,
    startedAt: '2026-01-01T00:00:00Z',
    currentOffsetSeconds: 180,
    rollups: [
      { offsetSeconds: 0, chatCount: 10, sevenTvEmoteCount: 2, viewerCount: 100 },
      { offsetSeconds: 60, chatCount: 40, sevenTvEmoteCount: 8, viewerCount: 140 },
      { offsetSeconds: 120, chatCount: 15, sevenTvEmoteCount: 3, viewerCount: 120 },
    ],
  }
}

describe('RecapTimelineChart motion', () => {
  it('does not force reducedMotion on PulseOverviewChart (offline matches live)', () => {
    capturedOverviewProps.length = 0
    renderToStaticMarkup(
      <RecapTimelineChart
        payload={samplePayload()}
        backendUrl="https://api.streampulse.stream"
        peakOffsets={[]}
        catalog={[]}
        onSelectPoint={() => undefined}
      />,
    )

    expect(capturedOverviewProps.length).toBeGreaterThan(0)
    const last = capturedOverviewProps[capturedOverviewProps.length - 1]!
    // LiveStatsBand omits the prop (defaults false). Recap must not force true.
    expect(last).not.toHaveProperty('reducedMotion', true)
    expect(Boolean(last.reducedMotion)).toBe(false)
  })
})
