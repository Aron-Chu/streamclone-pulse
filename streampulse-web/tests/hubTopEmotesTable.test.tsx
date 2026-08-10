import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HubTopEmotesTable } from '../src/ui/components/analytics/HubTopEmotesTable'

describe('HubTopEmotesTable inspector layout', () => {
  it('shows provider pill on each emote row', () => {
    render(
      <HubTopEmotesTable
        layout="inspector"
        emotes={[
          { name: 'DinoDance', provider: 'twitch', count: 9500, sharePct: 45 },
          { name: 'KEKW', provider: '7tv', count: 1200, sharePct: 12 },
        ]}
      />,
    )

    expect(screen.getByText('Twitch')).toBeTruthy()
    expect(screen.getByText('7TV')).toBeTruthy()
    const twitchBadge = screen.getByText('Twitch')
    expect(twitchBadge.getAttribute('data-provider')).toBe('twitch')
    expect(twitchBadge.closest('.emote-rank-row__provider-slot')).toBeTruthy()
  })
})
