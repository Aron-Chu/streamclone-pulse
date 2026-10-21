// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { CATCH_ME_UP_SCRIPT_FILE, injectCatchMeUp } from '../src/background/catchMeUpScript.ts'
import { MESSAGE_SENDER_SCOPE } from '../src/background/pulseBroadcastTargets.ts'
import { peakMinute, summaryClock } from '../src/content/catchMeUpStory.ts'
import type { CatchMeUpModel } from '../src/shared/catchMeUpContract.ts'
import type { PulsePayload } from '../src/shared/messages.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { StreamRecapSection } from '../src/ui/StreamRecapSection.tsx'
import { catchMeUpModel } from '../src/ui/catchMeUp.ts'
import { MOMENT_CARD_GAME_LINE_HEIGHT, MOMENT_CARD_HEIGHT } from '../src/ui/momentCardLayout.ts'
import { contentScriptModules } from './helpers/contentGraph.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ type: 'BOOKMARKS', items: [] })),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tab = { id: 42 } as chrome.tabs.Tab

function point(offsetSeconds: number, fields: Partial<LiveHeatPoint> = {}): LiveHeatPoint {
  return {
    minuteTs: '2026-06-11T12:00:00.000Z',
    offsetSeconds,
    score: 90,
    estimated: false,
    reason: 'chat_spike',
    reasonLabel: 'Chat spike',
    chatCount: 212,
    emoteCount: 80,
    topEmotes: [{ key: 'kekw', name: 'KEKW', count: 212 }],
    collecting: false,
    ...fields,
  }
}

function model(fields: Partial<CatchMeUpModel> = {}): CatchMeUpModel {
  const view = { kind: 'card' as const, from: 0, to: 60, peak: 30 }
  return {
    moments: [point(9_660), point(5_025, { reasonLabel: 'Emote spike', reason: 'emote_spike' }), point(1_200)].map(p => ({
      point: p,
      card: view,
      thumb: { ...view, kind: 'thumb' as const },
      game: { name: 'Just Chatting' },
    })),
    rollups: [],
    durationSeconds: 3 * 3600,
    peakChatPerMin: 480,
    momentCount: 20,
    namesGame: false,
    backendUrl: 'https://api.example.test',
    vodPage: false,
    summary: { vodId: null, withTitle: true, games: [] },
    ...fields,
  }
}

