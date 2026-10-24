// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CATCH_ME_UP_SCRIPT_FILE, injectCatchMeUp } from '../src/background/catchMeUpScript.ts'
import { MESSAGE_SENDER_SCOPE } from '../src/background/pulseBroadcastTargets.ts'
import { peakMinute, summaryClock } from '../src/content/catchMeUpStory.ts'
import type { CatchMeUpModel } from '../src/shared/catchMeUpContract.ts'
import type { ExtensionCoverageResponse, PulsePayload } from '../src/shared/messages.ts'
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

function model(fields: Partial<CatchMeUpModel> = {}): CatchMeUpModel {
  return {
    rollups: [],
    durationSeconds: 3 * 3600,
    peakChatPerMin: 480,
    summary: { vodId: null, title: null, games: [] },
    ...fields,
  }
}

const cover = 'https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-640x360.jpg'

/** The frames script, answering Twitch's cover and title of a VOD with `pictures`. */
function framesWith(pictures: { title?: string | null; cover?: string | null } | null) {
  const vod = vi.fn(async () => (pictures ? { sheets: [], cols: 0, rows: 0, count: 0, interval: 0, ...pictures } : null))
  globalThis.__pulseMomentFrames = { start: vi.fn(), keep: vi.fn(), mount: vi.fn(() => () => undefined), vod: vod as never }
  return vod
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve()
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

  it('builds the summary: the VOD, the title the recap knows and the games in the order played', () => {
    const built = catchMeUpModel({
      rollups: [],
      played: [
        { gameName: 'Minecraft', offsetSeconds: 1500, durationSeconds: 500 },
        { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1500 },
        { gameName: 'Just Chatting', offsetSeconds: 2000, durationSeconds: 1500 },
        { gameName: 'Elden Ring', offsetSeconds: 3000, durationSeconds: 500 },
      ],
      category: 'Minecraft',
      durationSeconds: 3500,
      peakChatPerMin: 9,
      vodId: '2905053845',
      title: 'GAMING TIME',
    })
    // A return is a step of its own.
    expect(built.summary).toEqual({ vodId: '2905053845', title: 'GAMING TIME', games: ['Just Chatting', 'Minecraft', 'Just Chatting', 'Elden Ring'] })
    expect(built).toMatchObject({ durationSeconds: 3500, peakChatPerMin: 9 })
    // With no game timeline, the stream's category; with neither, no games.
    expect(catchMeUpModel({ rollups: [], played: [], category: 'Minecraft', durationSeconds: 1, peakChatPerMin: 0 }).summary.games).toEqual(['Minecraft'])
    expect(catchMeUpModel({ rollups: [], durationSeconds: 1, peakChatPerMin: 0 }).summary.games).toEqual([])
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

  it('the content script reaches the summary only through the injected script', () => {
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
    for (const marker of ['Select this minute on the chart', 'pcu-sum-cover']) {
      expect(content.includes(marker), `twitch.js must not contain ${marker}`).toBe(false)
      expect(block.includes(marker), `catch-me-up.js must contain ${marker}`).toBe(true)
    }
    expect(content).toContain('CATCH_ME_UP_SCRIPT')
    expect(content).not.toContain('Biggest spike')
    expect(block).not.toMatch(/\bimport\s*\(|\bfrom\s*['"]|chunks\//)
  })
})

describe('Catch me up summary', () => {
  beforeAll(async () => {
    await import('../src/content/catchMeUp.ts')
  })
  afterEach(() => {
    globalThis.__pulseMomentFrames = undefined
    document.body.replaceChildren()
  })

  const host = () => {
    const element = document.createElement('div')
    document.body.append(element)
    return element
  }

  it('shows the peak alone when that is all it knows, and draws nothing with nothing to say', () => {
    const element = host()
    const block = globalThis.__pulseCatchMeUp!.mount(element, model(), { minute: vi.fn() })!
    // Minutes that do not cover the stream give the recap's peak, with no minute to select.
    expect(element.querySelector('.pcu-sum')!.textContent).toBe('Peak 480 chat/min')
    expect(element.querySelector('.pcu-sum-link, .pcu-sum-cover')).toBeNull()
    // Only the summary: none of the best three, Watch best or More.
    expect(element.querySelector('.pcu-rank, .pcu-mini, .pcu-tile, .pcu-btn, .pcu-more')).toBeNull()
    block.remove()
    expect(element.childElementCount).toBe(0)

    const empty = host()
    expect(globalThis.__pulseCatchMeUp!.mount(empty, model({ peakChatPerMin: 0 }), { minute: vi.fn() })).toBeNull()
    expect(empty.childElementCount).toBe(0)
  })

  it("sums the stream up with Twitch's cover and title, the games in order and a peak that selects its minute", async () => {
    const vod = framesWith({ title: 'GAMING TIME', cover })
    const rollups = Array.from({ length: 180 }, (_, minute) => ({ offsetSeconds: minute * 60, chatCount: minute === 154 ? 903 : 40 }))
    const summary = { vodId: '2905053845', title: null, games: ['Just Chatting', 'Minecraft'] }
    const minute = vi.fn()
    const element = host()
    const block = globalThis.__pulseCatchMeUp!.mount(element, model({ rollups, durationSeconds: 10_800 + 33, summary }), { minute })!
    expect(vod).toHaveBeenCalledWith({ vodId: '2905053845' })
    // The cover's place is kept while Twitch answers; the title waits for it.
    const place = element.querySelector('.pcu-sum-cover')!
    expect(place.textContent).toBe('3:00:33')
    expect(element.querySelector<HTMLElement>('.pcu-sum-title')!.hidden).toBe(true)
    await settle()
    expect(place.querySelector('img')!.getAttribute('src')).toBe(cover)
    const title = element.querySelector<HTMLElement>('.pcu-sum-title')!
    expect([title.hidden, title.textContent]).toEqual([false, 'GAMING TIME'])
    expect(element.querySelector('.pcu-sum-games')!.textContent).toBe('Just Chatting → Minecraft')
    const peak = element.querySelector<HTMLButtonElement>('.pcu-sum-link')!
    expect(peak.parentElement!.textContent).toBe('Peak 903 chat/min at 2:34')
    peak.click()
    expect(minute).toHaveBeenCalledWith(154 * 60)
    block.remove()
    expect(element.childElementCount).toBe(0)
  })

  it("shows a title the recap knows at once, keeps it over Twitch's, and drops a cover Twitch does not have or cannot load", async () => {
    framesWith({ title: 'Twitch title', cover: null })
    const element = host()
    globalThis.__pulseCatchMeUp!.mount(element, model({ summary: { vodId: '1', title: 'Stream title', games: [] } }), { minute: vi.fn() })
    const title = element.querySelector<HTMLElement>('.pcu-sum-title')!
    expect([title.hidden, title.textContent]).toEqual([false, 'Stream title'])
    await settle()
    expect(title.textContent).toBe('Stream title')
    expect(element.querySelector('.pcu-sum-cover')).toBeNull()

    framesWith({ title: null, cover })
    const broken = host()
    globalThis.__pulseCatchMeUp!.mount(broken, model({ summary: { vodId: '2', title: null, games: [] } }), { minute: vi.fn() })
    await settle()
    broken.querySelector('.pcu-sum-cover img')!.dispatchEvent(new Event('error'))
    expect(broken.querySelector('.pcu-sum-cover')).toBeNull()
  })

  it('asks for no cover with Moment pictures off or no VOD', () => {
    const element = host()
    globalThis.__pulseCatchMeUp!.mount(element, model({ summary: { vodId: '2905053845', title: null, games: ['Just Chatting'] } }), { minute: vi.fn() })
    expect(element.querySelector('.pcu-sum-cover')).toBeNull()
    const vod = framesWith(null)
    globalThis.__pulseCatchMeUp!.mount(host(), model({ summary: { vodId: null, title: null, games: ['Just Chatting'] } }), { minute: vi.fn() })
    expect(vod).not.toHaveBeenCalled()
  })
})

describe('Stream recap: summary, games, chart and Top moments, as on live', () => {
  let reactRoot: Root | null = null
  afterEach(() => {
    act(() => reactRoot?.unmount())
    reactRoot = null
    globalThis.__pulseMomentFrames = undefined
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
    topEmotes: [{ name: 'KEKW', count: 900, provider: 'bttv' }],
    recap: {
      streamId: 'stream-1',
      login: 'test',
      durationSeconds: 3600,
      totalMessages: 4000,
      peakChatPerMin: 90,
      topMoments: moments,
      topEmotes: [{ code: 'KEKW', count: 900, provider: 'bttv' }],
      clipCandidates: [],
    },
  } as unknown as PulsePayload
  // The same stream with no recap: the offline channel page's form.
  const offline = {
    ...payload,
    recap: undefined,
    peaks: moments.map(moment => ({ ...moment, dominantSignal: 'chat' })),
  } as unknown as PulsePayload
  const games = [
    { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1800 },
    { gameName: 'Minecraft', offsetSeconds: 1800, durationSeconds: 1800 },
  ]

  function render(vodPage = false, shown = payload, more: { coverage?: ExtensionCoverageResponse; archiveVodId?: string } = {}) {
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
        coverage={more.coverage}
        archiveVodId={more.archiveVodId}
        onJump={() => undefined}
        onAnalytics={() => undefined}
        onOpenAnalytics={() => undefined}
      />,
    ))
    return element
  }
  const rows = (element: ParentNode) => [...element.querySelectorAll<HTMLButtonElement>('.pulse-moment-row-button')]
  const times = (element: ParentNode) => rows(element).map(row => row.getAttribute('aria-label')!.match(/\d\d:\d\d/)![0])
  const click = (target: HTMLElement) => act(() => target.click())
  /** Turns Spikes on or off (they start off); the viewer's last choice carries over from an earlier test. */
  const setSpikes = (element: ParentNode, on: boolean) => {
    const toggle = element.querySelector<HTMLElement>('[data-chart-moment-toggle="true"]')!
    if ((toggle.getAttribute('aria-pressed') === 'true') !== on) click(toggle)
  }
  /** The recap's rows, top to bottom, by what each one is. */
  const order = (element: HTMLElement) => {
    const content = element.querySelector<HTMLElement>('[data-pmf-list]')!.parentElement!.parentElement!
    return [...content.children].filter(child => !(child as HTMLElement).hidden).map(child => {
      const has = (selector: string) => child.matches(selector) || child.querySelector(selector) != null
      if (has('.pcu-sum')) return 'summary'
      if (has('[data-games-played]')) return 'games'
      if (has('[data-chart-moment-toggle]')) return 'chart'
      if (child.querySelector('h4')?.textContent === 'Top moments') return 'top moments'
      if (has('[data-pmf-list]')) return 'list'
      return null
    }).filter(Boolean)
  }

  it('draws one form on the VOD page, the channel page and with no recap', () => {
    for (const [vodPage, shown] of [[true, payload], [false, payload], [false, offline]] as const) {
      const element = render(vodPage, { ...shown, games } as PulsePayload)
      expect(order(element)).toEqual(['summary', 'games', 'chart', 'top moments', 'list'])
      // None of the best three, Watch best, More, pins or the top emotes.
      expect(element.querySelector('.pcu-mini, .pcu-tile, .pcu-btn, details, [data-chart-pin]')).toBeNull()
      expect(element.textContent).not.toContain('Top emotes')
      expect(element.textContent).toContain('Chat and emote spikes')
      act(() => reactRoot?.unmount())
      document.body.replaceChildren()
    }
  })

  it('lists five moments strongest first with their count and Sort, and Show more lists the rest', () => {
    const element = render()
    expect(element.textContent).toContain('8 moments')
    expect(element.querySelector('[role="combobox"][aria-label="Sort top moments"]')!.textContent).toContain('Strongest reaction')
    expect(times(element)).toEqual(['00:05', '00:12', '00:19', '00:26', '00:33'])
    const more = element.querySelector<HTMLButtonElement>('.pulse-moment-more')!
    expect(more.textContent).toContain('Show 3 more moments')
    // Show more is the list's last row.
    expect(more.previousElementSibling!.hasAttribute('data-pmf-list')).toBe(true)
    click(more)
    expect(times(element)).toEqual(['00:05', '00:12', '00:19', '00:26', '00:33', '00:40', '00:47', '00:54'])
  })

  it('sorts by chat activity as live does', async () => {
    // Chat that grows through the stream: the latest moment has the most.
    const busier = { ...payload, rollups: payload.rollups.map(rollup => ({ ...rollup, chatCount: 20 + rollup.offsetSeconds / 60 })) } as PulsePayload
    const element = render(false, busier)
    // The options open in a portal placed by the trigger's box, inside the viewport.
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, top: 10, left: 10, bottom: 42, right: 210, width: 200, height: 32, toJSON() {} })
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 })
    try {
      const trigger = element.querySelector<HTMLElement>('[role="combobox"][aria-label="Sort top moments"]')!
      await act(async () => { trigger.click() })
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.startsWith('Chat activity'))!
      await act(async () => {
        option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
        option.click()
      })
    } finally {
      bounds.mockRestore()
      Reflect.deleteProperty(document.documentElement, 'clientWidth')
    }
    expect(times(element)).toEqual(['00:54', '00:47', '00:40', '00:33', '00:26'])
  })

  it('opens a picked row in the card above the rows, and closes it when picked again', () => {
    const element = render(true)
    const list = element.querySelector('[data-pmf-list]')!
    click(rows(element)[1]!)
    const card = element.querySelector('[data-top-moment-card="selected"]')!
    expect(card.textContent).toContain('00:12')
    expect(card.nextElementSibling).toBe(list)
    expect(rows(element)[1]!.getAttribute('aria-controls')).toBe(card.id)
    click(rows(element)[1]!)
    expect(element.querySelector('[data-top-moment-card="selected"]')).toBeNull()
  })

  it('opens a listed spike in the Top moments card, and a minute the list does not rank under the chart', () => {
    const element = render(true)
    setSpikes(element, true)
    act(() => element.querySelector('[data-chart-moment-marker-offset="720"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(element.querySelector('[data-top-moment-card="selected"]')!.textContent).toContain('00:12')
    setSpikes(element, false)
    // The summary's peak is the chart's busiest minute (the first of a tie), which it selects.
    const peak = element.querySelector<HTMLButtonElement>('.pcu-sum .pcu-sum-link')!
    expect(peak.parentElement!.textContent).toBe('Peak 20 chat/min at 0:00')
    click(peak)
    expect(element.querySelector('[data-moment-inspector-clock="true"]')!.textContent).toMatch(/^00:00/)
    expect(element.querySelector('[data-top-moment-card="selected"]')).toBeNull()
  })

  it('names the game the moment cards name, even where the recap rejects its game timeline', () => {
    // Games that run past the recap's length, as when its minutes stop early:
    // the recap's game strip leaves them out, the cards still name them.
    const longGames = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1000 },
      { gameName: 'Minecraft', offsetSeconds: 1000, durationSeconds: 6000 },
    ]
    const element = render(false, { ...payload, games: longGames } as PulsePayload)
    click(rows(element)[2]!)
    const card = element.querySelector('[data-top-moment-card="selected"]')!
    expect(card.textContent).toContain('Minecraft')
    // Its height reserves the game line, so swapping moments moves nothing.
    expect(card.querySelector<HTMLElement>('[data-moment-reserve]')!.style.minHeight)
      .toBe(`${MOMENT_CARD_HEIGHT + MOMENT_CARD_GAME_LINE_HEIGHT}px`)
  })

  it("names the channel page's stream title once, and leaves the VOD page's to Twitch", () => {
    const coverage = { liveMetadata: { title: 'Last stream title' } } as ExtensionCoverageResponse
    const channel = render(false, payload, { coverage })
    expect(channel.querySelector('.pcu-sum-title')!.textContent).toBe('Last stream title')
    expect(channel.textContent!.split('Last stream title')).toHaveLength(2)
    act(() => reactRoot?.unmount())
    const vod = render(true, payload, { coverage })
    expect(vod.querySelector<HTMLElement>('.pcu-sum-title')!.hidden).toBe(true)
    expect(vod.textContent).not.toContain('Last stream title')
  })

  it("asks Twitch for the cover of the stream history's VOD where the payload names none", () => {
    const vod = framesWith(null)
    render(false, { ...payload, vodId: null } as unknown as PulsePayload, { archiveVodId: '2905053845' })
    expect(vod).toHaveBeenCalledWith({ vodId: '2905053845' })
  })

  it("keeps the summary's place while its script loads, lists the moments at once, and drops the place when it never comes", async () => {
    const script = globalThis.__pulseCatchMeUp
    globalThis.__pulseCatchMeUp = undefined
    vi.useFakeTimers()
    vi.stubGlobal('chrome', { runtime: { id: 'test', sendMessage: () => new Promise(() => {}) } })
    try {
      const element = render()
      const slot = element.querySelector('[data-pmf-list]')!.parentElement!.parentElement!.firstElementChild as HTMLElement
      expect([slot.hidden, slot.style.minHeight]).toEqual([false, '63px'])
      expect(times(element)).toHaveLength(5)
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(slot.hidden).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
      globalThis.__pulseCatchMeUp = script
    }
  })

  it('draws no Games played strip while the games are unknown, and keeps it out when they arrive later', () => {
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
