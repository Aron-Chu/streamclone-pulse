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
 * A moment this tab holds no frame of shows Twitch's own VOD tile of it (the
 * scrub sheets Twitch's player shows, src/shared/vodPictures.ts), else the
 * backend's picture of it (GET /v1/analytics/moments/picture: a Twitch clip or
 * VOD preview of that second), else, in a moment card, the game's box art or
 * chat's top emote; local frames win once the tab has them. The old view stays
 * until a picture has loaded, and stays for good if none does. In the moment
 * card the picture is the card's top, edge to edge and fading into the card,
 * with the card's time, game and close button laid over it.
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

  /**
   * What a moment this tab holds no frames of shows, looked for once needed:
   * Twitch's VOD tile of it, else the backend's picture, else, in a card, the
   * game's box art or chat's top emote. Null when there is none.
   */
  const findOther = async (): Promise<HTMLElement | null> => {
    const pictures = await vod(at)
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
    if (view.art && await loaded(view.art)) {
      const blur = element('span', 'pmf-art')
      const box = element('span', 'pmf-box')
      blur.style.backgroundImage = box.style.backgroundImage = cssUrl(view.art)
      return framed('No VOD · game art', '#a1a1b2', blur, box)
    }
    const emote = view.emote ? await loaded(view.emote) : null
    if (!emote) return null
    emote.className = 'pmf-big'
    return framed('No VOD · chat’s top emote', '#fbbf24', element('span', 'pmf-glow'), emote)
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
      // The view stays as it was while still looking, so nothing opens and collapses.
      if (enabled && other === undefined && looking) return
      const picture = enabled ? other : null
      if (card) host.toggleAttribute('data-top', picture != null)
      else {
        host.toggleAttribute('data-has', picture != null)
        host.title = picture ? '' : 'No picture: Pulse only keeps frames from while this tab was playing'
      }
      host.replaceChildren(...(picture ? [picture] : []))
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
  return () => {
    gone = true
    unsubscribe()
    views.delete(render)
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
    if (!enabled) store.clear()
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