describe('Catch me up story', () => {
  it('finds the minute with the most chat, the first of a tie', () => {
    const rollups = Array.from({ length: 120 }, (_, minute) => ({ offsetSeconds: minute * 60, chatCount: minute === 70 || minute === 90 ? 50 : 5 }))
    expect(peakMinute(rollups, 7200)).toEqual({ offsetSeconds: 70 * 60, chatCount: 50 })
    expect(peakMinute([{ offsetSeconds: 60, chatCount: 0 }], 120)).toBeNull()
    expect(peakMinute([], 7200)).toBeNull()
  })

  it('names no peak minute when the minutes cover only part of the stream', () => {
    const minutes = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => ({ offsetSeconds: (from + index) * 60, chatCount: 10 + index }))
    // The first four hours of a 5h10m stream, as a capped history can hold.
    expect(peakMinute(minutes(0, 239), 18_598)).toBeNull()
    // The last hour only, as a live window holds.
    expect(peakMinute(minutes(180, 240), 14_400)).toBeNull()
    expect(peakMinute(minutes(1, 239), 14_400)).toEqual({ offsetSeconds: 238 * 60, chatCount: 247 })
  })

  it('writes clocks that cannot read as a time of day', () => {
    expect(summaryClock(9_240)).toBe('2:34')
    expect(summaryClock(1_290)).toBe('0:21')
    expect(summaryClock(15_153, true)).toBe('4:12:33')
  })

  it('builds the block from the ranked moments the recap lists', () => {
    const points = [point(600), point(1200), point(1800), point(2400)]
    const built = catchMeUpModel({
      points,
      rollups: [],
      games: [
        { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1500 },
        { gameName: 'Minecraft', offsetSeconds: 1500, durationSeconds: 2000 },
      ],
      durationSeconds: 3500,
      peakChatPerMin: 9,
      backendUrl: 'https://api.example.test',
      vodPage: true,
      vodId: '2905053845',
    })!
    expect(built.moments.map(moment => moment.point.offsetSeconds)).toEqual([600, 1200, 1800])
    expect(built.moments.map(moment => moment.game?.name)).toEqual(['Just Chatting', 'Just Chatting', 'Minecraft'])
    expect(built.moments[0]!.card.kind).toBe('card')
    expect(built.moments[0]!.thumb.kind).toBe('thumb')
    expect(built).toMatchObject({ momentCount: 4, namesGame: true, vodPage: true })
    expect(built.summary).toEqual({ vodId: '2905053845', withTitle: true, games: ['Just Chatting', 'Minecraft'] })
    expect(catchMeUpModel({ ...built, points: [], games: [] })).toBeNull()
    // The summary names the games in the order played, a return as a step of its own,
    // from the recap's checked timeline when it has one.
    const route = catchMeUpModel({
      ...built,
      points,
      games: [
        { gameName: 'Minecraft', offsetSeconds: 1500, durationSeconds: 500 },
        { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1500 },
        { gameName: 'Just Chatting', offsetSeconds: 2000, durationSeconds: 1500 },
        { gameName: 'Elden Ring', offsetSeconds: 3000, durationSeconds: 500 },
      ],
      withTitle: false,
    })!
    expect(route.summary).toMatchObject({ withTitle: false, games: ['Just Chatting', 'Minecraft', 'Just Chatting', 'Elden Ring'] })
    expect(catchMeUpModel({ ...built, points, played: [] })!.summary.games).toEqual([])
  })
})

