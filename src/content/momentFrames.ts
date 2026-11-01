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
 * chat's top emote, whose chip says why there is no VOD tile (no VOD, or one
 * Twitch is still recording); local frames win once the tab has them. The old
 * view stays until a picture has loaded, and stays for good if none does,
 * except that a card shows its art or emote at once, so it opens at its full
 * height. In the moment card the picture is the card's top, edge to edge and
 * fading into the card, with the card's time, game and close button laid over
 * it.
 * While Twitch shows an ad the player is skipped, so an ad never becomes a
 * moment's picture.
 */

const CAPTURE_EVERY_MS = 4_000
const FRAME_WIDTH = 320
const FLIP_EVERY_MS = 450
const PICTURES_KEY = 'momentPicturesEnabled'

// A visible card may outlive the rolling store. Keep only its resting and
// chosen frames usable until the last card releases them.
const frameUsers = new Map<string, number>()
const retiredFrames = new Set<string>()
let streamKey: string | undefined

function releaseFrame(url: string): void {
  const remaining = (frameUsers.get(url) ?? 0) - 1
  if (remaining > 0) frameUsers.set(url, remaining)
  else {
    frameUsers.delete(url)
    if (retiredFrames.delete(url)) URL.revokeObjectURL(url)
  }
}

const store = new MomentFrameStore({
  windowMs: 6 * 60_000,
  maxKept: 240,
  minGapSeconds: 3,
  revoke: url => {
    if (frameUsers.has(url)) retiredFrames.add(url)
    else URL.revokeObjectURL(url)
  },
  now: () => Date.now(),
})

let enabled = true
/** Mounted views' renders, rerun when Moment pictures is switched (a backend picture isn't in the store). */
const views = new Set<() => void>()
/** Panels asking for frames; the newest one's player is the one kept. */
const sources: MomentFrameSource[] = []
let timer: number | undefined

