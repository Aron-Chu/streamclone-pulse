// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MomentFramesApi, MomentPictureView } from '../src/shared/momentFramesContract.ts'

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void

let api: MomentFramesApi
const storageListeners: StorageListener[] = []
const sendMessage = vi.fn(async () => ({ wants: [] }))
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
  // Master asks for pending saved-picture requests once at startup.
  await Promise.resolve()
  sendMessage.mockClear()
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

/** Local-capture stability; remote/exact fallback behavior stays in momentFramesRemote.test.ts. */
describe('Open card pictures from this tab’s captures', () => {
  it('pins the first visible card picture while newer captures keep improving its row thumbnail', () => {
    const { host } = thumbHost()
    mount(host, THUMB)
    const card = cardHost()
    mount(card, CARD)
    capture(3020)
    const first = shown(card)
    expect(first).toMatch(/^blob:/)

    capture(3049)
    expect(shown(host)).not.toBe(first)
    expect(shown(card)).toBe(first)
    expect(card.querySelector('.pmf-time')?.textContent).toBe('00:50:20')
    expect(card.querySelector<HTMLElement>('.pmf-peak')?.hidden).toBe(false)
    // Stopping the last capture source is not a stream change or a picture reset.
    stops.pop()!()
    expect(shown(card)).toBe(first)
    expect(revokeObjectURL).not.toHaveBeenCalledWith(first)
  })

  it('preserves a scrubbed frame across capture insertion and returns to the original peak on leave', () => {
    capture(3020)
    capture(3040)
    capture(3080)
    const card = cardHost()
    mount(card, CARD)
    const peak = shown(card)
    const figure = card.querySelector<HTMLElement>('.pmf-pic')!
    figure.focus()
    vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    figure.dispatchEvent(new MouseEvent('pointerdown', { clientX: 99 }))
    const scrubbed = shown(card)
    expect(scrubbed).not.toBe(peak)

    capture(3025)
    capture(3049)
    expect(shown(card)).toBe(scrubbed)
    expect(document.activeElement).toBe(figure)
    expect(card.querySelector('.pmf-time')?.textContent).toBe('00:51:20')
    figure.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(card.querySelector('.pmf-time')?.textContent).toBe('00:50:49')
    figure.dispatchEvent(new Event('pointerleave'))
    expect(shown(card)).toBe(peak)
    expect(card.querySelector('.pmf-time')?.textContent).toBe('00:50:40')
  })

  it('retains only the card’s peak and chosen frame through eviction, releasing them when no card needs them', () => {
    capture(3040)
    capture(3060)
    capture(3080)
    const card = cardHost()
    const unmountCard = api.mount(card, CARD)
    const otherCard = cardHost()
    const unmountOther = api.mount(otherCard, CARD)
    mounted.push(unmountCard, unmountOther)
    const peak = shown(card)
    const figure = card.querySelector<HTMLElement>('.pmf-pic')!
    vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    figure.dispatchEvent(new MouseEvent('pointerdown', { clientX: 99 }))
    const scrubbed = shown(card)

    video.paused = true
    vi.advanceTimersByTime(6 * 60_000 + 1_000)
    video.paused = false
    capture(5000)
    expect(shown(card)).toBe(scrubbed)
    expect(shown(otherCard)).toBe(peak)
    expect(revokeObjectURL).not.toHaveBeenCalledWith(peak)
    expect(revokeObjectURL).not.toHaveBeenCalledWith(scrubbed)
    // The third, unselected frame is not retained by either card.
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)

    figure.dispatchEvent(new Event('pointerleave'))
    expect(shown(card)).toBe(peak)
    expect(revokeObjectURL).toHaveBeenCalledWith(scrubbed)
    // Released frames are no longer keyboard or pointer scrub targets.
    figure.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(shown(card)).toBe(peak)
    unmountCard()
    expect(revokeObjectURL).not.toHaveBeenCalledWith(peak)
    unmountOther()
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === peak)).toHaveLength(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(3)
  })

  it('clears retained card pictures on settings-off and stream changes even after the capture store is empty', () => {
    const card = cardHost()
    mount(card, CARD)
    capture(3040)
    const first = shown(card)
    video.paused = true
    vi.advanceTimersByTime(6 * 60_000 + 1_000)
    api.keep([])
    expect(shown(card)).toBe(first)
    expect(revokeObjectURL).not.toHaveBeenCalledWith(first)

    setPictures(false)
    expect(shown(card)).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith(first)
    setPictures(true)
    video.paused = false
    capture(3050)
    const second = shown(card)
    expect(second).not.toBe(first)
    video.paused = true
    vi.advanceTimersByTime(6 * 60_000 + 1_000)
    api.keep([])
    expect(shown(card)).toBe(second)
    startStream()
    expect(shown(card)).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith(second)
    video.paused = false
    capture(3060)
    const third = shown(card)
    expect(third).not.toBe(second)
    // Closing the newest source also clears its card before returning to the old one.
    stops.pop()!()
    expect(shown(card)).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith(third)
  })

})
