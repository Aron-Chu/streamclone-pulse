import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FigmaEmoteSignalBlock } from '../src/ui/components/analytics/FigmaEmoteSignalBlock'
import { EmoteIntelKpis } from '../src/ui/components/analytics/EmoteIntelKpis'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'

describe('FigmaEmoteSignalBlock Emote Market', () => {
  it('hides a legacy 999/m peak in the embedded economy presenter', () => {
    render(
      <AnalyticsThemeProvider>
        <FigmaEmoteSignalBlock intel={{
          emotesPerMin: 10,
          topEmoteSharePct: 20,
          uniqueEmotes: 5,
          biggestPeakPerMin: 999,
          seventvSharePct: 50,
          providerShares: [],
        }} />
      </AnalyticsThemeProvider>,
    )
    expect(screen.queryByText('999/m')).toBeNull()
    expect(screen.queryByText('Biggest peak')).toBeNull()
  })

  it('keeps the alternate KPI presenter honest when peak metadata is legacy or declared', () => {
    const legacy = render(<EmoteIntelKpis intel={{
      emotesPerMin: 10,
      topEmoteSharePct: 20,
      uniqueEmotes: 5,
      biggestPeakPerMin: 999,
      seventvSharePct: 50,
      providerShares: [],
    }} />)
    expect(screen.getByText('Recent live-pool peak unavailable · scope not declared')).toBeTruthy()
    expect(screen.queryByText('999')).toBeNull()
    legacy.unmount()

    render(<EmoteIntelKpis peakLogin="xqc" intel={{
      emotesPerMin: 10,
      topEmoteSharePct: 20,
      uniqueEmotes: 5,
      biggestPeakPerMin: 999,
      seventvSharePct: 50,
      providerShares: [],
      scope: 'tracked_live_pool',
      windowMinutes: 30,
      asOf: '2026-09-04T18:30:00Z',
      biggestPeakUnit: 'emote_uses_per_channel_minute',
    }} />)
    expect(screen.getByText('999')).toBeTruthy()
    expect(screen.getByText(/xqc · Tracked live pool · 30 min · through/i)).toBeTruthy()
  })

  it('omits unsupported breadth and rotation from the primary tabs', () => {
    render(
      <AnalyticsThemeProvider>
        <FigmaEmoteSignalBlock
          intel={{
            emotesPerMin: 10,
            topEmoteSharePct: 20,
            uniqueEmotes: 5,
            biggestPeakPerMin: 40,
            seventvSharePct: 50,
            providerShares: [],
          }}
          topEmotes={[{ name: 'KEKW', provider: '7tv', count: 10, sharePct: 20 }]}
          corpusPipeline={hubCorpusPipelineFixture()}
        />
      </AnalyticsThemeProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Emote Market' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Breadth/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Rotation/ })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Concentration' }))
    expect(screen.getByText('Top 1 share of measured sends')).toBeTruthy()
    expect(screen.getByText('Recent live-pool peak unavailable · window and units not declared')).toBeTruthy()
  })

  it('labels the backend-declared 30-minute tracked-pool emote peak without borrowing the chart window', () => {
    render(
      <AnalyticsThemeProvider>
        <FigmaEmoteSignalBlock
          windowMinutes={10_080}
          intel={{
            emotesPerMin: 10,
            topEmoteSharePct: 20,
            uniqueEmotes: 5,
            biggestPeakPerMin: 40,
            seventvSharePct: 50,
            providerShares: [],
            scope: 'tracked_live_pool',
            windowMinutes: 30,
            asOf: '2026-09-04T18:30:00Z',
            biggestPeakUnit: 'emote_uses_per_channel_minute',
          }}
        />
      </AnalyticsThemeProvider>,
    )
    expect(screen.getByText('Peak emotes / channel / min')).toBeTruthy()
    expect(screen.getByText(/Tracked live pool · 30 min · measured through/i)).toBeTruthy()
    expect(screen.queryByText(/7d|10080 min/i)).toBeNull()
  })

  it('shows breadth rows when market contract is present', () => {
    render(
      <AnalyticsThemeProvider>
        <FigmaEmoteSignalBlock
          intel={{
            emotesPerMin: 10,
            topEmoteSharePct: 20,
            uniqueEmotes: 5,
            biggestPeakPerMin: 40,
            seventvSharePct: 50,
            providerShares: [],
          }}
          emoteMarket={{
            watermark: {
              rangeStart: 1,
              rangeEnd: 2,
              measuredAt: '2026-07-10T12:00:00Z',
            },
            breadth: [
              {
                name: 'KEKW',
                provider: '7tv',
                channelSharePct: 25,
                channelCount: 10,
                measuredChannels: 40,
              },
            ],
          }}
        />
      </AnalyticsThemeProvider>,
    )
    const breadth = screen.getByRole('tab', { name: /Breadth/ })
    fireEvent.click(breadth)
    expect(screen.getByText('Channel share')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
  })

  it('labels locally estimated concentration as a displayed-row subset', () => {
    const estimatedRows = [
      { name: 'KEKW', provider: '7tv', count: 10, sharePct: 100, shareEstimated: true },
    ]
    render(
      <AnalyticsThemeProvider>
        <FigmaEmoteSignalBlock
          intel={{
            emotesPerMin: 10,
            topEmoteSharePct: 20,
            uniqueEmotes: 1,
            biggestPeakPerMin: 40,
            seventvSharePct: 50,
            providerShares: [],
          }}
          topEmotes={estimatedRows}
        />
      </AnalyticsThemeProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Concentration' }))
    expect(screen.getByText('Top 1 share of displayed rows')).toBeTruthy()
  })

  it('explains missing provider rollups on Provider regime', () => {
    render(
      <AnalyticsThemeProvider>
        <FigmaEmoteSignalBlock
          intel={{
            emotesPerMin: 10,
            topEmoteSharePct: 20,
            uniqueEmotes: 5,
            biggestPeakPerMin: 40,
            seventvSharePct: 50,
            providerShares: [],
          }}
          topEmotes={[{ name: 'KEKW', provider: '7tv', count: 10, sharePct: 20 }]}
        />
      </AnalyticsThemeProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Provider regime' }))
    expect(screen.getByText(/Provider hourly rollups are not in this hub snapshot/)).toBeTruthy()
  })
})
