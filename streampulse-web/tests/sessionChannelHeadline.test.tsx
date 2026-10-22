import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleChannelHeadline } from '@streampulse/analytics-console'

const lookup = vi.hoisted(() => ({ lookupChannelSuggestion: vi.fn() }))
vi.mock('../src/lib/channelSearch', () => lookup)

import { SessionChannelHeadline, sessionBroadcastCount } from '../src/ui/components/analytics/SessionChannelHeadline'

const base: ConsoleChannelHeadline = {
  login: 'saltydune',
  displayName: 'Saltydune',
  live: { streamId: '900000000007', category: 'Overwatch 2', href: '/analytics/saltydune/900000000007' },
  viewingLive: false,
  broadcasts: 8,
  broadcastsCapped: false,
}

function renderHeadline(headline: ConsoleChannelHeadline) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionChannelHeadline headline={headline} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => lookup.lookupChannelSuggestion.mockResolvedValue(null))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SessionChannelHeadline (session-who W1)', () => {
  it('leads with the name, links "Live now · game" to the live session and counts the broadcasts', async () => {
    renderHeadline(base)
    expect(screen.getByText('Saltydune').className).toBe('ssp-who-nm')
    const live = screen.getByRole('link', { name: 'Live now · Overwatch 2' })
    expect(live.getAttribute('href')).toBe('/analytics/saltydune/900000000007')
    expect(screen.getByText('8 broadcasts')).toBeTruthy()
    // No picture from the lookup: the hub's toned monogram.
    expect(document.querySelector('.ssp-who-mono')?.textContent).toBe('SA')
    await waitFor(() => expect(lookup.lookupChannelSuggestion).toHaveBeenCalledWith('saltydune'))
  })

  it("shows the channel's picture, and is not a link on the live session itself", async () => {
    lookup.lookupChannelSuggestion.mockResolvedValue({ login: 'saltydune', profileImageUrl: 'https://img.example/s.png', live: true })
    renderHeadline({ ...base, viewingLive: true })
    await waitFor(() => expect(document.querySelector('img.ssp-who-av')?.getAttribute('src')).toBe('https://img.example/s.png'))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Live now · Overwatch 2')).toBeTruthy()
  })

  it('drops "Live now" when the channel lookup says the channel is offline', async () => {
    lookup.lookupChannelSuggestion.mockResolvedValue({ login: 'saltydune', live: false })
    renderHeadline(base)
    await waitFor(() => expect(screen.queryByText(/Live now/)).toBeNull())
    expect(screen.getByText('8 broadcasts')).toBeTruthy()
  })

  it('words the count, and waits for the list before showing one', () => {
    expect(sessionBroadcastCount(null, false)).toBeNull()
    expect(sessionBroadcastCount(1, false)).toBe('1 broadcast')
    expect(sessionBroadcastCount(8, false)).toBe('8 broadcasts')
    expect(sessionBroadcastCount(100, true)).toBe('100+ broadcasts')
  })
})
