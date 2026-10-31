import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsMinuteRollup, PulseRecapMoment } from '../../apiTypes.ts'
import { configureAnalyticsApi, type AnalyticsApi } from '../../configureApi.ts'
import type { VodLinkState } from '../../utils/twitchVodUrl.ts'
import { resetVodFrameCache } from '../../utils/vodFrames.ts'
import { SelectedMomentCompactCard, stripSummary } from './SelectedMomentCompactCard.tsx'
import { buildSessionBarStrip } from '../../utils/sessionBarStrip.ts'

const motion = vi.hoisted(() => ({ enabled: false }))
vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: motion.enabled }),
}))

// xqc 2026-10-14 (the mockup's capture): live 12:31:30 PM PDT, moment 1 at 0:50:54, VOD alignment -5 s
const STARTED = '2026-10-14T19:31:30.000Z'
const START_MS = Date.parse(STARTED)
const at = (off: number) => new Date(START_MS + off * 1000).toISOString()
const VOD = '2899924626'
const LINKED: VodLinkState = { status: 'linked', vodId: VOD, label: 'Jump to VOD', detail: '' } as VodLinkState
const ART = 'https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-144x192.jpg'
const GAMES = [{ gameName: 'Grand Theft Auto V', categoryId: '32982', boxArtUrl: ART, offsetSeconds: 0, durationSeconds: 20000 }]

function minute(off: number, extra: Partial<AnalyticsMinuteRollup> = {}): AnalyticsMinuteRollup {
  return {
    minuteTs: at(off),
    viewerAvg: 19455,
    viewerMax: 19600,
    chatCount: 299,
    totalEmoteCount: 250,
    seventvEmoteCount: 218,
    emotes: { 'seventv:01HUH:HUH': 56, 'seventv:01LOL:LOL': 44, 'seventv:01LO:LO': 29, 'twitch:25:Kappa': 2 },
    ...extra,
  }
}
const moment = (offsetSeconds: number, score: number): PulseRecapMoment =>
  ({ offsetSeconds, score, reasons: ['emote_spike'] } as PulseRecapMoment)

const ROWS = [minute(2994), minute(3054), minute(3114)]
const getVodStoryboardThumb = vi.fn(async () => null)

