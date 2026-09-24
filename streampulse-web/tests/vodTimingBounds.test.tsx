import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { alignedVodOffset } from '@streampulse/analytics-console/utils/twitchVodUrl'
import { buildSelectedMomentDisplay } from '@streampulse/analytics-console/utils/selectedMomentDisplay'
import { RecapOffsetTimestamp, StreamRecapPanel } from '@streampulse/analytics-console/components/analytics/StreamRecapPanel'

describe('stream analytics shares exact archive bounds with Moments', () => {
  it.each([
    [120, 0, 600, 120], [120, -75.5, 600, 44], [120, 13, 600, 133],
    [120, -121, 600, undefined], [120, 0, 120, undefined],
    [120, 0, 0, undefined], [120, 0, null, undefined],
    [120, undefined, 600, undefined], [120, Infinity, 600, undefined],
    [120, 21601, 100000, undefined], [-1, 10, 600, undefined],
  ])('bounds %s + %s within %s', (offset, alignment, duration, expected) => {
    expect(alignedVodOffset(offset!, alignment, duration)).toBe(expected)
  })
  it.each([[-241, 600], [0, 240], [0, 100]])('does not offer a recap timestamp outside its archive (%s, %s)', (alignment, duration) => {
    const markup = renderToStaticMarkup(<RecapOffsetTimestamp offsetSeconds={240} vodId="2864434763" vodAlignSeconds={alignment} vodDurationSeconds={duration} />)
    expect(markup).not.toContain('href=')
    const display = buildSelectedMomentDisplay({ rollup: { minuteTs: '2026-08-01T12:04:00Z', chatCount: 30 }, rollups: [],
      startedAt: '2026-08-01T12:00:00Z', vodAlignSeconds: alignment, vodDurationSeconds: duration,
      vodLinkState: { status: 'linked', vodId: '2864434763', label: 'Jump to VOD', detail: '' } })
    expect(display.vodJumpOffsetStr).toBeUndefined()
    expect(display.vodUrl).toBe('https://www.twitch.tv/videos/2864434763')
  })
  it('maps a recap timestamp without confusing stream and VOD time', () => {
    const markup = renderToStaticMarkup(<RecapOffsetTimestamp offsetSeconds={240} vodId="2864434763" vodAlignSeconds={-75.5} vodDurationSeconds={600} />)
    expect(markup).toContain('href="https://www.twitch.tv/videos/2864434763?t=2m44s"')
  })
  it('keeps a jumpable highlight and its VOD link as sibling controls', () => {
    const markup = renderToStaticMarkup(<StreamRecapPanel
      recap={{ streamId: 's1', biggestChatSpike: { offsetSeconds: 240, chatPerMin: 90 }, funniestEmoteBurst: { offsetSeconds: 300, code: 'KEKW', count: 12 } }}
      vodId="2864434763" vodAlignSeconds={0} vodDurationSeconds={600} onJumpToOffset={() => {}} />)
    const buttons = markup.split('<button').slice(1).map(part => part.slice(0, part.indexOf('</button>')))
    expect(buttons).toHaveLength(2)
    for (const button of buttons) expect(button).not.toContain('<a ')
    expect(markup).toContain('aria-label="Open 00:04:00 in the Twitch VOD"')
  })
})
