// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MomentFramesApi, MomentPictureAt } from '../src/shared/momentFramesContract.ts'

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void

let api: MomentFramesApi
let remoteUrl: (at: MomentPictureAt | undefined, t: number) => string | null
const storageListeners: StorageListener[] = []
/** Every <img> the renderer made; a backend picture loads detached until it is ready. */
let images: HTMLImageElement[] = []

const AT: MomentPictureAt = { api: 'https://api.streampulse.stream/', key: '319006602597', login: 'forsen', vodId: '2905053845' }
const PICTURE = 'https://api.streampulse.stream/v1/analytics/moments/picture?stream=319006602597&t=3049&login=forsen&vod=2905053845'
const THUMB = { kind: 'thumb', from: 3019, to: 3109, peak: 3049 } as const

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    storage: { onChanged: { addListener: (listener: StorageListener) => storageListeners.push(listener) } },
    runtime: { onMessage: { addListener: () => undefined }, sendMessage: () => Promise.resolve({}) },
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const node = create(tag, options)
    if (node instanceof HTMLImageElement) images.push(node)
    return node
  }) as typeof document.createElement)
  ;({ remoteUrl } = await import('../src/content/momentFrames.ts'))
  api = (globalThis as { __pulseMomentFrames?: MomentFramesApi }).__pulseMomentFrames!
})

beforeEach(() => {
  images = []
})

/** The backend picture the renderer is loading for `url`, if it asked for one. */
function requested(url = PICTURE): HTMLImageElement | undefined {
  return images.filter(image => image.getAttribute('src') === url).at(-1)
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

function setPictures(on: boolean) {
  for (const listener of storageListeners) listener({ momentPicturesEnabled: { newValue: on } }, 'sync')
}

/** Server pictures for moments this tab holds no frames of (stream-preview board, option A). */
describe('Moment pictures from the backend', () => {
  it('asks for the stream second, with the login and VOD hint when known', () => {
    expect(remoteUrl(AT, 3049.4)).toBe(PICTURE)
    expect(remoteUrl({ api: 'https://api.streampulse.stream', key: '319006602597' }, -5))
      .toBe('https://api.streampulse.stream/v1/analytics/moments/picture?stream=319006602597&t=0')
  })

  it('asks nothing without a backend or a stream id', () => {
    expect(remoteUrl(undefined, 10)).toBeNull()
    expect(remoteUrl({ key: '319006602597' }, 10)).toBeNull()
    expect(remoteUrl({ api: 'https://api.streampulse.stream', key: null, vodId: '2905053845' }, 10)).toBeNull()
  })

  it('keeps the old empty thumbnail until the picture loads, then shows it', () => {
    const { host, list } = thumbHost()
    const unmount = api.mount(host, THUMB, AT)
    const image = requested()!
    expect(image.referrerPolicy).toBe('no-referrer')
    expect(host.querySelector('img')).toBeNull()
    expect(host.hasAttribute('data-has')).toBe(false)
    expect(host.title).toMatch(/^No picture/)
    expect(list.hasAttribute('data-pmf-pictures')).toBe(false)

    image.dispatchEvent(new Event('load'))
    expect(host.querySelector('img')).toBe(image)
    expect(host.hasAttribute('data-has')).toBe(true)
    expect(host.title).toBe('')
    expect(list.hasAttribute('data-pmf-pictures')).toBe(true)
    unmount()
  })

  it('never shows a picture that fails, so the view never opens and collapses', () => {
    const { host, list } = thumbHost()
    const unmount = api.mount(host, THUMB, AT)
    requested()!.dispatchEvent(new Event('error'))
    expect(host.querySelector('img')).toBeNull()
    expect(host.hasAttribute('data-has')).toBe(false)
    expect(host.title).toMatch(/^No picture/)
    expect(list.hasAttribute('data-pmf-pictures')).toBe(false)
    unmount()

    const card = document.createElement('div')
    document.body.append(card)
    const unmountCard = api.mount(card, { ...THUMB, kind: 'card' }, AT)
    requested()!.dispatchEvent(new Event('error'))
    expect(card.querySelector('.pmf-pic')).toBeNull()
    unmountCard()
  })

  it('shows a loaded picture as a card, and Catch me up (which names no stream) reuses the last one', () => {
    const card = document.createElement('div')
    document.body.append(card)
    const unmountCard = api.mount(card, { ...THUMB, kind: 'card' }, AT)
    expect(card.querySelector('.pmf-pic')).toBeNull()
    requested()!.dispatchEvent(new Event('load'))
    const figure = card.querySelector('.pmf-pic')!
    expect(figure.getAttribute('role')).toBe('img')
    expect(figure.getAttribute('aria-label')).toBe('Picture at 00:50:49')
    expect(figure.querySelector('img')!.getAttribute('src')).toBe(PICTURE)

    const recap = document.createElement('div')
    document.body.append(recap)
    const unmountRecap = api.mount(recap, { kind: 'card', from: 590, to: 650, peak: 600 })
    expect(images.at(-1)!.getAttribute('src')).toContain('stream=319006602597&t=600&')
    unmountRecap()
    unmountCard()
    expect(card.childElementCount).toBe(0)
  })

  it('asks nothing from the backend without a stream id', () => {
    const { host } = thumbHost()
    const unmount = api.mount(host, { kind: 'thumb', from: 0, to: 60, peak: 30 }, { api: 'https://api.streampulse.stream', key: null })
    expect(images.some(image => image.getAttribute('src')?.includes('/moments/picture'))).toBe(false)
    expect(host.hasAttribute('data-has')).toBe(false)
    unmount()
  })

  it('takes the picture down when Moment pictures is turned off, asks nothing while off, and puts it back when turned on', () => {
    const { host } = thumbHost()
    const unmount = api.mount(host, THUMB, AT)
    requested()!.dispatchEvent(new Event('load'))
    expect(host.querySelector('img')).not.toBeNull()
    setPictures(false)
    expect(host.querySelector('img')).toBeNull()
    expect(host.hasAttribute('data-has')).toBe(false)

    const { host: offHost } = thumbHost()
    const before = images.length
    const unmountOff = api.mount(offHost, THUMB, AT)
    expect(images.slice(before).some(image => image.getAttribute('src') === PICTURE)).toBe(false)

    setPictures(true)
    expect(host.querySelector('img')!.getAttribute('src')).toBe(PICTURE)
    expect(offHost.querySelector('img')).toBeNull()
    requested()!.dispatchEvent(new Event('load'))
    expect(offHost.querySelector('img')!.getAttribute('src')).toBe(PICTURE)
    unmountOff()
    unmount()
  })
})
