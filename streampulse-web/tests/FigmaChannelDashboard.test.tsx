import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ChannelPageData } from '../src/hooks/useChannelPageData'
import { FigmaChannelDashboard } from '../src/ui/components/analytics/FigmaChannelDashboard'

function channelData(): ChannelPageData {
  return {
    login: 'sleduck',
    displayName: 'Sleduck',
    loading: false,
    streams: [
      {
        streamId: 'stream-1',
        label: 'Jul 26',
        live: false,
        sourceLabel: 'Tracked',
        href: '/analytics/sleduck/stream-1',
      },
    ],
    selectedStreamId: 'stream-1',
    session: {
      state: 'ready',
      login: 'sleduck',
      displayName: 'Sleduck',
      streamId: 'stream-1',
      chatPerMin: 24,
      chatMinPerMinute: 8,
      chatMaxPerMinute: 42,
      seventvPerMin: 11,
      dataCoveragePct: 64,
      moments: [
        {
          offsetSeconds: 60,
          score: 80,
          label: 'Chat spike',
          chatPerMin: 42,
        },
      ],
      chartPoints: [
        { offsetSeconds: 0, chatNorm: 20, viewersNorm: 80, emotesNorm: 15, heat: 22 },
        { offsetSeconds: 60, chatNorm: 100, viewersNorm: 90, emotesNorm: 100, heat: 96 },
      ],
      bursts: [],
      coverageTruth: [],
      sourceLabel: 'Tracked',
    },
    summary: null,
    recap: null,
    refresh: vi.fn(),
  }
}

describe('FigmaChannelDashboard past-stream chart', () => {
  it('opens in the smooth overview and leads with chat min-max instead of viewers', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/analytics/sleduck/2026-07-26']}>
        <FigmaChannelDashboard data={channelData()} />
      </MemoryRouter>,
    )

    const chart = container.querySelector('.figma-chart__svg-wrap') as HTMLElement
    expect(chart.dataset.chartMode).toBe('overview')
    expect(chart.dataset.chartPrimarySignals).toBe('chat emotes')

    const firstStat = container.querySelector('.figma-session-bar__stat')
    expect(firstStat?.textContent).toContain('chat min–max')
    expect(firstStat?.textContent).toContain('8–42')
    expect(container.querySelector('.figma-session-bar__meta')?.textContent).toContain('partial coverage')
  })
})
