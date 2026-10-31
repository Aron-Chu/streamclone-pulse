/**
 * PIC-3 (fix, 10-30): the reel note and the bar picture's note read one `recording` flag from the page and say
 * the same line. Shapes from the saved 2026-10-30 07:19Z answers: every VOD's storyboard answer is
 * {"reason":"no_storyboard"} (live-storyboard.json; F6, our lookup, not Twitch), the live stream 316655688306 is
 * VOD 2914584411 at -5 s, the Oct 28 stream 316705728883 is VOD 2912916877 (ended), and both are one Just Chatting
 * cover (live-games.json, past-games.json).
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsMinuteRollup, PulseStreamRecap } from '../../apiTypes.ts'
import { configureAnalyticsApi, type AnalyticsApi } from '../../configureApi.ts'
import type { VodLinkState } from '../../utils/twitchVodUrl.ts'
import { resetVodFrameCache } from '../../utils/vodFrames.ts'
import { PREVIEW_RECORDING_COPY, PREVIEW_UNAVAILABLE_COPY } from './MomentPreviewTile.tsx'
import { SelectedMomentCompactCard } from './SelectedMomentCompactCard.tsx'
import { SessionRecapMomentsStrip } from './SessionRecapMomentsStrip.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: false }) }))

const NO_STORYBOARD = { reason: 'no_storyboard' }
const LIVE = { streamId: '316655688306', vodId: '2914584411', align: -5, duration: 10_741, startedAt: '2026-10-30T04:20:06Z' }
const PAST = { streamId: '316705728883', vodId: '2912916877', align: -5, duration: 23_731, startedAt: '2026-10-28T09:00:11Z' }
const BOX_ART = 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg'
const GAMES = [{ gameName: 'Just Chatting', categoryId: '509658', boxArtUrl: BOX_ART, offsetSeconds: 0, durationSeconds: 10_747 }]

const BOX_ART_LINE = `${PREVIEW_UNAVAILABLE_COPY} Pictures are the game's box art.`

type Stream = typeof LIVE

function recap(stream: Stream): PulseStreamRecap {
  return {
    streamId: stream.streamId,
    totalMessages: 1000,
    topMoments: Array.from({ length: 4 }, (_, i) => ({
      offsetSeconds: 1200 + i * 600,
      score: 80 - i,
      reasons: ['emote_spike'],
      chatCount: 100,
      emoteCount: 50,
    })),
  }
}

function minute(stream: Stream, off: number): AnalyticsMinuteRollup {
  return {
    minuteTs: new Date(Date.parse(stream.startedAt) + off * 1000).toISOString(),
    viewerAvg: 10_682,
    chatCount: 299,
    totalEmoteCount: 250,
    emotes: { 'seventv:01HUH:HUH': 56 },
  }
}

const getVodStoryboardThumb = vi.fn(async () => NO_STORYBOARD)

beforeEach(() => {
  resetVodFrameCache()
  getVodStoryboardThumb.mockClear()
  configureAnalyticsApi({ getVodStoryboardThumb } as unknown as AnalyticsApi)
})
afterEach(() => cleanup())

function page(stream: Stream, recording: boolean, games: typeof GAMES | null = GAMES) {
  const start = Date.parse(stream.startedAt)
  const rows = [minute(stream, 1200), minute(stream, 1260)]
  return (
    <>
      <SelectedMomentCompactCard
        rollup={rows[0]!}
        rollups={rows}
        startedAt={stream.startedAt}
        vodLinkState={{ status: 'linked', vodId: stream.vodId, label: 'Jump to VOD', detail: '' } as VodLinkState}
        vodId={stream.vodId}
        vodAlignSeconds={stream.align}
        vodDurationSeconds={stream.duration}
        games={games}
        barSpan={{ startMs: start + 1_260_000, endMs: start + 1_320_000, levelMinutes: 1 }}
        barMoments={[]}
        vodRecording={recording}
      />
      <SessionRecapMomentsStrip
        recap={recap(stream)}
        streamStartedAt={stream.startedAt}
        onSelectOffset={vi.fn()}
        games={games}
        vodId={stream.vodId}
        vodAlignSeconds={stream.align}
        vodDurationSeconds={stream.duration}
        reel
        recording={recording}
      />
    </>
  )
}

const reelNoteText = () => document.querySelector('[data-moment-reel-note]')?.textContent ?? null
const barNoteText = () => document.querySelector('.mpl-note span:first-child')?.textContent ?? null

describe('one preview note on the session page (PIC-3)', () => {
  it('while the stream records, the reel and the bar picture both say frames come after it ends', async () => {
    // The backend answers no_storyboard for the live VOD too (it never says recording), so the page's flag decides.
    render(page(LIVE, true))
    await waitFor(() => expect(reelNoteText()).toBe(PREVIEW_RECORDING_COPY))
    expect(getVodStoryboardThumb).toHaveBeenCalled()
    expect(PREVIEW_RECORDING_COPY).toBe('No preview frames while the stream is live.')
    expect(barNoteText()).toBe(PREVIEW_RECORDING_COPY)
  })

  it("an ended stream says frames aren't available right now, never that the stream has none", async () => {
    render(page(PAST, false))
    await waitFor(() => expect(reelNoteText()).toBe(BOX_ART_LINE))
    expect(BOX_ART_LINE).toBe("Preview frames aren't available right now. Pictures are the game's box art.")
    expect(barNoteText()).toBe(BOX_ART_LINE)
    // the old line blamed Twitch and the stream for our lookup (F6)
    expect(document.body.textContent).not.toMatch(/for this stream/)
    expect(document.body.textContent).not.toMatch(/when the VOD finishes/)
  })

  it("claims box art only when there is a cover to show", async () => {
    render(page(PAST, false, null))
    await act(async () => {})
    expect(barNoteText()).toBe(PREVIEW_UNAVAILABLE_COPY)
    expect(PREVIEW_UNAVAILABLE_COPY).toBe("Preview frames aren't available right now.")
    expect(reelNoteText()).toBe(PREVIEW_UNAVAILABLE_COPY)
  })
})
