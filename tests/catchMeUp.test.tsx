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
import { busiestHalfHour, catchMeUpStory, streamClock } from '../src/content/catchMeUpStory.ts'
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
    ...fields,
  }
}

describe('Catch me up story', () => {
  it('finds the half hour with the most chat, in whole minutes, ending by the stream end', () => {
    const rollups = Array.from({ length: 120 }, (_, minute) => ({ offsetSeconds: minute * 60, chatCount: minute >= 70 && minute < 100 ? 50 : 5 }))
    expect(busiestHalfHour(rollups, 7200)).toBe(70 * 60)
    // A burst in the last minutes still names a full half hour.
    const late = rollups.map(rollup => ({ ...rollup, chatCount: rollup.offsetSeconds >= 118 * 60 ? 900 : 1 }))
    expect(busiestHalfHour(late, 7200)).toBe(90 * 60)
  })

  it('names no half hour for a stream under an hour, or one without chat', () => {
    const rollups = [{ offsetSeconds: 60, chatCount: 10 }]
    expect(busiestHalfHour(rollups, 3599)).toBeNull()
    expect(busiestHalfHour([{ offsetSeconds: 60, chatCount: 0 }], 7200)).toBeNull()
    expect(busiestHalfHour([], 7200)).toBeNull()
  })

  it('names no half hour when the minutes cover only part of the stream', () => {
    const minutes = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => ({ offsetSeconds: (from + index) * 60, chatCount: 10 }))
    // The first four hours of a 5h10m stream, as a capped history can hold.
    expect(busiestHalfHour(minutes(0, 239), 18_598)).toBeNull()
    // The last hour only, as a live window holds.
    expect(busiestHalfHour(minutes(180, 240), 14_400)).toBeNull()
    expect(busiestHalfHour(minutes(1, 239), 14_400)).toBe(60)
  })

  it('tells where the #1 moment came, its emote burst, and the busiest half hour', () => {
    const rollups = Array.from({ length: 180 }, (_, minute) => ({ offsetSeconds: minute * 60, chatCount: minute >= 90 && minute < 120 ? 40 : 2 }))
    const story = catchMeUpStory(model({ rollups, durationSeconds: 3 * 3600 }))!
    expect(`${story.lead}${story.clock}${story.tail}`).toBe('Chat\'s biggest moment came around 02:41 (KEKW ×212).')
    expect(story.busiest).toBe('The busiest half hour was 01:30–02:00.')
    expect(streamClock(9_660)).toBe('02:41')
  })

  it('says "around" for a moment known only to its minute, and names the game only when there were several', () => {
    const exact = model({ namesGame: true })
    exact.moments[0]!.point = point(9_660, { reactionOnsetOffsetSeconds: 9_665, precisionSeconds: 1 })
    const told = catchMeUpStory(exact)!
    expect(`${told.lead}${told.clock}${told.tail}`).toBe('Chat\'s biggest moment came at 02:41:05 in Just Chatting (KEKW ×212).')
    expect(catchMeUpStory(model())!.lead).toBe('Chat\'s biggest moment came around ')
    expect(catchMeUpStory(model({ moments: [] }))).toBeNull()
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
    })!
    expect(built.moments.map(moment => moment.point.offsetSeconds)).toEqual([600, 1200, 1800])
    expect(built.moments.map(moment => moment.game?.name)).toEqual(['Just Chatting', 'Just Chatting', 'Minecraft'])
    expect(built.moments[0]!.card.kind).toBe('card')
    expect(built.moments[0]!.thumb.kind).toBe('thumb')
    expect(built).toMatchObject({ momentCount: 4, namesGame: true, vodPage: true })
    expect(catchMeUpModel({ ...built, points: [], games: [] })).toBeNull()
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
    for (const marker of ['biggest moment came', 'The busiest half hour was', 'at the busiest']) {
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

  it('shows the story, the #1 moment with Jump, the next two, and the totals, with no picture when this tab has none', () => {
    const element = host()
    const jump = vi.fn()
    const pick = vi.fn()
    const block = globalThis.__pulseCatchMeUp!.mount(element, model(), { jump, pick })
    expect(element.querySelector('.pcu-head')!.textContent).toBe('Chat\'s biggest moment came around 02:41 (KEKW ×212).')
    expect(element.querySelector('.pcu-rank')!.textContent).toBe('#1 moment · Chat spike')
    // One game known (a VOD's lone category) is not named as the moment's.
    expect(element.querySelector('.pcu-game')).toBeNull()
    const several = globalThis.__pulseCatchMeUp!.mount(host(), model({ namesGame: true }), { jump, pick })
    expect(document.querySelector('.pcu-game')!.textContent).toBe('Just Chatting')
    several.remove()
    expect(element.querySelector('.pcu-pic')!.childElementCount).toBe(0)
    expect(element.querySelectorAll('.pcu-pic img, .pcu-mini img')).toHaveLength(0)
    expect(element.querySelector('.pcu-stats')!.textContent).toBe('480/min at the busiest20 moments')
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
    globalThis.__pulseCatchMeUp!.mount(element, model({ vodPage: true }), { jump, pick: vi.fn() })
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

  it('draws a picture only through the frames script, and removes it with the block', () => {
    const element = host()
    const unmount = vi.fn()
    const mount = vi.fn((target: HTMLElement) => {
      target.append(document.createElement('img'))
      return unmount
    })
    globalThis.__pulseMomentFrames = { start: vi.fn(), keep: vi.fn(), mount }
    try {
      const block = globalThis.__pulseCatchMeUp!.mount(element, model(), { jump: vi.fn(), pick: vi.fn() })
      expect(mount.mock.calls.map(([, view]) => view.kind)).toEqual(['card', 'thumb', 'thumb'])
      expect(element.querySelector('.pcu-pair')!.hasAttribute('data-pmf-list')).toBe(true)
      block.remove()
      expect(unmount).toHaveBeenCalledTimes(3)
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

  it('shows the best three in the block, folds the rest under it, and opens a mini’s card under the block', () => {
    const element = render()
    const slot = element.querySelector<HTMLElement>('.pcu-slot')!
    expect(slot.hidden).toBe(false)
    expect(slot.querySelector('.pcu-head')!.textContent).toMatch(/^Chat's biggest moment came around 00:05/)
    expect(element.textContent).not.toContain('Biggest spike')
    expect(element.textContent).not.toContain('Top moments')
    // The rest start folded; the three above are not listed again.
    expect(rows(element)).toHaveLength(0)
    const more = [...element.querySelectorAll('button')].find(button => button.textContent?.startsWith('Show 5 more moments'))!
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
    expect(slot.querySelector('.pcu-head')!.textContent).toContain('came around 00:05 in Just Chatting')
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
    expect([...render(true).querySelectorAll('.pcu-btn')].map(button => button.textContent)).toEqual(['▶ Jump', 'Watch best 3'])
  })
})
