import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { EmoteEconomyPanel } from '../src/ui/components/hub/HubRail'

const legacyIntel = {
  emotesPerMin: 12,
  topEmoteSharePct: 0,
  uniqueEmotes: 3,
  biggestPeakPerMin: 999,
  seventvSharePct: 0,
  providerShares: [],
}

describe('EmoteEconomyPanel peak contract', () => {
  it('does not display a legacy 999/m peak without exact calculation metadata', () => {
    render(<MemoryRouter><EmoteEconomyPanel intel={legacyIntel} topEmotes={[]} /></MemoryRouter>)
    expect(screen.queryByText('999/m')).toBeNull()
    expect(screen.queryByText('Biggest peak')).toBeNull()
  })

  it('displays the peak only for a valid 30-minute tracked-live-pool measurement', () => {
    render(<MemoryRouter><EmoteEconomyPanel intel={{
      ...legacyIntel,
      scope: 'tracked_live_pool',
      windowMinutes: 30,
      biggestPeakUnit: 'emote_uses_per_channel_minute',
      asOf: '2026-09-04T12:00:00Z',
    }} topEmotes={[]} /></MemoryRouter>)
    expect(screen.getByText('999/m')).toBeTruthy()
  })
})
