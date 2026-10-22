import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  MOMENT_FRAMES_READY_EVENT,
  MOMENT_PICTURE_WANTS,
  type MomentFrameSource,
  type MomentFramesApi,
  type MomentPictureAt,
  type MomentPictureView,
  type MomentPictureWant,
} from '../shared/momentFramesContract.ts'
import { vodTile, type VodPictures } from '../shared/vodPictures.ts'
import type { VodFrame } from '../background/vodFrameInject.ts'
import { MomentFrameStore, nearestFrameIndex, type StoredFrame } from './momentFrameStore.ts'
import { MOMENT_FRAMES_CSS } from './momentFramesStyles.ts'

/**
 * Entry of `content/moment-frames.js`, injected by the worker into a Twitch tab
 * that shows Pulse (src/background/momentFramesScript.ts), so it never counts
 * against the content script's size budget.
 *
 * It keeps a 320 px JPEG of the player every few seconds, drawn from Twitch's
 * own <video> into a canvas (no permission, and Twitch's media is same-origin
 * to the page). Frames live in this tab's memory: nothing is uploaded, and
 * turning "Moment pictures" off in Settings drops them at once. When a moment
 * is saved or watched from here, the worker asks for its one frame and keeps
 * it on this device with the save (src/background/momentPictures.ts).
 * A moment card, and the top three Top Moments rows, that this tab holds no
 * frame of first show the exact frame of the moment's second, read from the
 * VOD's own video in this tab (src/background/vodFrameInject.ts), which works
 * while Twitch is still recording the VOD. Those frames are this tab's object
 * URLs only: never stored, uploaded, or given to a save. Otherwise a moment
 * this tab holds no frame of shows Twitch's own VOD tile of it (the
 * scrub sheets Twitch's player shows, src/shared/vodPictures.ts), else the
 * backend's picture of it (GET /v1/analytics/moments/picture: a Twitch clip or
 * VOD preview of that second), else, in a moment card, the game's box art or
 * chat's top emote; local frames win once the tab has them. The old view stays
 * until a picture has loaded, and stays for good if none does, except that a
 * card shows its art or emote at once, so it opens at its full height. In the
 * moment card the picture is the card's top, edge to edge and fading into the
 * card, with the card's time, game and close button laid over it.
 * While Twitch shows an ad the player is skipped, so an ad never becomes a
 * moment's picture.
 */

const CAPTURE_EVERY_MS = 4_000
const FRAME_WIDTH = 320
const FLIP_EVERY_MS = 450
const PICTURES_KEY = 'momentPicturesEnabled'

const store = new MomentFrameStore({
  windowMs: 6 * 60_000,
  maxKept: 240,
  minGapSeconds: 3,
  revoke: url => URL.revokeObjectURL(url),
  now: () => Date.now(),
})

let enabled = true
/** Mounted views' renders, rerun when Moment pictures is switched (a backend picture isn't in the store). */
const views = new Set<() => void>()
/** Panels asking for frames; the newest one's player is the one kept. */
const sources: MomentFrameSource[] = []
let timer: number | undefined

/** Twitch's ad markers: the "Ad" label and countdown over the player. */
const AD_MARKERS = [
  '[data-a-target="video-ad-label"]',
  '[data-a-target="video-ad-countdown"]',
  '[data-test-selector="ad-banner-default-text"]',
].join(',')
/**
 * Twitch's ad overlay. The player always carries an empty one, ad or not, so it
 * only counts as an ad once something is drawn inside it.
 */
const AD_OVERLAY = '[data-a-target="ax-overlay"]'

export function adShowing(root: ParentNode = document): boolean {
  if (root.querySelector(AD_MARKERS) != null) return true
  for (const overlay of root.querySelectorAll(AD_OVERLAY)) {
    if (overlay.childElementCount > 0) return true
  }
  return false
}

const canvas = document.createElement('canvas')
let busy = false

