import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FigmaEmoteSignalBlock } from '../src/ui/components/analytics/FigmaEmoteSignalBlock'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'

describe('FigmaEmoteSignalBlock Emote Market', () => {
  it('lets breadth open with an honest gated empty state', () => {
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
    const breadth = screen.getByRole('tab', { name: /Breadth/ })
    expect((breadth as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(breadth)
    expect(screen.getByText(/Cross-channel breadth needs a sanitized backend/)).toBeTruthy()
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
