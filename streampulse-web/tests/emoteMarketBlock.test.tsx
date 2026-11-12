import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmoteIntelKpis } from '../src/ui/components/analytics/EmoteIntelKpis'

describe('EmoteIntelKpis', () => {
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
})