function tick(): void {
  const source = sources[sources.length - 1]
  const context = canvas.getContext('2d')
  if (!source || !enabled || !context || busy || document.hidden || adShowing()) return
  const video = source.video()
  if (!video || video.paused || video.seeking || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
  const offset = source.offset(video)
  if (offset == null || !Number.isFinite(offset) || offset < 0 || store.has(offset)) return
  canvas.width = FRAME_WIDTH
  canvas.height = Math.round((FRAME_WIDTH * video.videoHeight) / video.videoWidth)
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
  } catch {
    return
  }
  busy = true
  canvas.toBlob(blob => {
    busy = false
    // A stream switch while encoding leaves this frame behind.
    if (blob && enabled && sources[sources.length - 1]?.key === source.key) store.add(Math.round(offset), URL.createObjectURL(blob))
  }, 'image/jpeg', 0.72)
}

function start(source: MomentFrameSource): () => void {
  sources.push(source)
  store.useStream(source.key)
  timer ??= window.setInterval(tick, CAPTURE_EVERY_MS)
  return () => {
    const index = sources.indexOf(source)
    if (index >= 0) sources.splice(index, 1)
    if (sources.length > 0) store.useStream(sources[sources.length - 1]!.key)
    else {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}


const styledRoots = new WeakSet<Node>()

function addStyles(element: HTMLElement): void {
  const root = element.getRootNode()
  if (styledRoots.has(root)) return
  styledRoots.add(root)
  const style = document.createElement('style')
  style.textContent = MOMENT_FRAMES_CSS
  ;(root instanceof ShadowRoot ? root : document.head).append(style)
}

/** A list shows thumbnails only once one of its moments has a picture. */
function markList(list: Element | null): void {
  list?.toggleAttribute('data-pmf-pictures', list.querySelector('.pmf-thumb[data-has]') != null)
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

/** The last stream a mount named, for a mount that names none. */
let lastAt: MomentPictureAt | undefined

/** The backend's JPEG of stream second `t`, or null without a stream id. */
export function remoteUrl(at: MomentPictureAt | undefined, t: number): string | null {
  if (!at?.api || !at.key) return null
  const query = new URLSearchParams({ stream: at.key, t: String(Math.max(0, Math.round(t))) })
  if (at.login) query.set('login', at.login)
  if (at.vodId) query.set('vod', at.vodId)
  return `${at.api.replace(/\/+$/, '')}/v1/analytics/moments/picture?${query}`
}

/** Twitch's pictures of each VOD this tab asked about, asked once per VOD. */
const vods = new Map<string, Promise<VodPictures | null>>()

function vod(at?: MomentPictureAt): Promise<VodPictures | null> {
  const id = (at ?? lastAt)?.vodId
  if (!id) return Promise.resolve(null)
  let found = vods.get(id)
  if (!found) {
    found = Promise.resolve()
      .then(() => chrome.runtime.sendMessage({ type: 'MOMENT_PICTURE', action: 'vod', vodId: id }))
      .then(response => (response as { vod?: VodPictures | null } | undefined)?.vod ?? null, () => null)
    vods.set(id, found)
  }
  return found
}

/** Most exact frames a tab keeps; the oldest goes first. */
const MAX_EXACT_FRAMES = 24

/**
 * Exact frames of seconds of `exactVod`, the VOD this tab last asked about, as
 * object URLs: one ask per second and size, and a failed ask is asked again
 * next time. Another VOD's ask, switching Moment pictures off, or a minute
 * with no picture mounted releases them.
 */
const exactFrames = new Map<string, Promise<string | null>>()
let exactVod: string | undefined
let exactRelease: number | undefined

function releaseExactFrames(): void {
  for (const found of exactFrames.values()) void found.then(url => url && URL.revokeObjectURL(url))
  exactFrames.clear()
}

function vodFrame(at: MomentPictureAt | undefined, seconds: number, height: 160 | 360): Promise<string | null> {
  const id = (at ?? lastAt)?.vodId
  if (!id || !enabled || !(seconds >= 0)) return Promise.resolve(null)
  if (id !== exactVod) {
    releaseExactFrames()
    exactVod = id
  }
  const second = Math.round(seconds)
  const key = `${second} ${height}`
  let found = exactFrames.get(key)
  if (!found) {
    const asked: Promise<string | null> = Promise.resolve()
      .then(() => chrome.runtime.sendMessage({ type: 'MOMENT_PICTURE', action: 'vodFrame', vodId: id, seconds: second, height }))
      .then(response => {
        const frame = (response as { frame?: VodFrame | { error: string } | null } | undefined)?.frame
        // Released or replaced while Twitch was asked: nothing to keep.
        if (!frame || !('image' in frame) || exactFrames.get(key) !== asked) return null
        const binary = atob(frame.image.slice(frame.image.indexOf(',') + 1))
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
      }, () => null)
    void asked.then(url => {
      if (!url && exactFrames.get(key) === asked) exactFrames.delete(key)
    })
    exactFrames.set(key, asked)
    for (const [old, kept] of exactFrames) {
      if (exactFrames.size <= MAX_EXACT_FRAMES) break
      exactFrames.delete(old)
      void kept.then(url => url && URL.revokeObjectURL(url))
    }
    found = asked
  }
  return found
}

/** An image of `url` once it has loaded, or null when it fails; one that fails never shows. */
function loaded(url: string): Promise<HTMLImageElement | null> {
  const image = element('img')
  image.alt = ''
  image.decoding = 'async'
  image.referrerPolicy = 'no-referrer'
  return new Promise(resolve => {
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

const cssUrl = (url: string): string => `url(${JSON.stringify(url)})`

function mount(host: HTMLElement, view: MomentPictureView, at?: MomentPictureAt): () => void {
  addStyles(host)
  at = lastAt = at ?? lastAt
  const card = view.kind === 'card'
  let gone = false

  /** A picture not from this tab: as is in a row, or with its source on it in a card. */
  const framed = (source: string, dot: string, ...parts: HTMLElement[]): HTMLElement => {
    if (!card) return parts[0]!
    const picture = element('div', 'pmf-pic')
    picture.style.cursor = 'default'
    picture.setAttribute('role', 'img')
    picture.setAttribute('aria-label', `Picture at ${formatHeatOffset(view.peak)}: ${source}`)
    const chip = element('span', 'pmf-chip')
    chip.textContent = source
    chip.style.setProperty('--pmf-dot', dot)
    picture.append(...parts, chip)
    return picture
  }

  /** A card's stand-ins, each built once: the game's box art, and chat's top emote. */
  let art: HTMLElement | null | undefined
  let emote: HTMLElement | null | undefined
  const artStandIn = (): HTMLElement | null => {
    if (art === undefined) {
      const blur = element('span', 'pmf-art')
      const box = element('span', 'pmf-box')
      if (view.art) blur.style.backgroundImage = box.style.backgroundImage = cssUrl(view.art)
      art = card && view.art ? framed('No VOD · game art', '#a1a1b2', blur, box) : null
    }
    return art
  }
  const emoteStandIn = (): HTMLElement | null => {
    if (emote === undefined) {
      const big = element('img', 'pmf-big')
      big.alt = ''
      big.decoding = 'async'
      big.referrerPolicy = 'no-referrer'
      if (view.emote) big.src = view.emote
      emote = card && view.emote ? framed('No VOD · chat’s top emote', '#fbbf24', element('span', 'pmf-glow'), big) : null
    }
    return emote
  }

  /**
   * What a moment this tab holds no frames of shows, looked for once needed:
   * Twitch's VOD tile of it, else the backend's picture, else, in a card, the
   * game's box art or chat's top emote. Null when there is none.
   */
  const findOther = async (): Promise<HTMLElement | null> => {
    const asked = vod(at)
    // A card, or a row that asks, first tries the exact frame from the VOD's own video.
    if (card || view.exact) {
      const url = await vodFrame(at, view.peak - (at?.vodOriginDeltaSeconds ?? 0), card ? 360 : 160)
      const exact = url ? await loaded(url) : null
      if (exact) return framed('Twitch VOD frame', '#22d3ee', exact)
    }
    const pictures = await asked
    const tile = pictures && vodTile(pictures, view.peak - (at?.vodOriginDeltaSeconds ?? 0))
    const sheet = tile && await loaded(tile.sheet)
    if (pictures && tile && sheet) {
      // The whole sheet, scaled so one tile fills the frame and moved to show it.
      Object.assign(sheet.style, {
        width: `${pictures.cols * 100}%`,
        height: `${pictures.rows * 100}%`,
        maxWidth: 'none',
        objectFit: 'fill',
        transform: `translate(${(-100 * tile.col) / pictures.cols}%, ${(-100 * tile.row) / pictures.rows}%)`,
      })
      const crop = element('span', 'pmf-tile')
      crop.append(sheet)
      return framed('Twitch VOD preview', '#38bdf8', crop)
    }
    const remote = remoteUrl(at, view.peak)
    const image = remote ? await loaded(remote) : null
    if (image) return framed('Twitch preview', '#38bdf8', image)
    if (!card) return null
    if (view.art && await loaded(view.art)) return artStandIn()
    if (view.emote && await loaded(view.emote)) return emoteStandIn()
    return null
  }
  /** Undefined until looked for (only once the moment turns out to have no frames). */
  let other: HTMLElement | null | undefined
  let looking = false

  const list = view.kind === 'thumb' ? host.closest('[data-pmf-list]') : null
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  let frames: StoredFrame[] = []
  let signature: string | null = null
  let peak = -1
  let shown = -1
  let flip: number | undefined
  const image = element('img')
  image.alt = ''
  image.decoding = 'async'

  // Card parts, built when the card first has frames.
  let figure: HTMLElement | undefined
  let time: HTMLElement | undefined
  let badge: HTMLElement | undefined
  let rail: HTMLElement | undefined

  const show = (index: number): void => {
    const frame = frames[index]
    if (!frame) return
    shown = index
    image.src = frame.url
    if (!figure) return
    time!.textContent = formatHeatOffset(frame.offset)
    badge!.hidden = index !== peak
    figure.setAttribute('aria-label', `Picture at ${formatHeatOffset(frame.offset)}, captured while you watched. Use the arrow keys or move across it to see the seconds around it.`)
    rail!.childNodes.forEach((tick, tickIndex) => (tick as HTMLElement).toggleAttribute('data-on', tickIndex === index))
  }

  const scrubTo = (event: PointerEvent): void => {
    const box = figure!.getBoundingClientRect()
    const share = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width))
    show(Math.floor(share * frames.length))
  }

  const buildCard = (): void => {
    figure = element('div', 'pmf-pic')
    figure.tabIndex = 0
    figure.setAttribute('role', 'img')
    const chip = element('span', 'pmf-chip')
    chip.textContent = 'Captured while you watched'
    time = element('span', 'pmf-time')
    badge = element('span', 'pmf-peak')
    badge.textContent = 'PEAK'
    figure.append(image, chip, time, badge)
    rail = element('div', 'pmf-rail')
    rail.setAttribute('aria-hidden', 'true')
    figure.addEventListener('pointermove', scrubTo)
    figure.addEventListener('pointerdown', scrubTo)
    figure.addEventListener('pointerleave', () => show(peak))
    figure.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      event.preventDefault()
      show(Math.min(frames.length - 1, Math.max(0, shown + step)))
    })
  }

  const stopFlip = (): void => {
    window.clearInterval(flip)
    flip = undefined
  }
  const row = view.kind === 'thumb' ? host.closest('button') ?? host : null
  const startFlip = (): void => {
    if (reduceMotion || frames.length < 2 || flip !== undefined) return
    flip = window.setInterval(() => show((shown + 1) % frames.length), FLIP_EVERY_MS)
  }
  const endFlip = (): void => {
    stopFlip()
    show(peak)
  }
  row?.addEventListener('pointerenter', startFlip)
  row?.addEventListener('pointerleave', endFlip)

  const render = (): void => {
    const next = enabled ? store.inRange(view.from, view.to) : []
    // With `enabled`, so turning pictures off also takes down a picture from elsewhere.
    const nextSignature = `${enabled} ${other === undefined} ${next.map(frame => frame.url).join(' ')}`
    if (nextSignature === signature) return
    signature = nextSignature
    frames = next
    peak = nearestFrameIndex(frames, view.peak)
    if (frames.length === 0) {
      stopFlip()
      if (enabled && other === undefined && !looking) {
        looking = true
        void findOther().catch(() => null).then(found => {
          other = found
          if (!gone) render()
        })
      }
      // While still looking, a card shows its stand-in, so it opens at its
      // full height and a VOD tile takes the stand-in's place; anything else
      // stays as it was, so nothing opens and collapses.
      const early = enabled && other === undefined && looking
      if (early && !(card && (artStandIn() ?? emoteStandIn()))) return
      const picture = early ? artStandIn() ?? emoteStandIn() : enabled ? other : null
      if (card) host.toggleAttribute('data-top', picture != null)
      else {
        host.toggleAttribute('data-has', picture != null)
        host.title = picture ? '' : 'No picture: Pulse only keeps frames from while this tab was playing'
      }
      if (host.childNodes.length !== 1 || host.firstChild !== picture) host.replaceChildren(...(picture ? [picture] : []))
      markList(list)
      return
    }
    if (card) {
      if (!figure) buildCard()
      rail!.replaceChildren(...frames.map((_, index) => {
        const tick = element('i')
        tick.toggleAttribute('data-peak', index === peak)
        return tick
      }))
      host.toggleAttribute('data-top', true)
      host.replaceChildren(figure!, rail!)
    } else {
      host.toggleAttribute('data-has', true)
      host.title = ''
      host.replaceChildren(image)
      markList(list)
    }
    show(peak)
  }

  render()
  const unsubscribe = store.subscribe(render)
  views.add(render)
  window.clearTimeout(exactRelease)
  return () => {
    gone = true
    unsubscribe()
    views.delete(render)
    if (views.size === 0) exactRelease = window.setTimeout(releaseExactFrames, 60_000)
    stopFlip()
    row?.removeEventListener('pointerenter', startFlip)
    row?.removeEventListener('pointerleave', endFlip)
    host.removeAttribute('data-has')
    host.removeAttribute('data-top')
    host.replaceChildren()
    markList(list)
  }
}

/** Frames the worker asked for: one each, the one nearest the moment, sent once it is held. */
let wants: MomentPictureWant[] = []
const sending = new Set<string>()

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function serveWants(): void {
  wants = wants.filter(want => want.until > Date.now())
  const key = sources[sources.length - 1]?.key
  for (const want of wants) {
    if (!enabled || sending.has(want.token) || (want.stream && want.stream !== key)) continue
    const frames = store.inRange(want.from, want.to)
    const frame = frames[nearestFrameIndex(frames, want.peak)]
    if (!frame) continue
    sending.add(want.token)
    void fetch(frame.url).then(response => response.blob()).then(dataUrl)
      .then(image => chrome.runtime.sendMessage({ type: 'MOMENT_PICTURE', action: 'frame', token: want.token, image, offset: frame.offset }))
      .then(() => { wants = wants.filter(other => other.token !== want.token) })
      .catch(() => undefined)
      .finally(() => sending.delete(want.token))
  }
}

function takeWants(list: unknown): void {
  if (!Array.isArray(list)) return
  wants = list.filter((want): want is MomentPictureWant => typeof want?.token === 'string'
    && [want.from, want.to, want.peak, want.until].every(Number.isFinite))
  serveWants()
}

const api: MomentFramesApi = {
  start,
  keep: spans => store.keep(spans),
  mount,
  vod,
}

if (!globalThis.__pulseMomentFrames) {
  globalThis.__pulseMomentFrames = api
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'sync' || !(PICTURES_KEY in changes)) return
    enabled = changes[PICTURES_KEY]!.newValue !== false
    if (!enabled) {
      store.clear()
      releaseExactFrames()
    }
    for (const render of views) render()
  })
  chrome.runtime?.onMessage?.addListener(message => {
    if (message?.type === MOMENT_PICTURE_WANTS) takeWants(message.wants)
  })
  store.subscribe(serveWants)
  // A save made before this script arrived may already be waiting.
  void chrome.runtime?.sendMessage({ type: 'MOMENT_PICTURE', action: 'wants' }).then(response => takeWants(response?.wants)).catch(() => undefined)
}
window.dispatchEvent(new Event(MOMENT_FRAMES_READY_EVENT))
