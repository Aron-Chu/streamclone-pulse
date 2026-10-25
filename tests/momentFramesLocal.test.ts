// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MomentFramesApi, MomentPictureView } from '../src/shared/momentFramesContract.ts'

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void

let api: MomentFramesApi
const storageListeners: StorageListener[] = []
const sendMessage = vi.fn()
const fetchSpy = vi.fn()
/** Object URLs of captured frames, made and released. */
let made = 0
const revokeObjectURL = vi.fn()
/** Captures the canvas is still encoding, oldest first. */
const encoding: BlobCallback[] = []
const video = { paused: false, seeking: false, readyState: 4, videoWidth: 1280, videoHeight: 720 }
/** The stream offset the player shows. */
let playing = 0
let streams = 0
const stops: Array<() => void> = []
const mounted: Array<() => void> = []

const THUMB = { kind: 'thumb', from: 3019, to: 3109, peak: 3049 } as const
const CARD = { ...THUMB, kind: 'card' } as const
const OTHER = { kind: 'thumb', from: 4019, to: 4109, peak: 4049 } as const

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    storage: { onChanged: { addListener: (listener: StorageListener) => storageListeners.push(listener) } },
    runtime: { sendMessage },
  })
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  Object.assign(URL, { createObjectURL: () => `blob:https://www.twitch.tv/frame-${++made}`, revokeObjectURL })
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => undefined })) as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) { encoding.push(callback) }
  await import('../src/content/momentFrames.ts')
  api = (globalThis as { __pulseMomentFrames?: MomentFramesApi }).__pulseMomentFrames!
})

beforeEach(() => {
  vi.useFakeTimers()
  video.paused = false
  startStream()
  revokeObjectURL.mockClear()
})

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  for (const stop of stops.splice(0)) stop()
  finishEncoding()
  setPictures(true)
  api.keep([])
  document.body.replaceChildren()
  vi.useRealTimers()
})

/** A new stream (or VOD) opens in this tab; another stream's frames are dropped. */
function startStream(): void {
  stops.push(api.start({ key: `stream-${++streams}`, video: () => video as unknown as HTMLVideoElement, offset: () => playing }))
}

function finishEncoding(): void {
  for (const done of encoding.splice(0)) done(new Blob(['jpeg'], { type: 'image/jpeg' }))
}

/** The player shows `offset` at the next capture, which then finishes encoding. */
function capture(offset: number): void {
  playing = offset
  vi.advanceTimersByTime(4_000)
  finishEncoding()
}

function setPictures(on: boolean): void {
  for (const listener of storageListeners) listener({ momentPicturesEnabled: { newValue: on } }, 'sync')
}

function mount(host: HTMLElement, view: MomentPictureView): void {
  mounted.push(api.mount(host, view))
}

function thumbHost(): { host: HTMLElement; list: HTMLElement } {
  const list = document.createElement('div')
  list.setAttribute('data-pmf-list', '')
  const row = document.createElement('button')
  const host = document.createElement('span')
  host.className = 'pmf-thumb'
  row.append(host)
  list.append(row)
  document.body.append(list)
  return { host, list }
}

function cardHost(): HTMLElement {
  const host = document.createElement('div')
  host.className = 'pmf-stage'
  document.body.append(host)
  return host
}

const shown = (host: HTMLElement): string | null => host.querySelector('img')?.getAttribute('src') ?? null

/**
 * 0.2.2 keeps Moment pictures to this tab's own captures: rows and cards read
 * one frame store, so the shared-frame fixes master needed for its fetched VOD
 * frames (#159, #162) reduce to these guarantees here.
 */
