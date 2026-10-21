// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MomentFramesApi, MomentPictureAt } from '../src/shared/momentFramesContract.ts'
import type { VodPictures } from '../src/shared/vodPictures.ts'

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void

let api: MomentFramesApi
let remoteUrl: (at: MomentPictureAt | undefined, t: number) => string | null
const storageListeners: StorageListener[] = []
/** Every <img> the renderer made; a picture loads detached until it is ready. */
let images: HTMLImageElement[] = []
/** What the worker answers for each VOD the frames script asks about. */
const vodReplies = new Map<string, VodPictures | null>()
const sendMessage = vi.fn(async (message: { action?: string; vodId?: string }) =>
  message.action === 'vod' ? { type: 'MOMENT_PICTURE', vod: vodReplies.get(message.vodId!) ?? null } : {})

const AT: MomentPictureAt = { api: 'https://api.streampulse.stream/', key: '319006602597', login: 'forsen', vodId: '2905053845' }
const PICTURE = 'https://api.streampulse.stream/v1/analytics/moments/picture?stream=319006602597&t=3049&login=forsen&vod=2905053845'
const THUMB = { kind: 'thumb', from: 3019, to: 3109, peak: 3049 } as const
const CARD = { ...THUMB, kind: 'card' } as const
const SHEET = (n: number) => `https://d2nvs31859zcd8.cloudfront.net/abc/storyboards/2905053845-high-${n}.jpg`
const ART = 'https://static-cdn.jtvnw.net/ttv-boxart/33214-144x192.jpg'
const EMOTE = 'https://cdn.7tv.app/emote/01F6MQ33FG000FFJ97ZB8MWV52/2x.webp'

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    storage: { onChanged: { addListener: (listener: StorageListener) => storageListeners.push(listener) } },
    runtime: { onMessage: { addListener: () => undefined }, sendMessage },
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

/** Lets the renderer's lookups (the worker, then each picture) run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** The picture the renderer is loading for `url`, if it asked for one. */
function requested(url = PICTURE): HTMLImageElement | undefined {
  return images.filter(image => image.getAttribute('src') === url).at(-1)
}

