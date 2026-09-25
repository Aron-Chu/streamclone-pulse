import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ChannelAnalyticsPage from '../src/routes/analytics/ChannelAnalyticsPage'

vi.mock('../src/hooks/useRecordHubRecentLogin', () => ({
  useRecordHubRecentLogin: vi.fn(),
}))

vi.mock('../src/routes/analytics/ConsoleChannelView', () => ({
  default: () => <div>Current streamer analytics</div>,
}))

vi.mock('../src/routes/analytics/FigmaChannelView', () => ({
  default: () => <div>Retired Figma analytics</div>,
}))

describe('ChannelAnalyticsPage', () => {
  it('keeps legacy figma links on the current streamer console', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/ohnepixel/317569935714?figma=1']}>
        <Routes><Route path="/analytics/:login/:streamId" element={<ChannelAnalyticsPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Current streamer analytics')).toBeTruthy()
    expect(screen.queryByText('Retired Figma analytics')).toBeNull()
  })

  it.each(['explore', 'settings', 'invalid-handle', 'bad%20name'])('does not mount a channel console for reserved or invalid route %s', async login => {
    render(<MemoryRouter initialEntries={[`/analytics/${login}`]}><Routes><Route path="/analytics/:login" element={<ChannelAnalyticsPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(screen.queryByText('Current streamer analytics')).toBeNull()
  })
})
