import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GameSegmentOverlay } from './GameSegmentOverlay.tsx'
import type { ChartGameSegment, ChartMinuteRollup } from './types.ts'
import { gameSegmentKey } from './gameSegments.ts'

describe('GameSegmentOverlay visual contract', () => {
  it('renders vertical dashed divider lines without plot labels or a top game band', () => {
    const segments: ChartGameSegment[] = [
      {
        gameName: 'Game A',
        offsetSeconds: 0,
        durationSeconds: 600,
      },
      {
        gameName: 'Game B',
        offsetSeconds: 600,
        durationSeconds: 600,
      },
    ]
    const rollups: ChartMinuteRollup[] = [
      { minuteTs: '2026-07-16T18:00:00.000Z' },
      { minuteTs: '2026-07-16T18:10:00.000Z' },
      { minuteTs: '2026-07-16T18:20:00.000Z' },
    ]

    const restMarkup = renderToStaticMarkup(
      <svg>
        <GameSegmentOverlay
          segments={segments}
          rollups={rollups}
          streamStartedAt="2026-07-16T18:00:00.000Z"
          padLeft={20}
          plotWidth={400}
          gameBandTop={16}
          dividerExtent={240}
        />
      </svg>,
    )

    expect(restMarkup).not.toContain('<line')

    const markup = renderToStaticMarkup(
      <svg>
        <GameSegmentOverlay
          segments={segments}
          rollups={rollups}
          streamStartedAt="2026-07-16T18:00:00.000Z"
          padLeft={20}
          plotWidth={400}
          gameBandTop={16}
          dividerExtent={240}
          highlightedSegmentKey={gameSegmentKey(segments[1]!)}
        />
      </svg>,
    )

    expect((markup.match(/<line/g) ?? [])).toHaveLength(1)
    expect(markup).toContain('stroke-dasharray="4 6"')
    expect(markup).not.toContain('<text')
    expect(markup).not.toContain('<rect')
    expect(markup).not.toContain('transform="rotate')
  })

  it('renders a centered Twitch box-art <image> when a segment has a boxArtUrl', () => {
    const segments: ChartGameSegment[] = [
      {
        gameName: 'Just Chatting',
        offsetSeconds: 60,
        durationSeconds: 600,
        boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg',
        categoryId: '509658',
      },
    ]
    const rollups: ChartMinuteRollup[] = [
      { minuteTs: '2026-07-16T18:00:00.000Z' },
      { minuteTs: '2026-07-16T18:10:00.000Z' },
    ]

    const markup = renderToStaticMarkup(
      <svg>
        <GameSegmentOverlay
          segments={segments}
          rollups={rollups}
          streamStartedAt="2026-07-16T18:00:00.000Z"
          padLeft={20}
          plotWidth={400}
          gameBandTop={16}
          dividerExtent={240}
          highlightedSegmentKey={gameSegmentKey(segments[0]!)}
        />
      </svg>,
    )

    expect(markup).toContain('<image')
    expect(markup).toContain('href="https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg"')
    expect(markup).toContain('data-game-icon="true"')
    expect(markup).toContain('pointer-events="none"')
  })

  it('falls back to categoryId-inferred box art when boxArtUrl is missing', () => {
    const segments: ChartGameSegment[] = [
      {
        gameName: 'Software & Game Development',
        offsetSeconds: 60,
        durationSeconds: 600,
        categoryId: '509658',
      },
    ]
    const rollups: ChartMinuteRollup[] = [
      { minuteTs: '2026-07-16T18:00:00.000Z' },
      { minuteTs: '2026-07-16T18:10:00.000Z' },
    ]

    const markup = renderToStaticMarkup(
      <svg>
        <GameSegmentOverlay
          segments={segments}
          rollups={rollups}
          streamStartedAt="2026-07-16T18:00:00.000Z"
          padLeft={20}
          plotWidth={400}
          gameBandTop={16}
          dividerExtent={240}
          highlightedSegmentKey={gameSegmentKey(segments[0]!)}
        />
      </svg>,
    )

    expect(markup).toContain('<image')
    expect(markup).toContain('https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg')
  })

  it('omits the icon when neither boxArtUrl nor categoryId is available', () => {
    const segments: ChartGameSegment[] = [
      {
        gameName: 'Mystery Game',
        offsetSeconds: 60,
        durationSeconds: 600,
      },
    ]
    const rollups: ChartMinuteRollup[] = [
      { minuteTs: '2026-07-16T18:00:00.000Z' },
      { minuteTs: '2026-07-16T18:10:00.000Z' },
    ]

    const markup = renderToStaticMarkup(
      <svg>
        <GameSegmentOverlay
          segments={segments}
          rollups={rollups}
          streamStartedAt="2026-07-16T18:00:00.000Z"
          padLeft={20}
          plotWidth={400}
          gameBandTop={16}
          dividerExtent={240}
          highlightedSegmentKey={gameSegmentKey(segments[0]!)}
        />
      </svg>,
    )

    expect(markup).not.toContain('<image')
  })
})