function useStream(key: string): void {
  if (key === streamKey) return
  streamKey = key
  store.useStream(key)
  // The store emits nothing if its final frame already expired.
  views.forEach(render => render())
}

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
  useStream(source.key)
  timer ??= window.setInterval(tick, CAPTURE_EVERY_MS)
  return () => {
    const index = sources.indexOf(source)
    if (index >= 0) sources.splice(index, 1)
    if (sources.length > 0) useStream(sources[sources.length - 1]!.key)
    else {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}

// A card's picture top is 9/16 of the card's width less its 2 px border, and
// the card's text overlaps 38 px of it (56 px under a game line). Top Moments'
// reserve (data-moment-reserve) grows by the rest, as padding outside its
// min-height that follows the card's width, so its cards still all open to
// one height.
const CSS = `
.pmf-thumb{display:none;position:relative;flex:none;align-self:center;width:48px;height:27px;border-radius:4px;overflow:hidden;background:repeating-linear-gradient(135deg,rgba(255,255,255,.07) 0 3px,rgba(255,255,255,.02) 3px 7px)}
[data-pmf-pictures] .pmf-thumb{display:block!important}
.pmf-thumb[data-has]{background:#000}
.pmf-thumb img,.pmf-pic img{display:block;width:100%;height:100%;object-fit:cover}
.pmf-stage:not(:empty){margin:0 0 9px}
.pmf-pic{position:relative;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:#000;cursor:ew-resize;outline:none;touch-action:pan-y;user-select:none}
.pmf-pic:focus-visible{box-shadow:0 0 0 2px rgba(var(--pulse-accent-light-rgb,167,139,250),.85)}
.pmf-chip{position:absolute;left:6px;top:6px;display:flex;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font-size:9.5px;font-weight:700;line-height:1}
.pmf-chip::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--pmf-dot,#34d399)}
.pmf-time{position:absolute;left:7px;bottom:6px;color:#fff;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px #000}
.pmf-peak{position:absolute;right:6px;bottom:6px;padding:2px 6px;border-radius:4px;background:#f43f5e;color:#fff;font-size:9px;font-weight:900;letter-spacing:.04em}
.pmf-peak[hidden]{display:none}
.pmf-rail{display:flex;gap:2px;margin:4px 0 0}
.pmf-rail i{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.14)}
.pmf-rail i[data-peak]{background:rgba(244,63,94,.6)}
.pmf-rail i[data-on]{background:rgba(var(--pulse-accent-light-rgb,167,139,250),.95)}
.pmf-tile{position:absolute;inset:0;overflow:hidden}
.pmf-art{position:absolute;inset:-20px;background:center/cover;filter:blur(14px) saturate(1.2) brightness(.55)}
.pmf-box{position:absolute;top:14px;left:50%;width:60px;aspect-ratio:3/4;transform:translateX(-50%);border-radius:5px;background:center/cover;box-shadow:0 8px 20px rgba(0,0,0,.6)}
.pmf-glow{position:absolute;inset:0;background:radial-gradient(60% 70% at 50% 40%,rgba(139,92,246,.35),transparent 72%),#15121f}
.pmf-pic .pmf-big{position:absolute;top:18%;left:50%;width:64px;height:64px;transform:translateX(-50%);object-fit:contain;filter:drop-shadow(0 6px 16px rgba(0,0,0,.6))}
.pmf-stage[data-top]{position:relative;margin:-10px -12px -28px;border-radius:7px 7px 0 0;overflow:hidden}
.pulse-sel>div:has(>.pulse-sel-game)>.pmf-stage[data-top]{margin-bottom:-46px}
.pmf-stage[data-top] .pmf-pic{border-radius:0;-webkit-mask-image:linear-gradient(#000 40%,transparent);mask-image:linear-gradient(#000 40%,transparent)}
.pmf-stage[data-top]>.pmf-rail{position:absolute;top:4px;left:8px;right:38px;margin:0}
.pmf-stage[data-top] .pmf-chip{top:10px;left:8px}
.pmf-stage[data-top] :is(.pmf-time,.pmf-peak){top:10px;bottom:auto;left:auto;right:38px}
.pmf-stage[data-top] .pmf-time:has(~.pmf-peak:not([hidden])){display:none}
.pulse-sel>div:has(>.pmf-stage[data-top]){position:relative;display:flex;flex-direction:column}
.pulse-sel>div:has(>.pmf-stage[data-top])>*{order:2}
.pulse-sel>div:has(>.pmf-stage[data-top])>:is(.pmf-stage,.pulse-sel-header){order:0}
.pulse-sel>div:has(>.pmf-stage[data-top])>.pulse-sel-game{order:1;z-index:1;margin-top:1px;color:#d4d4de;text-shadow:0 1px 2px #000}
.pmf-stage[data-top]~.pulse-sel-header{z-index:1}
.pmf-stage[data-top]~.pulse-sel-header .pulse-sel-kicker{color:#c9c9d6;text-shadow:0 1px 2px #000}
.pmf-stage[data-top]~.pulse-sel-header .pulse-sel-offset{font-size:17px;text-shadow:0 1px 3px #000}
.pmf-stage[data-top]~.pulse-sel-header .pulse-sel-close{position:absolute;top:-3px;right:-4px;display:grid;place-items:center;width:22px;height:22px;margin:0;padding:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff}
[data-moment-reserve]:has(>.pulse-sel>div>.pmf-stage[data-top]){box-sizing:content-box;padding-top:calc(56.25% - 39px)}
[data-moment-reserve]>.pulse-sel:has(>div>.pmf-stage[data-top]){margin-top:calc(39px - 56.25%)}
[data-moment-reserve=games]:has(>.pulse-sel>div>.pmf-stage[data-top]){padding-top:calc(56.25% - 57px)}
[data-moment-reserve=games]>.pulse-sel:has(>div>.pmf-stage[data-top]){margin-top:calc(57px - 56.25%)}
`

const styledRoots = new WeakSet<Node>()

function addStyles(element: HTMLElement): void {
  const root = element.getRootNode()
  if (styledRoots.has(root)) return
  styledRoots.add(root)
  const style = document.createElement('style')
  style.textContent = CSS
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

/** How long an answer without scrub sheets stands before Twitch is asked again. */
const VOD_RETRY_MS = 2 * 60_000

/**
 * Twitch's pictures of each VOD this tab asked about. A VOD with scrub sheets
 * is asked about once; one without (still recording, or not found) again after
 * VOD_RETRY_MS, so its sheets show once the stream has ended.
 */
const vods = new Map<string, { found: Promise<VodPictures | null>; until: number }>()
/** VODs Twitch last said it is still recording. */
const recording = new Set<string>()

function vod(at?: MomentPictureAt): Promise<VodPictures | null> {
  const id = (at ?? lastAt)?.vodId
  if (!id) return Promise.resolve(null)
  const kept = vods.get(id)
  if (kept && kept.until > Date.now()) return kept.found
  const asked = { found: Promise.resolve<VodPictures | null>(null), until: Infinity }
  asked.found = Promise.resolve()
    .then(() => chrome.runtime.sendMessage({ type: 'MOMENT_PICTURE', action: 'vod', vodId: id }))
    .then(response => (response as { vod?: VodPictures | null } | undefined)?.vod ?? null, () => null)
    .then(pictures => {
      if (!pictures?.sheets.length) asked.until = Date.now() + VOD_RETRY_MS
      if (pictures?.recording) recording.add(id)
      else recording.delete(id)
      return pictures
    })
  vods.set(id, asked)
  return asked.found
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
/** Ordinary rows reuse a frame a card already asked for; they never start a frame request. */
const exactRows = new Set<(vodId?: string, second?: number) => void>()
let exactVod: string | undefined
let exactRelease: number | undefined

function releaseExactFrames(): void {
  for (const found of exactFrames.values()) void found.then(url => url && URL.revokeObjectURL(url))
  exactFrames.clear()
  for (const update of exactRows) update()
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
      if (exactFrames.get(key) !== asked) return
      if (!url) exactFrames.delete(key)
      // A failed larger ask may leave a usable smaller frame for the same second.
      for (const update of exactRows) update(id, second)
    })
    exactFrames.set(key, asked)
    for (const [old, kept] of exactFrames) {
      if (exactFrames.size <= MAX_EXACT_FRAMES) break
      exactFrames.delete(old)
      void kept.then(url => url && URL.revokeObjectURL(url))
      for (const update of exactRows) update(id, Number(old.split(' ')[0]))
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

/**
 * A row's picture its last mount left up for the next mount of the same box:
 * which moment it shows, its frame image, and how to take it down. Only a
 * mount of that moment keeps it; any other takes it down first.
 */
const handoffs = new WeakMap<HTMLElement, { id: string; image: HTMLImageElement; blank: () => void }>()

function mount(host: HTMLElement, view: MomentPictureView, at?: MomentPictureAt): () => void {
  addStyles(host)
  at = lastAt = at ?? lastAt
  const card = view.kind === 'card'
  let gone = false
  // The same moment of the same stream, at the same alignment: a VOD id
  // arriving or a move in or out of the top 3 keeps the box's picture.
  const id = `${at?.key} ${at?.vodOriginDeltaSeconds ?? 0} ${view.kind} ${view.from} ${view.to} ${view.peak}`
  const handed = handoffs.get(host)
  handoffs.delete(host)
  if (handed && handed.id !== id) handed.blank()

  /** Puts `source` on a card's picture: its chip, and what a screen reader hears. */
  const name = (picture: HTMLElement, source: string): void => {
    picture.setAttribute('aria-label', `Picture at ${formatHeatOffset(view.peak)}: ${source}`)
    picture.querySelector('.pmf-chip')!.textContent = source
  }

  /** A picture not from this tab: as is in a row, or with its source on it in a card. */
  const framed = (source: string, dot: string, ...parts: HTMLElement[]): HTMLElement => {
    if (!card) return parts[0]!
    const picture = element('div', 'pmf-pic')
    picture.style.cursor = 'default'
    picture.setAttribute('role', 'img')
    const chip = element('span', 'pmf-chip')
    chip.style.setProperty('--pmf-dot', dot)
    picture.append(...parts, chip)
    name(picture, source)
    return picture
  }

  /** A stand-in's chip: why there is no VOD tile, then what it shows instead. */
  const standIn = (what: string): string => `${at?.vodId && recording.has(at.vodId) ? 'VOD still recording' : 'No VOD'} · ${what}`

  /** A card's stand-ins, each built once: the game's box art, and chat's top emote. */
  let art: HTMLElement | null | undefined
  let emote: HTMLElement | null | undefined
  const artStandIn = (): HTMLElement | null => {
    if (art === undefined) {
      const blur = element('span', 'pmf-art')
      const box = element('span', 'pmf-box')
      if (view.art) blur.style.backgroundImage = box.style.backgroundImage = cssUrl(view.art)
      art = card && view.art ? framed(standIn('game art'), '#a1a1b2', blur, box) : null
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
      emote = card && view.emote ? framed(standIn('chat’s top emote'), '#fbbf24', element('span', 'pmf-glow'), big) : null
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
    // The stand-in shown while looking learns whether Twitch is still recording the VOD as soon as Twitch answers.
    void asked.then(() => {
      if (art) name(art, standIn('game art'))
      if (emote) name(emote, standIn('chat’s top emote'))
    })
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
  let sharedFrame: Promise<string | null> | undefined
  let sharedPicture: HTMLImageElement | null = null
  let sharedVersion = 0

  const list = view.kind === 'thumb' ? host.closest('[data-pmf-list]') : null
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  let frames: StoredFrame[] = []
  let signature: string | null = null
  let peak = -1
  let shown = -1
  let flip: number | undefined
  let pictureStream = streamKey
  let pinnedPeak: StoredFrame | undefined
  let chosen: StoredFrame | undefined
  let held = new Set<StoredFrame>()
  // The frame image left up for this moment stays the one on screen.
  const image = handed?.id === id ? handed.image : element('img')
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
    if (card) {
      chosen = frame
      const nextHeld = new Set([pinnedPeak!, frame])
      for (const next of nextHeld) if (!held.has(next)) frameUsers.set(next.url, (frameUsers.get(next.url) ?? 0) + 1)
      for (const previous of held) if (!nextHeld.has(previous)) releaseFrame(previous.url)
      held = nextHeld
    }
    if (image.getAttribute('src') !== frame.url) image.src = frame.url
    if (!figure) return
    time!.textContent = formatHeatOffset(frame.offset)
    badge!.hidden = index !== peak
    figure.setAttribute('aria-label', `Picture at ${formatHeatOffset(frame.offset)}, captured while you watched. Use the arrow keys or move across it to see the seconds around it.`)
    rail!.childNodes.forEach((tick, tickIndex) => (tick as HTMLElement).toggleAttribute('data-on', tickIndex === index))
  }

  const choose = (index: number): void => {
    show(index)
    // A released, evicted frame must also leave the scrub choices.
    render()
  }

  const scrubTo = (event: PointerEvent): void => {
    const box = figure!.getBoundingClientRect()
    const share = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width))
    choose(Math.floor(share * frames.length))
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
    figure.addEventListener('pointerleave', () => choose(peak))
    figure.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      event.preventDefault()
      choose(Math.min(frames.length - 1, Math.max(0, shown + step)))
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
    if (card && (!enabled || pictureStream !== streamKey)) {
      if (held.size > 0) {
        host.replaceChildren()
        host.removeAttribute('data-top')
      }
      for (const frame of held) releaseFrame(frame.url)
      held.clear()
      pinnedPeak = chosen = undefined
      pictureStream = streamKey
      signature = null
    }
    const next = enabled ? store.inRange(view.from, view.to) : []
    if (card && enabled) {
      pinnedPeak ??= next[nearestFrameIndex(next, view.peak)]
      for (const frame of [pinnedPeak, chosen]) if (frame && !next.includes(frame)) next.push(frame)
      next.sort((a, b) => a.offset - b.offset)
    }
    // With `enabled`, so turning pictures off also takes down a picture from elsewhere.
    const nextSignature = `${enabled} ${other === undefined} ${next.map(frame => frame.url).join(' ')}`
    if (nextSignature === signature) return
    signature = nextSignature
    frames = next
    peak = card && pinnedPeak ? frames.indexOf(pinnedPeak) : nearestFrameIndex(frames, view.peak)
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
      const early = enabled && !sharedPicture && other === undefined && looking
      if (early && !(card && (artStandIn() ?? emoteStandIn()))) return
      const picture = early ? artStandIn() ?? emoteStandIn() : enabled ? sharedPicture ?? other : null
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
      // Keep the focused figure attached when a capture extends the rail.
      if (host.firstChild !== figure) host.replaceChildren(figure!, rail!)
    } else {
      host.toggleAttribute('data-has', true)
      host.title = ''
      host.replaceChildren(image)
      markList(list)
    }
    show(card && chosen ? frames.indexOf(chosen) : peak)
  }

  const shareExactFrame = (vodId?: string, second?: number): void => {
    if (vodId && (vodId !== at?.vodId || second !== Math.round(view.peak - (at?.vodOriginDeltaSeconds ?? 0)))) return
    const found = vodId && enabled && exactVod === vodId
      ? exactFrames.get(`${second} 360`) ?? exactFrames.get(`${second} 160`)
      : undefined
    if (found === sharedFrame) return
    const version = ++sharedVersion
    sharedFrame = found
    if (!found) {
      sharedPicture = null
      // An enabled old-VOD view must not restart its lookup on release. While
      // pictures are off, leave an unstarted fallback available for re-enabling.
      if (!vodId && enabled && other === undefined && !looking) other = null
      signature = null
      render()
      return
    }
    void found.then(url => url ? loaded(url) : null).then(picture => {
      if (gone || !enabled || version !== sharedVersion) return
      sharedPicture = picture
      if (!picture) sharedFrame = undefined
      signature = null
      render()
    })
  }
  const sharesExactFrame = !card && !view.exact
  if (sharesExactFrame) {
    exactRows.add(shareExactFrame)
    shareExactFrame(at?.vodId ?? undefined, Math.round(view.peak - (at?.vodOriginDeltaSeconds ?? 0)))
  }
  render()
  const unsubscribe = store.subscribe(render)
  views.add(render)
  window.clearTimeout(exactRelease)
  return () => {
    gone = true
    sharedVersion++
    exactRows.delete(shareExactFrame)
    unsubscribe()
    views.delete(render)
    if (views.size === 0) exactRelease = window.setTimeout(releaseExactFrames, 60_000)
    for (const frame of held) releaseFrame(frame.url)
    held.clear()
    stopFlip()
    row?.removeEventListener('pointerenter', startFlip)
    row?.removeEventListener('pointerleave', endFlip)
    const blank = (): void => {
      host.removeAttribute('data-has')
      host.removeAttribute('data-top')
      host.replaceChildren()
      markList(list)
    }
    if (card) return blank()
    // A row leaves its picture up for a mount that takes the box over in the
    // same render (its VOD id arrived, or it moved in or out of the top 3), so
    // the picture neither blinks nor closes the list's picture column.
    const handoff = { id, image, blank }
    handoffs.set(host, handoff)
    queueMicrotask(() => {
      if (handoffs.get(host) !== handoff) return
      handoffs.delete(host)
      blank()
    })
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
