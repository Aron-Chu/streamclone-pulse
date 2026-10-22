import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'

const hubData = vi.hoisted(() => ({ usePublicHubData: vi.fn() }))
vi.mock('../src/hooks/usePublicHubData', () => hubData)

import { AnalyticsFind } from '../src/ui/components/analytics/AnalyticsFind'
import { AnalyticsFindProvider, useAnalyticsFind, type AnalyticsFindHero } from '../src/ui/components/analytics/analyticsFindContext'

const live = [
  { login: 'saltydune', displayName: 'Saltydune', category: 'Chess', viewers: 900, streamId: '900000000007' },
  { login: 'kai', displayName: 'Kai', category: 'Just Chatting', viewers: 4000, streamId: '900000000001' },
] as HubLiveChannel[]

function Hero({ hero }: { hero: AnalyticsFindHero }) {
  const setHero = useAnalyticsFind()?.setHero
  useEffect(() => setHero?.(hero), [setHero, hero])
  return null
}

function renderFind(hero?: AnalyticsFindHero) {
  return render(
    <MemoryRouter>
      <AnalyticsFindProvider>
        <AnalyticsFind />
        {hero ? <Hero hero={hero} /> : null}
      </AnalyticsFindProvider>
    </MemoryRouter>,
  )
}

const dialog = () => document.querySelector<HTMLDialogElement>('dialog.analytics-find-pal')!
const ctrlK = () => fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AnalyticsFind: the top bar search (R5-14)', () => {
  it('is always there on a page without a hero, and Ctrl K opens the search window with live channels', async () => {
    hubData.usePublicHubData.mockReturnValue({ data: { liveChannels: live } })
    renderFind()
    const button = screen.getByRole('button', { name: 'Search a Twitch channel' })
    expect(button.getAttribute('data-docked')).toBe('true')
    expect(button.textContent).toContain('Search a streamer')
    expect(dialog().open).toBe(false)

    ctrlK()
    await waitFor(() => expect(dialog().open).toBe(true))
    const input = await screen.findByRole('combobox', { name: 'Search any Twitch channel' })
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(await screen.findByText('Kai')).toBeTruthy()
    expect(hubData.usePublicHubData).toHaveBeenCalledWith({ enabled: true, pollMs: 0, activityWindow: '30m' })
  })

  it('stays hidden while the hero field is on screen and leaves the keys to it; docks once it scrolls away', async () => {
    hubData.usePublicHubData.mockReturnValue({ data: null })
    const { rerender } = renderFind({ inView: true, live })
    const button = screen.getByRole('button', { name: 'Search a Twitch channel', hidden: true })
    await waitFor(() => expect(button.getAttribute('data-docked')).toBe('false'))
    ctrlK()
    expect(dialog().open).toBe(false)

    rerender(
      <MemoryRouter>
        <AnalyticsFindProvider>
          <AnalyticsFind />
          <Hero hero={{ inView: false, live }} />
        </AnalyticsFindProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(button.getAttribute('data-docked')).toBe('true'))
    fireEvent.click(button)
    await waitFor(() => expect(dialog().open).toBe(true))
    // The hub's own live list: no second read.
    expect(await screen.findByText('Saltydune')).toBeTruthy()
    expect(hubData.usePublicHubData).toHaveBeenCalledWith({ enabled: false, pollMs: 0, activityWindow: '30m' })
  })

  it('leaves / to a page that takes it for its own search', async () => {
    hubData.usePublicHubData.mockReturnValue({ data: null })
    renderFind()
    const takeSlash = (event: KeyboardEvent) => {
      if (event.key === '/') event.preventDefault()
    }
    document.addEventListener('keydown', takeSlash)
    try {
      fireEvent.keyDown(document.body, { key: '/' })
      expect(dialog().open).toBe(false)
      ctrlK()
      await waitFor(() => expect(dialog().open).toBe(true))
    } finally {
      document.removeEventListener('keydown', takeSlash)
    }
  })

  it('closes when a row is picked', async () => {
    hubData.usePublicHubData.mockReturnValue({ data: { liveChannels: live } })
    renderFind()
    fireEvent.click(screen.getByRole('button', { name: 'Search a Twitch channel' }))
    const row = await screen.findByRole('option', { name: /Kai/ })
    act(() => {
      fireEvent.click(row)
    })
    await waitFor(() => expect(dialog().open).toBe(false))
  })
})
