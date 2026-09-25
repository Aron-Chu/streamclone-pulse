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

    const inspector = screen.getByLabelText('Moment Inspector')
    expect(inspector.querySelectorAll('.hub-openbtn')).not.toHaveLength(0)
    expect(inspector.querySelector('a[href*="twitch.tv/videos"]')).toBeNull()

  })

  it('routes raw VOD metadata to exact-identity review rather than Twitch playback', () => {

    const { container } = render(

      <MemoryRouter>

        <FigmaMomentInspector moment={{ offsetSeconds: 60, label: 'Spike', login: 'xqc', streamId: 'stream-exact', vodId: '123456789' }} />

      </MemoryRouter>,

    )

    expect(screen.getByRole('link', { name: 'Review moment' }).getAttribute('href')).toBe(

      '/analytics/moments?view=recent&login=xqc&stream=stream-exact&offset=60',

    )

    expect(container.querySelector('a[href*="twitch.tv/videos"]')).toBeNull()

  })

  it('does not prepare a clip from a cached feed handoff reference', () => {

    render(

      <MemoryRouter>

        <FigmaMomentInspector moment={{
          offsetSeconds: 60,
          label: 'Spike',
          login: 'xqc',
          streamId: 'stream-exact',
          handoffRef: 'cr_c3RhbGU',
        }} />

      </MemoryRouter>,

    )

    expect(screen.getByRole('link', { name: 'Review moment' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Prepare clip in ReplayForge/ })).toBeNull()

  })

  it('does not synthesize a review target for a nearby invalid identity', () => {

    render(

      <MemoryRouter>

        <FigmaMomentInspector moment={{ offsetSeconds: 60, label: 'Spike', login: 'xqc', streamId: '' }} />

      </MemoryRouter>,

    )

    expect(screen.queryByRole('link', { name: 'Review moment' })).toBeNull()

    expect(screen.getByText('Moment unavailable')).toBeTruthy()

  })

})
