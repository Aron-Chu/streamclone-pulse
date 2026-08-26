import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FigmaEmoteSignalBlock } from '../src/ui/components/analytics/FigmaEmoteSignalBlock'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'

describe('FigmaEmoteSignalBlock Emote Market', () => {
  it('shows qualified rising channels as paired comparisons', () => {
    render(
      <AnalyticsThemeProvider>
        <FigmaEmoteSignalBlock
          intel={{ emotesPerMin: 10, topEmoteSharePct: 20, uniqueEmotes: 5, biggestPeakPerMin: 40, seventvSharePct: 50, providerShares: [] }}
          risingChannels={[{
            login: 'xqc',
            displayName: 'xQc',
            viewers: 1_000,
            measuredAt: 1_800_000,
            evidence: { ircBound: true, chatObservedLast5m: true, rollupAvailable: true },
            comparison: {
              state: 'ready', currentPerMin: 25, baselinePerMin: 10, absoluteDeltaPerMin: 15, multiplier: 2.5,
              currentMeasuredMinutes: 5, currentExpectedMinutes: 5, baselineMeasuredMinutes: 20, baselineExpectedMinutes: 20, baselineCoveragePct: 100,
            },
          }]}
        />
      </AnalyticsThemeProvider>,
    )
    expect(screen.getByRole('region', { name: 'Rising channels' })).toBeTruthy()
    expect(screen.getByText('1 qualifying channel')).toBeTruthy()
    expect(screen.getByText('Median lift +15/min')).toBeTruthy()
    expect(screen.queryByText('Highest emote rate')).toBeNull()
  })

  it('hides backend-unavailable production market tabs', () => {
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
    expect(screen.queryByRole('tab', { name: 'Breadth' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Rotation' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Provider regime' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Concentration' }))
    expect(screen.getByText('Top 1 share')).toBeTruthy()
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

  it('does not expose an empty provider regime tab', () => {
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
    expect(screen.queryByRole('tab', { name: 'Provider regime' })).toBeNull()
  })

  it('enables all deterministic internal preview panels without calling them live data', () => {
    window.history.pushState({}, '', '/analytics?marketPreview=fixture')
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
        />
      </AnalyticsThemeProvider>,
    )
    expect(screen.getByText(/Internal deterministic design preview · not live analytics/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Provider regime' }))
    expect(screen.getByRole('region', { name: 'Provider regime' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Rotation' }))
    expect(screen.getByText('6 → 2')).toBeTruthy()
    window.history.pushState({}, '', '/')
  })
})