describe('Moment pictures from this tab’s captures', () => {
  it('fills a matching row with the frame the open card shows, and the row keeps it after the card closes', () => {
    const { host, list } = thumbHost()
    mount(host, THUMB)
    const card = cardHost()
    const unmountCard = api.mount(card, CARD)
    expect(host.querySelector('img')).toBeNull()
    expect(card.childElementCount).toBe(0)

    capture(3050)
    const frame = card.querySelector('.pmf-pic img')?.getAttribute('src')
    expect(frame).toMatch(/^blob:/)
    expect(shown(host)).toBe(frame)
    expect(host.hasAttribute('data-has')).toBe(true)
    expect(list.hasAttribute('data-pmf-pictures')).toBe(true)

    unmountCard()
    expect(card.childElementCount).toBe(0)
    expect(shown(host)).toBe(frame)
    expect(host.hasAttribute('data-has')).toBe(true)
    expect(list.hasAttribute('data-pmf-pictures')).toBe(true)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('keeps the empty placeholder while the moment has no frame, then fills the same row in place', () => {
    const { host, list } = thumbHost()
    mount(host, THUMB)
    expect(host.hasAttribute('data-has')).toBe(false)
    expect(host.title).toBe('No picture: Pulse only keeps frames from while this tab was playing')
    expect(list.hasAttribute('data-pmf-pictures')).toBe(false)

    capture(2500)
    expect(host.querySelector('img')).toBeNull()
    const card = cardHost()
    mount(card, CARD)
    expect(card.querySelector('.pmf-none')?.textContent).toBe('No picture of this moment: this tab wasn’t playing then.')

    capture(3049)
    expect(host.isConnected).toBe(true)
    expect(shown(host)).toMatch(/^blob:/)
    expect(host.title).toBe('')
    expect(list.hasAttribute('data-pmf-pictures')).toBe(true)
    expect(card.querySelector('.pmf-none')).toBeNull()
    expect(card.querySelector('.pmf-pic img')?.getAttribute('src')).toBe(shown(host))
  })

  it('drops every frame when pictures go off, captures nothing while off, and fills the same rows again once back on', () => {
    const { host, list } = thumbHost()
    mount(host, THUMB)
    capture(3049)
    const first = shown(host)
    expect(first).toMatch(/^blob:/)

    // A frame still encoding when the setting flips is never kept.
    playing = 3060
    vi.advanceTimersByTime(4_000)
    expect(encoding).toHaveLength(1)
    setPictures(false)
    const madeBefore = made
    finishEncoding()
    expect(made).toBe(madeBefore)
    expect(host.querySelector('img')).toBeNull()
    expect(host.hasAttribute('data-has')).toBe(false)
    expect(list.hasAttribute('data-pmf-pictures')).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledWith(first)

    playing = 3070
    vi.advanceTimersByTime(4_000)
    expect(encoding).toHaveLength(0)

    setPictures(true)
    capture(3080)
    expect(shown(host)).toMatch(/^blob:/)
    expect(shown(host)).not.toBe(first)
    expect(host.hasAttribute('data-has')).toBe(true)
    expect(list.hasAttribute('data-pmf-pictures')).toBe(true)
  })

  it('rolls an unranked moment’s frame off after the window, keeps a ranked one, and refills when the tab plays it again', () => {
    api.keep([[3019, 3139]])
    const ranked = thumbHost()
    mount(ranked.host, THUMB)
    const other = thumbHost()
    mount(other.host, OTHER)
    capture(3049)
    capture(4049)
    const rankedFrame = shown(ranked.host)
    const otherFrame = shown(other.host)
    expect(rankedFrame).toMatch(/^blob:/)
    expect(otherFrame).toMatch(/^blob:/)

    video.paused = true
    vi.advanceTimersByTime(6 * 60_000 + 1_000)
    video.paused = false
    capture(5000)
    expect(other.host.querySelector('img')).toBeNull()
    expect(other.host.hasAttribute('data-has')).toBe(false)
    expect(other.list.hasAttribute('data-pmf-pictures')).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledWith(otherFrame)
    expect(shown(ranked.host)).toBe(rankedFrame)
    expect(revokeObjectURL).not.toHaveBeenCalledWith(rankedFrame)

    // Seeking back plays the moment again: its row recovers from a fresh capture.
    capture(4050)
    expect(shown(other.host)).toMatch(/^blob:/)
    expect(shown(other.host)).not.toBe(otherFrame)
  })

  it('drops a frame still encoding when another stream opens, and never shows the old stream’s frames', () => {
    const { host } = thumbHost()
    mount(host, THUMB)
    capture(3040)
    const old = shown(host)
    expect(old).toMatch(/^blob:/)

    playing = 3050
    vi.advanceTimersByTime(4_000)
    expect(encoding).toHaveLength(1)
    startStream()
    finishEncoding()
    expect(host.querySelector('img')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith(old)

    capture(3045)
    expect(shown(host)).toMatch(/^blob:/)
    expect(shown(host)).not.toBe(old)
  })

  it('shows a Catch me up thumbnail once its moment has a frame, styled inside the panel', async () => {
    await import('../src/content/catchMeUp.ts')
    const panel = document.createElement('div')
    document.body.append(panel)
    const shadow = panel.attachShadow({ mode: 'open' })
    const host = document.createElement('div')
    shadow.append(host)
    const pageStyles = document.head.querySelectorAll('style').length
    const point = (offsetSeconds: number) => ({
      minuteTs: '2026-06-11T12:00:00.000Z',
      offsetSeconds,
      score: 90,
      estimated: false,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 212,
      emoteCount: 0,
      topEmotes: [],
      collecting: false,
    })
    const moment = (offset: number, view: MomentPictureView) => ({ point: point(offset), card: { ...view, kind: 'card' as const }, thumb: { ...view, kind: 'thumb' as const } })
    const model = {
      moments: [moment(9_660, { kind: 'card', from: 9_640, to: 9_690, peak: 9_657 }), moment(3_049, THUMB), moment(4_049, OTHER)],
      rollups: [],
      durationSeconds: 3 * 3600,
      peakChatPerMin: 480,
      momentCount: 20,
      namesGame: false,
      backendUrl: 'https://api.example.test',
      vodPage: true,
    }
    const framesStyles = () => [...shadow.querySelectorAll('style')].filter(style => style.textContent?.includes('[data-pmf-pictures] .pmf-thumb'))
    // The recap draws the block again when its moments change.
    globalThis.__pulseCatchMeUp!.mount(host, model, { jump: vi.fn(), pick: vi.fn() }).remove()
    const block = globalThis.__pulseCatchMeUp!.mount(host, model, { jump: vi.fn(), pick: vi.fn() })
    mounted.push(block.remove)
    // The picture styles land in the panel once, never in Twitch's page.
    expect(document.head.querySelectorAll('style')).toHaveLength(pageStyles)
    expect(framesStyles()).toHaveLength(1)
    const pair = host.querySelector<HTMLElement>('.pcu-pair')!
    const [played, unplayed] = [...pair.querySelectorAll<HTMLElement>('.pmf-thumb')]
    expect(pair.hasAttribute('data-pmf-pictures')).toBe(false)

    capture(3049)
    expect(shown(played!)).toMatch(/^blob:/)
    expect(shown(unplayed!)).toBeNull()
    // The list shows its thumbnails, as Top Moments does.
    expect(pair.hasAttribute('data-pmf-pictures')).toBe(true)
    expect(document.head.querySelectorAll('style')).toHaveLength(pageStyles)
    expect(framesStyles()).toHaveLength(1)
  })

  it('draws only this tab’s captures: no worker message, no network request, no other picture source', () => {
    const { host } = thumbHost()
    mount(host, THUMB)
    const card = cardHost()
    mount(card, CARD)
    capture(3040)
    capture(3050)
    const sources = [...document.querySelectorAll('img')].map(image => image.getAttribute('src'))
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) expect(source).toMatch(/^blob:https:\/\/www\.twitch\.tv\/frame-/)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