async function load(url = PICTURE, event: 'load' | 'error' = 'load'): Promise<void> {
  await settle()
  requested(url)!.dispatchEvent(new Event(event))
  await settle()
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

  it('keeps the old empty thumbnail until the picture loads, then shows it', async () => {
    const { host, list } = thumbHost()
    const unmount = api.mount(host, THUMB, AT)
    await settle()
    const image = requested()!
    expect(image.referrerPolicy).toBe('no-referrer')
    expect(host.querySelector('img')).toBeNull()
    expect(host.hasAttribute('data-has')).toBe(false)
    expect(list.hasAttribute('data-pmf-pictures')).toBe(false)

    await load()
    expect(host.querySelector('img')).toBe(image)
    expect(host.hasAttribute('data-has')).toBe(true)
    expect(host.title).toBe('')
    expect(list.hasAttribute('data-pmf-pictures')).toBe(true)
    unmount()
  })

  it('never shows a picture that fails, so the view never opens and collapses', async () => {
    const { host, list } = thumbHost()
    const unmount = api.mount(host, THUMB, AT)
    await load(PICTURE, 'error')
    expect(host.querySelector('img')).toBeNull()
    expect(host.hasAttribute('data-has')).toBe(false)
    expect(host.title).toMatch(/^No picture/)
    expect(list.hasAttribute('data-pmf-pictures')).toBe(false)
    unmount()

    // A card with nothing to stand in for the moment stays empty: no "No picture" line.
    const card = cardHost()
    const unmountCard = api.mount(card, CARD, AT)
    await load(PICTURE, 'error')
    expect(card.childElementCount).toBe(0)
    expect(card.hasAttribute('data-top')).toBe(false)
    expect(card.textContent).toBe('')
    unmountCard()
  })

  it('shows a loaded picture as the card top, and a mount that names no stream reuses the last one', async () => {
    const card = cardHost()
    const unmountCard = api.mount(card, CARD, AT)
    expect(card.querySelector('.pmf-pic')).toBeNull()
    await load()
    const figure = card.querySelector('.pmf-pic')!
    expect(figure.getAttribute('role')).toBe('img')
    expect(figure.getAttribute('aria-label')).toBe('Picture at 00:50:49: Twitch preview')
    expect(figure.querySelector('img')!.getAttribute('src')).toBe(PICTURE)
    expect(figure.querySelector('.pmf-chip')!.textContent).toBe('Twitch preview')
    expect(card.hasAttribute('data-top')).toBe(true)

    const recap = document.createElement('div')
    document.body.append(recap)
    const unmountRecap = api.mount(recap, { kind: 'card', from: 590, to: 650, peak: 600 })
    await settle()
    expect(images.at(-1)!.getAttribute('src')).toContain('stream=319006602597&t=600&')
    unmountRecap()
    unmountCard()
    expect(card.childElementCount).toBe(0)
    expect(card.hasAttribute('data-top')).toBe(false)
  })

  it('asks nothing from the backend without a stream id', async () => {
    const { host } = thumbHost()
    const unmount = api.mount(host, { kind: 'thumb', from: 0, to: 60, peak: 30 }, { api: 'https://api.streampulse.stream', key: null })
    await settle()
    expect(images.some(image => image.getAttribute('src')?.includes('/moments/picture'))).toBe(false)
    expect(host.hasAttribute('data-has')).toBe(false)
    unmount()
  })

  it('takes the picture down when Moment pictures is turned off, asks nothing while off, and puts it back when turned on', async () => {
    const { host } = thumbHost()
    const unmount = api.mount(host, THUMB, AT)
    await load()
    expect(host.querySelector('img')).not.toBeNull()
    setPictures(false)
    expect(host.querySelector('img')).toBeNull()
    expect(host.hasAttribute('data-has')).toBe(false)

    const { host: offHost } = thumbHost()
    const before = images.length
    const unmountOff = api.mount(offHost, THUMB, AT)
    await settle()
    expect(images.slice(before).some(image => image.getAttribute('src') === PICTURE)).toBe(false)

    setPictures(true)
    expect(host.querySelector('img')!.getAttribute('src')).toBe(PICTURE)
    expect(offHost.querySelector('img')).toBeNull()
    await load()
    expect(offHost.querySelector('img')!.getAttribute('src')).toBe(PICTURE)
    unmountOff()
    unmount()
  })
})