beforeEach(() => {
  motion.enabled = false
  resetVodFrameCache()
  getVodStoryboardThumb.mockClear()
  configureAnalyticsApi({ getVodStoryboardThumb } as unknown as AnalyticsApi)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderStrip(props: Partial<Parameters<typeof SelectedMomentCompactCard>[0]> = {}) {
  return render(stripEl(props))
}

function stripEl(props: Partial<Parameters<typeof SelectedMomentCompactCard>[0]> = {}) {
  return (
    <SelectedMomentCompactCard
      rollup={ROWS[1]!}
      rollups={ROWS}
      startedAt={STARTED}
      vodLinkState={LINKED}
      vodId={VOD}
      vodAlignSeconds={-5}
      vodDurationSeconds={20000}
      games={GAMES}
      barSpan={{ startMs: START_MS + 3054_000, endMs: START_MS + 3114_000, levelMinutes: 1 }}
      barMoments={[{ rank: 1, moment: moment(3054, 56) }]}
      lockedMomentOffsetSeconds={3054}
      onClear={() => {}}
      {...props}
    />
  )
}

describe('SelectedMomentCompactCard (bar strip)', () => {
  it("renders the mockup's strip for the bar that holds moment 1", async () => {
    const { container } = renderStrip()
    await act(async () => {})
    const region = screen.getByRole('region', { name: 'Bucket selected: 0:50:54' })
    expect(region.className).toContain('bkc--below')
    expect(container.querySelector('[data-selected-moment-card]')).not.toBeNull()
    expect(container.querySelector('.bkc-s')?.textContent).toBe('Bucket selected · 1 min')
    expect(container.querySelector('.bkc-cat')?.textContent).toBe('Grand Theft Auto V')
    // the 36x48 cover, asked at 2x (candidate, 10-30, PIC-2)
    expect(container.querySelector('img.bkc-art')?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-72x96.jpg')
    expect([...container.querySelectorAll('.bkc-fig')].map((el) => [
      el.querySelector('.bkc-n')?.textContent, el.querySelector('.bkc-fl')?.textContent,
    ])).toEqual([['19,455', 'viewers'], ['299', 'chat/min'], ['250', 'emotes/min']])
    expect([...container.querySelectorAll('.bkc-el li')].map((li) => [
      li.querySelector('.bkc-en')?.textContent, li.querySelector('.bkc-ec')?.textContent,
    ])).toEqual([['HUH', '56'], ['LOL', '44'], ['LO', '29']])
    expect(container.querySelector('.bkc-pv .r')?.textContent).toBe('7TV 218·other 32')
    // the locked moment is marked
    const row = container.querySelector('[data-strip-moment="3054"]')
    expect(row?.className).toBe('bkc-mr lk')
    expect(row?.getAttribute('aria-current')).toBe('true')
    // Play with the 10 s lead-in (alignment verified), and the timed VOD link
    expect(screen.getByRole('button', { name: 'Play VOD from 0:50:39' })).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open VOD at 0:50:39' })
    expect(link.getAttribute('href')).toBe('https://www.twitch.tv/videos/2899924626?t=50m39s')
    expect(link.getAttribute('target')).toBe('_blank')
    // no "× usual" anywhere (F8)
    expect(container.textContent).not.toMatch(/usual/)
    // asked once for the frame of the moment's minute (VOD clock)
    expect(getVodStoryboardThumb).toHaveBeenCalledWith(VOD, 3079)
  })

  it('shows a plain box with the reason when there is no frame, and loads nothing from Twitch before Play', async () => {
    const { container } = renderStrip()
    await act(async () => {})
    expect(container.querySelector('.mpl-box')?.className).toBe('mpl-box nofr')
    // (candidate, 10-30, PIC-2) no blurred art in the box; the sharp cover stays by the title
    expect(container.querySelector('.mpl-box img')).toBeNull()
    expect(container.querySelector('img.bkc-art')).not.toBeNull()
    // (fix, 10-30, PIC-3) the reel's line
    expect(container.querySelector('.mpl-note')?.textContent)
      .toContain("Preview frames aren't available right now. Pictures are the game's box art.")
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.innerHTML).not.toContain('player.twitch.tv')
    fireEvent.click(screen.getByRole('button', { name: 'Play VOD from 0:50:39' }))
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe(`https://player.twitch.tv/?video=v${VOD}&time=50m39s&parent=localhost&autoplay=true`)
  })

  it('says the VOD is recording for a live archive', async () => {
    const { container } = renderStrip({ vodLinkState: { ...LINKED, label: 'Jump to VOD (live archive)' } as VodLinkState })
    await act(async () => {})
    expect(container.querySelector('.mpl-note')?.textContent).toContain('No preview frames while the stream is live.')
  })

  it('claims box art only while the cover shows (fix, 10-30, PIC-3)', async () => {
    const { container } = renderStrip()
    await act(async () => {})
    fireEvent.error(container.querySelector('img.bkc-art')!)
    expect(container.querySelector('img.bkc-art')).toBeNull()
    expect(container.querySelector('.mpl-note span:first-child')?.textContent).toBe("Preview frames aren't available right now.")
  })

  it('plays from the bar start without lead-in when the bar holds no moment', async () => {
    renderStrip({
      rollup: ROWS[0]!,
      barSpan: { startMs: START_MS + 2994_000, endMs: START_MS + 3054_000, levelMinutes: 1 },
      barMoments: [],
      lockedMomentOffsetSeconds: null,
    })
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Play from 0:49:49' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open VOD at 0:49:49' })).toBeTruthy()
    expect(document.querySelector('.bkc-mom .r')?.textContent).toBe('none')
    expect(document.querySelector('.mpl-cap')).toBeNull()
  })

  it('offers no Play and no timed link when the VOD alignment is not verified', async () => {
    renderStrip({ vodAlignSeconds: null })
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /^Play/ })).toBeNull()
    expect(screen.getByText('Timestamp alignment is not verified.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open full VOD' }).getAttribute('href')).toBe(`https://www.twitch.tv/videos/${VOD}`)
    expect(getVodStoryboardThumb).not.toHaveBeenCalled()
  })

  it('says there is no VOD yet while live', async () => {
    renderStrip({ vodId: null, vodLinkState: { status: 'live', label: 'Live', detail: '' } as VodLinkState })
    await act(async () => {})
    expect(screen.getByText('No VOD for this stream yet.')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('locks a moment row, clears from the X, and shows more only with a handler', async () => {
    const onLockMoment = vi.fn()
    const onClear = vi.fn()
    const onShowMoreMoments = vi.fn()
    const many = [moment(3054, 56), moment(3060, 50), moment(3070, 40), moment(3080, 30)].map((m, i) => ({ rank: i + 1, moment: m }))
    const { rerender } = renderStrip({ barMoments: many, onLockMoment, onClear, onShowMoreMoments })
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Moment 2 at 0:51:00, Emote spike · score 50' }))
    expect(onLockMoment).toHaveBeenCalledWith(3060)
    fireEvent.click(screen.getByRole('button', { name: '1 more' }))
    expect(onShowMoreMoments).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected moment' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    rerender(
      <SelectedMomentCompactCard rollup={ROWS[1]!} rollups={ROWS} startedAt={STARTED} vodLinkState={LINKED} vodId={VOD}
        vodAlignSeconds={-5} barMoments={many} lockedMomentOffsetSeconds={3054} />,
    )
    expect(screen.queryByRole('button', { name: '1 more' })).toBeNull()
    expect(screen.getByText('1 more')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Moment 2/ })).toBeNull()
  })

  it("falls back to today's matched recap moment when no bar moments are passed", async () => {
    const { container } = renderStrip({ barMoments: undefined, lockedMomentOffsetSeconds: undefined, recapMoment: moment(3054, 56) })
    await act(async () => {})
    expect(container.querySelector('[data-strip-moment="3054"]')?.className).toContain('lk')
    expect(screen.getByRole('button', { name: 'Play VOD from 0:50:39' })).toBeTruthy()
  })

  it('a bar with no measured minute says "Not measured" and shows no figures or actions', async () => {
    const { container } = renderStrip({
      rollups: [minute(3054, { missing: true })],
      rollup: minute(3054, { missing: true }),
      barMoments: [],
      lockedMomentOffsetSeconds: null,
    })
    await act(async () => {})
    expect(container.querySelector('.bkc-gt')?.textContent).toBe('Not measured')
    expect(container.querySelector('.bkc-s')?.textContent).toBe('Bucket selected')
    expect(container.querySelector('.bkc-fig')).toBeNull()
    expect(container.querySelector('.bkc-act')).toBeNull()
    expect(container.querySelector('.mpl')).toBeNull()
  })

  it('says the names are missing, not that chat named none, when the minute counted emote uses (pick 12S, 10-30)', async () => {
    const counted = minute(3054, { emotes: {} })
    const { container } = renderStrip({ rollups: [counted], rollup: counted })
    await act(async () => {})
    expect(container.querySelector('.bkc-emo .bkc-sl')?.textContent).toBe('Top emotesnames not in this update')
    cleanup()
    const none = minute(3054, { totalEmoteCount: 0, seventvEmoteCount: 0, emotes: {} })
    const second = renderStrip({ rollups: [none], rollup: none })
    await act(async () => {})
    expect(second.container.querySelector('.bkc-emo .bkc-sl')?.textContent).toBe('Top emotesnone named in this minute')
  })

  it('shows Zoom to bucket only with a hook', async () => {
    const onZoomToBar = vi.fn()
    renderStrip({ onZoomToBar })
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to bucket' }))
    expect(onZoomToBar).toHaveBeenCalledTimes(1)
    cleanup()
    renderStrip()
    expect(screen.queryByRole('button', { name: 'Zoom to bucket' })).toBeNull()
  })

  it('enters with motion only, and scrolls only so far that the plot stays in view', async () => {
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    motion.enabled = true
    const { container } = renderStrip()
    expect(container.querySelector('.bkc--below')?.className).toContain('bkc-enter')
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })
    expect(container.querySelector('.bkc--below')?.className).not.toContain('bkc-enter')
    // jsdom lays nothing out (all rects 0), so nothing to scroll
    expect(scrollBy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('scrolls only when it opens from the plot, and never past the plot top', () => {
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    const rect = (top: number, height: number) =>
      ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('spc-svg')) return rect(100, 300)
      if (this.classList.contains('bkc--below')) return rect(700, 300)
      return rect(0, 0)
    })
    const page = (strip: boolean) => <div><svg className="spc-svg" />{strip ? stripEl() : null}</div>
    // a Moments-list pick or a #t= link: no plot gesture, no scroll
    const first = render(page(true))
    expect(scrollBy).not.toHaveBeenCalled()
    first.unmount()
    // a click on the plot: scroll toward the strip, stopping 8 px before the plot's top leaves the window
    const { container, rerender } = render(page(false))
    fireEvent.pointerDown(container.querySelector('.spc-svg')!)
    rerender(page(true))
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenCalledWith({ top: 92, behavior: 'auto' })
  })

  it('announces a summary without "× usual"', () => {
    const m = buildSessionBarStrip({
      span: { startSec: 3054, endSec: 3114, levelMinutes: 1 }, rollups: ROWS, startedAt: STARTED, vodLinkState: LINKED,
      moments: [{ rank: 1, moment: moment(3054, 56) }],
    })
    expect(stripSummary(m)).toBe('Bucket selected, 0:50:54. Viewers 19,455. Chat 299 per minute. Emotes 250 per minute. 1 moment.')
  })
})
