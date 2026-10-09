import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

afterEach(() => cleanup())

const START = Date.parse('2026-10-07T00:00:00.000Z')

function detail(rows: Array<{ viewerAvg: number | null; chatCount: number | null; emote?: number }>): AnalyticsStreamDetail {
  return {
    stream: { streamId: 'resting-readout', startedAt: new Date(START).toISOString(), peakViewers: 30_000, avgViewers: 25_000 },
    rollups: rows.map((row, index) => ({
      minuteTs: new Date(START + index * 60_000).toISOString(),
      viewerAvg: row.viewerAvg ?? undefined,
      viewerSamples: row.viewerAvg == null ? 0 : 2,
      chatCount: row.chatCount ?? undefined,
      totalEmoteCount: row.emote,
      emotes: row.emote ? { Kappa: row.emote } : {},
    })),
    topEmotes: [],
    sources: [],
  } as unknown as AnalyticsStreamDetail
}

function readout(data: AnalyticsStreamDetail) {
  const { container } = render(
    <AnalyticsChart
      detail={data}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
    />,
  )
  return container.querySelector('[data-chart-hover-readout-row] > p')?.textContent
}

describe('AnalyticsChart resting readout', () => {
  it('falls back to the latest recent minute with a viewer sample', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ viewerAvg: 24_900 + index, chatCount: 400, emote: 50 }))
    // The newest two minutes have chat but no viewer sample yet.
    rows.push({ viewerAvg: null, chatCount: 118, emote: 60 }, { viewerAvg: null, chatCount: 100, emote: 58 })
    const text = readout(detail(rows))
    expect(text).toContain('00:29:00')
    expect(text).toContain('viewers 24.9K')
    expect(text).not.toContain('viewers -')
    expect(text).not.toContain('viewers —')
  })

  it('shows an em dash for a value the minute does not have', () => {
    const rows = Array.from({ length: 30 }, () => ({ viewerAvg: null, chatCount: 400, emote: 50 }))
    rows.push({ viewerAvg: null, chatCount: null, emote: 0 })
    const text = readout(detail(rows))
    expect(text).toContain('viewers —')
    expect(text).toContain('chat —/min')
    expect(text).not.toMatch(/ - /)
  })
})