/** Twitch's own pictures of the VOD, and the card's stand-ins (card board, picks 1, 2 and 5). */
describe('Moment pictures from Twitch, and the card stand-ins', () => {
  const VOD_AT: MomentPictureAt = { ...AT, vodId: '2905053846', vodOriginDeltaSeconds: 0 }

  it("shows the VOD's scrub tile of the moment before asking the backend, asking Twitch once per VOD", async () => {
    vodReplies.set('2905053846', { sheets: [1, 2, 3, 4].map(SHEET), cols: 5, rows: 10, count: 200, interval: 30 })
    const card = cardHost()
    const unmountCard = api.mount(card, CARD, VOD_AT)
    const { host } = thumbHost()
    const unmountThumb = api.mount(host, THUMB, VOD_AT)
    // Second 3049 is tile 102: the third sheet, third column of its first row.
    await settle()
    for (const image of images.filter(image => image.getAttribute('src') === SHEET(3))) image.dispatchEvent(new Event('load'))
    await settle()
    expect(sendMessage.mock.calls.filter(([message]) => message.vodId === '2905053846')).toEqual([
      [{ type: 'MOMENT_PICTURE', action: 'vod', vodId: '2905053846' }],
    ])
    const sheet = card.querySelector<HTMLImageElement>('.pmf-tile img')!
    expect(sheet.getAttribute('src')).toBe(SHEET(3))
    expect(sheet.style.width).toBe('500%')
    expect(sheet.style.height).toBe('1000%')
    expect(sheet.style.transform).toBe('translate(-40%, 0%)')
    expect(card.querySelector('.pmf-chip')!.textContent).toBe('Twitch VOD preview')
    expect(card.hasAttribute('data-top')).toBe(true)
    expect(host.querySelector('.pmf-tile img')).not.toBeNull()
    expect(host.hasAttribute('data-has')).toBe(true)
    expect(requested(remoteUrl(VOD_AT, 3049)!)).toBeUndefined()
    unmountThumb()
    unmountCard()
  })

  it('reads VOD seconds from stream seconds by where the VOD starts', async () => {
    vodReplies.set('2905053847', { sheets: [1, 2, 3, 4].map(SHEET), cols: 5, rows: 10, count: 200, interval: 30 })
    const card = cardHost()
    // Stream second 3049 is VOD second 1549: tile 52, the second sheet's third tile.
    const unmount = api.mount(card, CARD, { ...AT, vodId: '2905053847', vodOriginDeltaSeconds: 1500 })
    await load(SHEET(2))
    const sheet = card.querySelector<HTMLImageElement>('.pmf-tile img')!
    expect(sheet.getAttribute('src')).toBe(SHEET(2))
    expect(sheet.style.transform).toBe('translate(-40%, 0%)')
    unmount()
  })

  it('opens a card on its stand-in at once, at its full height, and puts the VOD tile in its place once found', async () => {
    vodReplies.set('2905053848', { sheets: [1, 2, 3, 4].map(SHEET), cols: 5, rows: 10, count: 200, interval: 30 })
    const card = cardHost()
    const unmount = api.mount(card, { ...CARD, art: ART, emote: EMOTE }, { ...AT, vodId: '2905053848' })
    expect(card.hasAttribute('data-top')).toBe(true)
    expect(card.querySelector('.pmf-chip')!.textContent).toBe('No VOD · game art')
    await load(SHEET(3))
    expect(card.hasAttribute('data-top')).toBe(true)
    expect(card.querySelector('.pmf-chip')!.textContent).toBe('Twitch VOD preview')
    expect(card.querySelector('.pmf-art')).toBeNull()
    unmount()
  })

  it('opens a card with no picture on blurred box art, else on the emote, and a row on neither', async () => {
    const noStream: MomentPictureAt = { api: 'https://api.streampulse.stream', key: null }
    const card = cardHost()
    const unmountArt = api.mount(card, { ...CARD, art: ART, emote: EMOTE }, noStream)
    await load(ART)
    expect(card.querySelector<HTMLElement>('.pmf-art')!.style.backgroundImage).toContain(ART)
    expect(card.querySelector<HTMLElement>('.pmf-box')!.style.backgroundImage).toContain(ART)
    expect(card.querySelector('.pmf-chip')!.textContent).toBe('No VOD · game art')
    expect(card.hasAttribute('data-top')).toBe(true)
    unmountArt()

    const unmountEmote = api.mount(card, { ...CARD, art: ART, emote: EMOTE }, noStream)
    await load(ART, 'error')
    await load(EMOTE)
    expect(card.querySelector('img.pmf-big')!.getAttribute('src')).toBe(EMOTE)
    expect(card.querySelector('.pmf-chip')!.textContent).toBe('No VOD · chat’s top emote')
    unmountEmote()

    // Neither loads: the stand-in goes, and the card has no top.
    const unmountNone = api.mount(card, { ...CARD, art: ART, emote: EMOTE }, noStream)
    expect(card.hasAttribute('data-top')).toBe(true)
    await load(ART, 'error')
    await load(EMOTE, 'error')
    expect(card.hasAttribute('data-top')).toBe(false)
    expect(card.childElementCount).toBe(0)
    unmountNone()

    const { host } = thumbHost()
    const before = images.length
    const unmountThumb = api.mount(host, { ...THUMB, art: ART, emote: EMOTE }, noStream)
    await settle()
    expect(images.slice(before).some(image => image.getAttribute('src') === ART)).toBe(false)
    expect(host.hasAttribute('data-has')).toBe(false)
    unmountThumb()
  })
})