describe('Catch me up script', () => {
  it('injects the fixed script into the sender’s tab and frame, in the isolated world', async () => {
    const executeScript = vi.fn().mockResolvedValue([])
    expect(await injectCatchMeUp({ executeScript }, { id: 'ext', frameId: 3, tab })).toBe(true)
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 42, frameIds: [3] }, world: 'ISOLATED', files: ['content/catch-me-up.js'] })
    expect(CATCH_ME_UP_SCRIPT_FILE).toBe('content/catch-me-up.js')
  })

  it('injects nothing without a tab, and reports a failed injection instead of throwing', async () => {
    const executeScript = vi.fn().mockRejectedValue(new Error('Cannot access contents of the page'))
    expect(await injectCatchMeUp({ executeScript }, { id: 'ext' })).toBe(false)
    expect(executeScript).not.toHaveBeenCalled()
    expect(await injectCatchMeUp({ executeScript }, { id: 'ext', frameId: 0, tab })).toBe(false)
  })

  it('takes no file, tab or frame from the caller', () => {
    expect(parseBackgroundRequest({ type: 'CATCH_ME_UP_SCRIPT' })).toEqual({ type: 'CATCH_ME_UP_SCRIPT' })
    for (const extra of [{ files: ['evil.js'] }, { tabId: 1 }, { frameId: 3 }, { world: 'MAIN' }]) {
      expect(parseBackgroundRequest({ type: 'CATCH_ME_UP_SCRIPT', ...extra })).toBeNull()
    }
    expect(MESSAGE_SENDER_SCOPE.CATCH_ME_UP_SCRIPT).toBe('twitch-any')
  })

  it('the content script reaches the block only through the injected script', () => {
    const graph = contentScriptModules()
    expect(graph).toContain('src/ui/catchMeUp.ts')
    expect(graph.filter(file => file === 'src/content/catchMeUp.ts' || file === 'src/content/catchMeUpStory.ts')).toEqual([])
  })

  it('in a build, the Catch me up script is self-contained and twitch.js carries only the slot', () => {
    const contentBundle = resolve(root, 'dist/content/twitch.js')
    // Unit tests run before `npm run build` in CI; with no build there is nothing to inspect.
    if (!existsSync(contentBundle)) return
    const blockBundle = resolve(root, 'dist/content/catch-me-up.js')
    expect(existsSync(blockBundle), 'dist/content/catch-me-up.js is missing from a build that has twitch.js').toBe(true)
    const content = readFileSync(contentBundle, 'utf8')
    const block = readFileSync(blockBundle, 'utf8')
    for (const marker of ['Select this minute on the chart', ' chat/min']) {
      expect(content.includes(marker), `twitch.js must not contain ${marker}`).toBe(false)
      expect(block.includes(marker), `catch-me-up.js must contain ${marker}`).toBe(true)
    }
    expect(content).toContain('CATCH_ME_UP_SCRIPT')
    expect(content).not.toContain('Biggest spike')
    expect(block).not.toMatch(/\bimport\s*\(|\bfrom\s*['"]|chunks\//)
  })
})

describe('Catch me up block', () => {
  beforeAll(async () => {
    await import('../src/content/catchMeUp.ts')
  })

  const host = () => {
    const element = document.createElement('div')
    document.body.append(element)
    return element
  }

  it('shows the summary, the #1 moment with Jump and the next two, with no picture when this tab has none', () => {
    const element = host()
    const jump = vi.fn()
    const pick = vi.fn()
    const block = globalThis.__pulseCatchMeUp!.mount(element, model(), { jump, pick, minute: vi.fn() })
    // Minutes that do not cover the stream give the recap's peak, with no minute to select.
    expect(element.querySelector('.pcu-sum')!.textContent).toBe('Peak 480 chat/min')
    expect(element.querySelector('.pcu-sum-link, .pcu-sum-cover, .pcu-sum[data-asks]')).toBeNull()
    expect(element.querySelector('.pcu-rank')!.textContent).toBe('#1 moment')
    // Time, label, one number and the top emote.
    expect(element.querySelector('.pcu-metrics')!.textContent).toBe('02:41 · Chat spike · 212 chat/min · KEKW ×212')
    const emoteSpike = globalThis.__pulseCatchMeUp!.mount(host(), model({ moments: [{ ...model().moments[1]!, point: point(5_025, { reason: 'emote_spike', reasonLabel: 'Emote spike', topEmotes: [] }) }] }), { jump, pick, minute: vi.fn() })
    expect(document.querySelectorAll('.pcu-metrics')[1]!.textContent).toBe('01:23 · Emote spike · 80 emotes/min')
    emoteSpike.remove()
    // One game known (a VOD's lone category) is not named as the moment's.
    expect(element.querySelector('.pcu-game')).toBeNull()
    const several = globalThis.__pulseCatchMeUp!.mount(host(), model({ namesGame: true }), { jump, pick, minute: vi.fn() })
    expect(document.querySelector('.pcu-game')!.textContent).toBe('Just Chatting')
    several.remove()
    expect(element.querySelector('.pcu-pic')!.childElementCount).toBe(0)
    expect(element.querySelectorAll('.pcu-pic img, .pcu-mini img')).toHaveLength(0)
    // No stats line under the block.
    expect(element.querySelector('.pcu-stats')).toBeNull()
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('.pcu-btn')]
    expect(buttons.map(button => button.textContent)).toEqual(['▶ Jump'])
    buttons[0]!.click()
    expect(jump).toHaveBeenCalledWith(0)

    const minis = [...element.querySelectorAll<HTMLButtonElement>('.pcu-mini')]
    expect(minis.map(mini => mini.querySelector('b')!.textContent)).toEqual(['#2 · 01:23', '#3 · 00:20'])
    expect(minis[0]!.textContent).toContain('Emote spike')
    minis[1]!.click()
    expect(pick).toHaveBeenCalledWith(2)
    block.select(2)
    expect(minis.map(mini => mini.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    block.select(null)
    expect(minis.map(mini => mini.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
    block.remove()
    expect(element.childElementCount).toBe(0)
  })

  it('on a VOD page, steps through the best three one click at a time', () => {
    const element = host()
    const jump = vi.fn()
    globalThis.__pulseCatchMeUp!.mount(element, model({ vodPage: true }), { jump, pick: vi.fn(), minute: vi.fn() })
    const play = [...element.querySelectorAll<HTMLButtonElement>('.pcu-btn')][1]!
    expect(play.textContent).toBe('Watch best 3')
    play.click()
    expect(play.textContent).toBe('Next: #2 · 01:23')
    play.click()
    expect(play.textContent).toBe('Next: #3 · 00:20')
    play.click()
    expect(play.textContent).toBe('Watch best 3')
    expect(jump.mock.calls).toEqual([[0], [1], [2]])
  })

  it('on a VOD page with parts, draws the summary above, the best three as tiles and Watch best under them', () => {
    const element = host()
    const head = host()
    const tail = host()
    const pick = vi.fn()
    const kekw = { key: 'kekw', name: 'KEKW', count: 212, provider: 'bttv', providerEmoteId: 'kekw1' }
    const moments = model().moments.map(moment => ({ ...moment, point: { ...moment.point, topEmotes: [kekw] } }))
    const block = globalThis.__pulseCatchMeUp!.mount(element, model({ vodPage: true, moments }), { jump: vi.fn(), pick, minute: vi.fn() }, { head, tail })
    expect(head.textContent).toBe('Peak 480 chat/min')
    // No #1 hero: the tiles are the best three.
    expect(element.querySelector('.pcu-rank')).toBeNull()
    const tiles = [...element.querySelectorAll<HTMLButtonElement>('.pcu-tile')]
    expect(tiles.map(tile => tile.querySelector('.pcu-tile-cap')!.textContent)).toEqual(['#1 KEKW ×212', '#2 KEKW ×212', '#3 KEKW ×212'])
    // Without a picture, a tile is the top emote, large, and the time; no
    // stand-in picture and no word about the missing one.
    expect(tiles.map(tile => tile.querySelector('.pcu-tile-face')!.textContent)).toEqual(['02:41', '01:23', '00:20'])
    expect(tiles.every(tile => tile.querySelector('.pcu-tile-face img') != null)).toBe(true)
    expect(element.textContent).not.toMatch(/unavailable|no picture/i)
    tiles[1]!.click()
    expect(pick).toHaveBeenCalledWith(1)
    block.select(1)
    expect(tiles.map(tile => tile.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    const play = tail.querySelector<HTMLButtonElement>('.pcu-btn')!
    expect(play.textContent).toBe('▶ Watch best 3')
    play.click()
    expect(play.textContent).toBe('▶ Next: #2 · 01:23')
    block.remove()
    expect([element, head, tail].map(part => part.childElementCount)).toEqual([0, 0, 0])
  })

  it('draws a picture only through the frames script, and removes it with the block', () => {
    const element = host()
    const unmount = vi.fn()
    const mount = vi.fn((target: HTMLElement) => {
      target.append(document.createElement('img'))
      return unmount
    })
    globalThis.__pulseMomentFrames = { start: vi.fn(), keep: vi.fn(), mount, vod: vi.fn(async () => null) }
    const at = { api: 'https://api.example.test', key: 'stream-1', vodId: '2905053845' }
    try {
      const block = globalThis.__pulseCatchMeUp!.mount(element, model({ at }), { jump: vi.fn(), pick: vi.fn(), minute: vi.fn() })
      expect(mount.mock.calls.map(([, view]) => view.kind)).toEqual(['card', 'thumb', 'thumb'])
      // Each names the stream, so a moment this tab never played can still show Twitch's picture.
      expect(mount.mock.calls.every(([, , named]) => named === at)).toBe(true)
      expect(element.querySelector('.pcu-pair')!.hasAttribute('data-pmf-list')).toBe(true)
      block.remove()
      expect(unmount).toHaveBeenCalledTimes(3)
    } finally {
      globalThis.__pulseMomentFrames = undefined
    }
  })

  it("sums the stream up with Twitch's cover and title, the games in order and a peak that selects its minute", async () => {
    const vod = vi.fn(async () => ({ title: 'GAMING TIME', cover: 'https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-640x360.jpg', sheets: [], cols: 0, rows: 0, count: 0, interval: 0 }))
    globalThis.__pulseMomentFrames = { start: vi.fn(), keep: vi.fn(), mount: vi.fn(() => () => undefined), vod }
    const rollups = Array.from({ length: 180 }, (_, minute) => ({ offsetSeconds: minute * 60, chatCount: minute === 154 ? 903 : 40 }))
    const summary = { vodId: '2905053845', withTitle: true, games: ['Just Chatting', 'Minecraft'] }
    try {
      const minute = vi.fn()
      const element = host()
      const block = globalThis.__pulseCatchMeUp!.mount(element, model({ rollups, durationSeconds: 10_800 + 33, summary }), { jump: vi.fn(), pick: vi.fn(), minute })
      expect(vod).toHaveBeenCalledWith({ vodId: '2905053845' })
      // The cover's place is kept while Twitch answers; the title waits for it.
      const cover = element.querySelector('.pcu-sum-cover')!
      expect(cover.textContent).toBe('3:00:33')
      expect(element.querySelector<HTMLElement>('.pcu-sum-title')!.hidden).toBe(true)
      await Promise.resolve()
      await Promise.resolve()
      expect(cover.querySelector('img')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-640x360.jpg')
      const title = element.querySelector<HTMLElement>('.pcu-sum-title')!
      expect([title.hidden, title.textContent]).toEqual([false, 'GAMING TIME'])
      expect(element.querySelector('.pcu-sum-games')!.textContent).toBe('Just Chatting → Minecraft')
      const peak = element.querySelector<HTMLButtonElement>('.pcu-sum-link')!
      expect(peak.parentElement!.textContent).toBe('Peak 903 chat/min at 2:34')
      peak.click()
      expect(minute).toHaveBeenCalledWith(154 * 60)
      block.remove()

      // Where the recap names the title itself, and for a VOD Twitch has no cover of.
      vod.mockResolvedValueOnce(null as never)
      const bare = host()
      globalThis.__pulseCatchMeUp!.mount(bare, model({ rollups, durationSeconds: 10_800, summary: { ...summary, withTitle: false } }), { jump: vi.fn(), pick: vi.fn(), minute })
      await Promise.resolve()
      await Promise.resolve()
      expect(bare.querySelector('.pcu-sum-cover')).toBeNull()
      // It keeps the cover's height, so nothing below it moves.
      expect(bare.querySelector('.pcu-sum')!.hasAttribute('data-asks')).toBe(true)
      expect(bare.querySelector<HTMLElement>('.pcu-sum-title')!.hidden).toBe(true)
    } finally {
      globalThis.__pulseMomentFrames = undefined
    }
  })
})

describe('Stream recap with Catch me up', () => {
  let reactRoot: Root | null = null
  afterEach(() => {
    act(() => reactRoot?.unmount())
    reactRoot = null
    document.body.replaceChildren()
  })
  beforeAll(async () => {
    await import('../src/content/catchMeUp.ts')
  })

  const moments = Array.from({ length: 8 }, (_, index) => ({
    offsetSeconds: 300 + index * 420,
    score: 95 - index * 5,
    reasons: ['chat_spike'],
    chatCount: 400 - index * 10,
    emoteCount: 30,
  }))
  const payload = {
    login: 'test',
    streamId: 'stream-1',
    isLive: false,
    tracking: true,
    vodId: 'vod-1',
    startedAt: '2026-06-11T12:00:00.000Z',
    endedAt: '2026-06-11T13:00:00.000Z',
    rollups: Array.from({ length: 60 }, (_, minute) => ({ offsetSeconds: minute * 60, chatCount: 20, sevenTvEmoteCount: 2 })),
    lanes: { composite: [], chat: [], seventv: [] },
    peaks: [],
    recap: {
      streamId: 'stream-1',
      login: 'test',
      durationSeconds: 3600,
      totalMessages: 4000,
      peakChatPerMin: 90,
      topMoments: moments,
      topEmotes: [],
      clipCandidates: [],
    },
  } as unknown as PulsePayload

  function render(vodPage = false, shown = payload) {
    const element = document.createElement('div')
    document.body.append(element)
    reactRoot = createRoot(element)
    act(() => reactRoot!.render(
      <StreamRecapSection
        payload={shown}
        backendUrl="https://api.example.test"
        uiState="ready"
        isLive={false}
        vodPage={vodPage}
        onJump={() => undefined}
        onAnalytics={() => undefined}
        onOpenAnalytics={() => undefined}
      />,
    ))
    return element
  }
  const rows = (element: ParentNode) => [...element.querySelectorAll<HTMLButtonElement>('.pulse-moment-row-button')]
  const click = (target: HTMLElement) => act(() => target.click())
  /** Turns Spikes on or off (they start off); the viewer's last choice carries over from an earlier test. */
  const setSpikes = (element: ParentNode, on: boolean) => {
    const toggle = element.querySelector<HTMLElement>('[data-chart-moment-toggle="true"]')!
    if ((toggle.getAttribute('aria-pressed') === 'true') !== on) click(toggle)
  }
  const showSpikes = (element: ParentNode) => setSpikes(element, true)

  it('shows the best three in the block, folds the rest under it, and opens a mini’s card under the block', () => {
    const element = render()
    const slot = element.querySelector<HTMLElement>('.pcu-slot')!
    expect(slot.hidden).toBe(false)
    // The summary's peak is the chart's busiest minute (the first of a tie), which it selects.
    const peak = slot.querySelector<HTMLButtonElement>('.pcu-sum .pcu-sum-link')!
    expect(peak.parentElement!.textContent).toBe('Peak 20 chat/min at 0:00')
    click(peak)
    expect(element.querySelector('[data-moment-inspector-clock="true"]')!.textContent).toMatch(/^00:00/)
    act(() => element.querySelector<HTMLButtonElement>('.pulse-sel-close')!.click())
    expect(element.textContent).not.toContain('Biggest spike')
    expect(element.textContent).not.toContain('Top moments')
    // The rest start folded; the three above are not listed again.
    expect(rows(element)).toHaveLength(0)
    const more = [...element.querySelectorAll('button')].find(button => button.textContent?.startsWith('Show 5 more moments'))!
    // Show more is the list's last row: right after the list, at the list's row gap.
    expect(more.previousElementSibling!.hasAttribute('data-pmf-list')).toBe(true)
    expect(more.style.marginTop).toBe('4px')
    click(more)
    expect(rows(element).map(row => row.getAttribute('aria-label')!.match(/\d\d:\d\d/)![0])).toEqual(['00:26', '00:33', '00:40', '00:47', '00:54'])

    const minis = [...slot.querySelectorAll<HTMLButtonElement>('.pcu-mini')]
    click(minis[0]!)
    const card = slot.querySelector('[data-top-moment-card="selected"]')
    expect(card).not.toBeNull()
    expect(card!.previousElementSibling!.querySelector('.pcu')).not.toBeNull()
    expect(minis[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(element.querySelectorAll('[data-top-moment-card="selected"]')).toHaveLength(1)
    // Picked again, it closes.
    click(minis[0]!)
    expect(slot.querySelector('[data-top-moment-card="selected"]')).toBeNull()
    expect(minis[0]!.getAttribute('aria-pressed')).toBe('false')
  })

  it('names the game the moment cards name, even where the recap rejects its game timeline', () => {
    // Games that run past the recap's length, as when its minutes stop early:
    // the recap's game strip leaves them out, the cards still name them.
    const games = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1000 },
      { gameName: 'Minecraft', offsetSeconds: 1000, durationSeconds: 6000 },
    ]
    const element = render(false, { ...payload, games } as PulsePayload)
    const slot = element.querySelector<HTMLElement>('.pcu-slot')!
    expect(slot.querySelector('.pcu-game')!.textContent).toBe('Just Chatting')
    click(slot.querySelectorAll<HTMLButtonElement>('.pcu-mini')[1]!)
    const card = slot.querySelector('[data-top-moment-card="selected"]')!
    expect(card.textContent).toContain('Minecraft')
    // Its height reserves the game line, so swapping moments moves nothing.
    expect(card.querySelector<HTMLElement>('.pulse-moment-slot-inner > div > div')!.style.minHeight)
      .toBe(`${MOMENT_CARD_HEIGHT + MOMENT_CARD_GAME_LINE_HEIGHT}px`)
  })

  it('holds the moments back while the script loads, and lists them all when it never comes', async () => {
    const script = globalThis.__pulseCatchMeUp
    globalThis.__pulseCatchMeUp = undefined
    vi.useFakeTimers()
    vi.stubGlobal('chrome', { runtime: { id: 'test', sendMessage: () => new Promise(() => {}) } })
    try {
      const element = render()
      // No rows that would fold away a moment later.
      expect(rows(element)).toHaveLength(0)
      expect(element.textContent).not.toContain('more moments')
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(element.querySelector<HTMLElement>('.pcu-slot')!.hidden).toBe(true)
      expect(rows(element)[0]!.getAttribute('aria-label')).toMatch(/00:05/)
      expect(element.textContent).toContain('Top moments')
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
      globalThis.__pulseCatchMeUp = script
    }
  })

  it('offers the best three in turn only on a VOD page', () => {
    expect([...render().querySelectorAll('.pcu-btn')].map(button => button.textContent)).toEqual(['▶ Jump'])
    act(() => reactRoot?.unmount())
    expect([...render(true).querySelectorAll('.pcu-btn')].map(button => button.textContent)).toEqual(['▶ Watch best 3'])
  })

  /** The recap's shown rows, top to bottom, by what each one is. */
  const order = (element: HTMLElement) => {
    const content = element.querySelector<HTMLElement>('.pcu-slot')!.parentElement!
    return [...content.children].filter(child => !(child as HTMLElement).hidden).map(child => {
      const has = (selector: string) => child.matches(selector) || child.querySelector(selector) != null
      if (has('.pcu-slot')) return child.querySelector('.pcu-tiles') ? 'tiles' : 'block'
      if (has('.pcu-more')) return 'more'
      if (has('.pcu-sum')) return 'facts'
      if (has('.pcu-wide')) return 'watch'
      if (has('[data-games-played]')) return 'games'
      if (has('[data-chart-moment-toggle]')) return 'chart'
      if (has('[data-pmf-list]')) return 'list'
      return null
    }).filter(Boolean)
  }
  const games = [
    { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1800 },
    { gameName: 'Minecraft', offsetSeconds: 1800, durationSeconds: 1800 },
  ]

  it('on a replay, puts the chart first: facts, chart, tiles, Watch best, then More with games, Plot on chart and every moment', () => {
    const element = render(true, { ...payload, games } as PulsePayload)
    expect(order(element)).toEqual(['facts', 'chart', 'tiles', 'watch', 'more'])
    const more = element.querySelector<HTMLDetailsElement>('details.pcu-more')!
    expect(more.open).toBe(false)
    expect(more.querySelector('summary')!.textContent).toBe('More')
    const inside = more.querySelector('.pcu-more-in')!
    expect(inside.querySelector('[data-games-played]')).not.toBeNull()
    // Every moment, in time order, with no fold.
    expect(rows(inside).map(row => row.getAttribute('aria-label')!.match(/\d\d:\d\d/)![0]))
      .toEqual(['00:05', '00:12', '00:19', '00:26', '00:33', '00:40', '00:47', '00:54'])
    expect(element.textContent).not.toContain('more moment')
    expect(element.textContent).not.toContain('Top moments')
    // Spikes start off, so the chart starts bare; with them on, the top three
    // are numbered pins and the rest are dots.
    expect(element.querySelectorAll('[data-chart-pin], [data-chart-moment-marker="true"]')).toHaveLength(0)
    showSpikes(element)
    const pins =[...element.querySelectorAll('[data-chart-pin]')].map(pin => [pin.getAttribute('data-chart-pin'), pin.getAttribute('data-chart-moment-marker-offset')])
    expect(pins).toEqual(expect.arrayContaining([['1', '300'], ['2', '720'], ['3', '1140']]))
    expect(pins).toHaveLength(3)
    expect(element.querySelectorAll('[data-chart-moment-marker="true"]')).toHaveLength(8)
    expect(element.querySelectorAll('[data-spike-symbol="diamond"]')).toHaveLength(0)
  })

  it('on a replay, opens a pin’s card under the chart, a tile’s under the tiles and a row’s under its row', () => {
    const element = render(true)
    const content = element.querySelector<HTMLElement>('.pcu-slot')!.parentElement!
    const chartSlot = () => element.querySelector('.pcu-slot')!.previousElementSibling!
    showSpikes(element)
    act(() => element.querySelector('[data-chart-pin="2"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(chartSlot().querySelector('.pulse-moment-slot')!.textContent).toContain('00:12')
    expect(element.querySelectorAll('[data-top-moment-card="selected"]')).toHaveLength(0)

    const tiles = [...element.querySelectorAll<HTMLButtonElement>('.pcu-tile')]
    click(tiles[2]!)
    const card = element.querySelector('.pcu-slot [data-top-moment-card="selected"]')!
    expect(card.textContent).toContain('00:19')
    expect(card.previousElementSibling!.querySelector('.pcu-tiles')).not.toBeNull()
    expect(tiles[2]!.getAttribute('aria-pressed')).toBe('true')
    expect(content.querySelectorAll('[data-top-moment-card="selected"]')).toHaveLength(1)

    const list = rows(element.querySelector('.pcu-more')!)
    click(list[4]!)
    const rowCard = list[4]!.nextElementSibling!
    expect(rowCard.getAttribute('data-top-moment-card')).toBe('selected')
    expect(list[4]!.getAttribute('aria-controls')).toBe(rowCard.id)
    expect(tiles[2]!.getAttribute('aria-pressed')).toBe('false')
    click(list[4]!)
    expect(element.querySelector('.pcu-more [data-top-moment-card="selected"]')).toBeNull()
  })

  it('keeps the live recap as it was: block, games, chart, then the folded list, with no pins and no More', () => {
    const element = render(false, { ...payload, games } as PulsePayload)
    expect(order(element)).toEqual(['block', 'games', 'chart', 'list'])
    // With Spikes off (their default, tests/recapSpikesChoice.test.tsx), the chart is bare.
    setSpikes(element, false)
    expect(element.querySelector('.pcu-more, .pcu-tiles, [data-chart-pin]')).toBeNull()
    expect(element.querySelectorAll('[data-chart-moment-marker="true"]')).toHaveLength(0)
  })

  it('draws no Games played strip while the games are unknown, and keeps it out when they arrive later', () => {
    const games = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1800 },
      { gameName: 'Minecraft', offsetSeconds: 1800, durationSeconds: 1800 },
    ]
    const element = render()
    expect(element.querySelector('[data-games-played]')).toBeNull()
    // Late games would push the chart and moments down, so the strip stays out.
    act(() => reactRoot!.render(
      <StreamRecapSection payload={{ ...payload, games } as PulsePayload} backendUrl="https://api.example.test" uiState="ready" isLive={false}
        onJump={() => undefined} onAnalytics={() => undefined} onOpenAnalytics={() => undefined} />,
    ))
    expect(element.querySelector('[data-games-played]')).toBeNull()
    act(() => reactRoot?.unmount())
    expect(render(false, { ...payload, games } as PulsePayload).querySelector('[data-games-played]:not([data-games-played-empty])')).not.toBeNull()
  })
})
