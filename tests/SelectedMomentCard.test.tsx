import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { SelectedMomentCard } from '../src/ui/SelectedMomentCard.tsx'

describe('SelectedMomentCard', () => {
  it('keeps long emote names bounded and links only the emote identity', () => {
    const point: LiveHeatPoint = {
      minuteTs: '2026-08-02T12:00:00.000Z',
      offsetSeconds: 120,
      score: 80,
      estimated: false,
      reason: 'emote_spike',
      reasonLabel: 'Emote spike',
      chatCount: 12,
      emoteCount: 40,
      collecting: false,
      topEmotes: [{
        key: 'seventv:local-id:VeryLongEmoteNameThatMustStayVisible',
        name: 'VeryLongEmoteNameThatMustStayVisible',
        id: 'local-id',
        provider: '7TV',
        providerEmoteId: '01F00Z3A9G0007E4VV006YKSK9',
        count: 24,
      }],
    }

    const markup = renderToStaticMarkup(
      <SelectedMomentCard
        point={point}
        backendUrl="http://localhost:8081"
        onJump={vi.fn()}
        onAnalytics={vi.fn()}
      />,
    )

    expect(markup).toContain('href="https://7tv.app/emotes/01F00Z3A9G0007E4VV006YKSK9"')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('24 uses')
    expect(markup).toContain('>Jump<')
    expect(markup).toContain('>Open Analytics<')
    expect(markup).toContain('text-overflow:ellipsis')
    expect(markup).toContain('white-space:nowrap')
  })

  it('renders an honest unavailable state instead of a broken jump promise', () => {
    const point: LiveHeatPoint = {
      minuteTs: '2026-08-02T12:00:00.000Z',
      offsetSeconds: 120,
      score: 80,
      estimated: false,
      reason: 'chat_spike',
      reasonLabel: 'Chat spike',
      chatCount: 12,
      emoteCount: 4,
      collecting: false,
      topEmotes: [],
    }
    const markup = renderToStaticMarkup(
      <SelectedMomentCard
        point={point}
        backendUrl="http://localhost:8081"
        onJump={vi.fn()}
        onAnalytics={vi.fn()}
        jumpLabel="Player unavailable"
        jumpDisabled
        jumpHint="Twitch’s video player is not ready."
      />,
    )
    expect(markup).toContain('>Player unavailable<')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('data-jump-availability="true"')
    expect(markup).toContain('Twitch’s video player is not ready.')
  })
})
