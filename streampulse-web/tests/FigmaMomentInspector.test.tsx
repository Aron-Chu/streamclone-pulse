import { render, screen } from '@testing-library/react'

import { MemoryRouter } from 'react-router-dom'

import { describe, expect, it } from 'vitest'

import { FigmaMomentInspector, MomentContextSpans } from '../src/ui/components/analytics/FigmaMomentInspector'

import { ROLLUP_CONFIDENCE_TITLE } from '../src/lib/pulseMomentsUtils'



describe('MomentContextSpans', () => {

  it('attaches confidence tooltip only to the confidence segment', () => {

    const { container } = render(

      <MomentContextSpans

        moment={{

          offsetSeconds: 60,

          score: 90,

          label: 'Chat spike',

          source: 'live_irc',

          confidence: 97,

          vodState: 'vod_ready',

        }}

      />,

    )



    const confidence = container.querySelector('.pulse-moments__context-confidence[title]')

    expect(confidence).toBeTruthy()

    expect(confidence?.getAttribute('title')).toBe(ROLLUP_CONFIDENCE_TITLE)

    expect(container.textContent).toContain('Live IRC')

    expect(container.textContent).toContain('VOD ready')

    const sourceSpan = container.querySelector('.pulse-moments__context-spans > span:first-child')

    expect(sourceSpan?.getAttribute('title')).toBeNull()

  })

})



describe('FigmaMomentInspector pulse-live hero', () => {

  it('renders KPI tiles and time badge without legacy summary line', () => {

    const at = Date.parse('2026-07-04T04:06:00.000Z')

    render(

      <MemoryRouter>

        <FigmaMomentInspector

          variant="pulse-live"

          liveChannels={[{ login: 'xqc', startedAt: '2026-07-04T03:00:00.000Z' }]}

          moment={{

            offsetSeconds: 3960,

            at,

            score: 88,

            label: 'Viewer spike',

            category: 'ROBLOX',

            chatPerMin: 752,

            viewers: 9500,

            topEmotes: [{ name: 'KEKW', provider: '7tv', count: 527, sharePct: 39.2 }],

          }}

        />

      </MemoryRouter>,

    )



    expect(screen.getByText('Chat / min')).toBeTruthy()

    expect(screen.getByText('Viewers')).toBeTruthy()

    expect(screen.getByText('Top emote this minute')).toBeTruthy()
    expect(screen.getByText('KEKW')).toBeTruthy()
    expect(document.querySelector('.pulse-moments__inspector-emote-card')).toBeTruthy()
    const emoteName = document.querySelector('.pulse-moments__inspector-top-emote-name')
    expect(emoteName?.getAttribute('title')).toBe('KEKW')
    expect(document.querySelector('.pulse-moments__inspector-emote-share-line')?.textContent).toContain('of emotes')

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('9.5K viewers')).toBeTruthy()
    const momentHead = document.querySelector('.pulse-moments__inspector-moment-head')
    expect(momentHead?.textContent).toContain('Viewer spike')
    expect(momentHead?.textContent).toContain('ROBLOX')
    expect(momentHead?.closest('.pulse-moments__inspector-head-main')).toBeTruthy()
    expect(momentHead?.closest('.pulse-moments__inspector-time-badge')).toBeNull()

  })

  it('renders aligned analytics, watch, and copy actions with distinct destinations', () => {
    render(
      <MemoryRouter>
        <FigmaMomentInspector
          variant="pulse-live"
          channelLive
          sessionHref="/analytics/xqc/stream-1#t=60"
          moment={{ offsetSeconds: 60, label: 'Chat spike', login: 'xqc', streamId: 'stream-1' }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Analytics' }).getAttribute('href')).toBe('/analytics/xqc/stream-1#t=60')
    expect(screen.getByRole('link', { name: /Watch live/ }).getAttribute('href')).toBe('https://www.twitch.tv/xqc')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(document.querySelector('.moment-action-row')?.children).toHaveLength(3)
  })

})
