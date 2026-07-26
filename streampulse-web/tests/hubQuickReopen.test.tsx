import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { clearHubRecentLogins, recordHubRecentLogin } from '../src/lib/hubRecentChannels'
import { HubQuickReopen } from '../src/ui/components/analytics/HubQuickReopen'

afterEach(() => {
  clearHubRecentLogins()
})

describe('HubQuickReopen', () => {
  it('shows recently opened channels from localStorage', () => {
    recordHubRecentLogin('xqc', '2026-06-26T12:00:00.000Z')

    render(
      <MemoryRouter>
        <HubQuickReopen pinnedEntries={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'xqc' }).getAttribute('href')).toBe('/analytics/xqc')
  })

  it('switches to pinned tab', () => {
    render(
      <MemoryRouter>
        <HubQuickReopen
          pinnedEntries={[{ login: 'moistcr1tikal', alwaysTrack: true, createdAt: '2026-06-01T00:00:00.000Z' }]}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Pinned' }))
    expect(screen.getByRole('link', { name: 'moistcr1tikal' }).getAttribute('href')).toBe('/analytics/moistcr1tikal')
    expect(screen.getByText('Protected')).toBeTruthy()
  })
})
