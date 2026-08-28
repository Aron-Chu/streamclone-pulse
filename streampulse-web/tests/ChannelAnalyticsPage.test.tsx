import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
        <ChannelAnalyticsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Current streamer analytics')).toBeTruthy()
    expect(screen.queryByText('Retired Figma analytics')).toBeNull()
  })
})
