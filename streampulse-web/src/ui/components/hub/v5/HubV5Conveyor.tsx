/**
 * The hero's conveyor (R5-15, Aron's pick from the hero lab, at Soft; mockup
 * d3-v5 hub-hero.js / hub-hero.css): tilted rows of the emotes chat used most
 * slide past behind the title and search, in opposite directions at three
 * speeds, and lean a little with the pointer. Each picture is baked once onto a
 * small canvas, so animated emotes hold their first frame. A mask keeps an oval
 * clear around the title, search and Try row, fades the left and right edges,
 * and fades out before the line under the hero. It fades in once its pictures
 * are drawn, pauses off screen or in a hidden tab, and holds one still frame
 * under reduced motion.
 *
 * S1 (11-19): it was 120 full-size pictures (most of them animated, 7TV at 4x)
 * fetched while the hub first drew, only to be drawn as 32 px stills at a third
 * of their strength. It now asks for the small still (Twitch static, 7TV 2x),
 * at low priority, once the page is idle, and its frame loop stops while it is
 * off screen or the tab is hidden instead of ticking on.
 *
 * An emote the hub flags as animated asks 7TV for its 2x still (_static), the
 * first frame the canvas would have drawn anyway, instead of the moving file;
 * if that still fails to load, it tries the moving file once.
 *
 * The Mix (round 4 hero board, Aron's pick 11-22) adds four things, each from
 * a person or the answer, never a timer:
 * - copies of an emote in a live emote spike draw in full colour, a little
 *   larger (conveyorSpikes); with nothing spiking the belt is as before;
 * - the row under the pointer slows to 60%;
 * - pointing at an emote stops its row and lifts it, with a card of its real
 *   numbers (conveyorCardWords), and its other copies brighten;
 * - a click opens it in Top emotes, locked. On touch the first tap lifts it,
 *   a second tap on it opens it, a tap elsewhere puts it back.
 * The layer stays aria-hidden: the card repeats what Top emotes says, and the
 * search finds every emote by keyboard.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import type { HubActivityPoint } from '../../../../lib/publicHub'
import {
  CONVEYOR_SEP, conveyorCardWords, conveyorEmotes, conveyorPicKey, conveyorRng, emoteFlagKey, tilePicUrl,
  type ConveyorEmote, type ConveyorShares, type ConveyorSpike,
} from './hubV5EmoteMapModel'

/** A conveyor picture, and the moving file to try once if its still fails. */
type ConveyorPic = ConveyorEmote & { moving?: string }

const NO_FLAGS: ReadonlySet<string> = new Set()

const TILT = -0.12
const SZ = 32
const GAP = 28
const ROW = SZ + 24
const SEED = 825
const ALPHA = 0.34
/** The layer's opacity before the Mix, now drawn per picture so a spike's copies can show at full colour. */
const LAYER = 0.72
const BASE = ALPHA * LAYER
const BAKE_H = 72
const BAKE_TIMEOUT_MS = 5000
/** The emote under the pointer. */
const LIFT = 1.8
/** Its other copies. */
const SAME = 0.62
/** A copy in a live emote spike. */
const BIG = 1.15
/** The row under the pointer. */
const SLOW = 0.6
/** Under this much of the mask an emote is too faint to point at: the clear oval and the faded edges. */
const MASK_MIN = 0.3
/** Drawn larger than its 72 px bake once lifted, so the lifted emote fetches a sharper file the first time. */
const HI_H = 96

const NO_SPIKES: ReadonlyMap<string, ConveyorSpike> = new Map()
/** The pictures wait for the page to be idle, but never longer than this after the hub's first data. */
const IDLE_WAIT_MS = 2500

/** Runs `fn` once the page is idle (Safari has no requestIdleCallback: a timer). */
function whenIdle(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout: IDLE_WAIT_MS })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, 600)
  return () => window.clearTimeout(id)
}

export interface HubV5ConveyorRefs {
  mast: RefObject<HTMLElement | null>
  title: RefObject<HTMLElement | null>
  field: RefObject<HTMLElement | null>
  tryRow: RefObject<HTMLElement | null>
  getRow?: RefObject<HTMLElement | null>
  foot: RefObject<HTMLElement | null>
}

interface Sprite { w: number; ar: number; img: HTMLCanvasElement; e: ConveyorEmote; pic: string }
interface Item { s: Sprite; o: number; ww: number }
interface Row { seq: Item[]; len: number; y: number; dir: number; v: number; off: number; f: number }
interface Box { l: number; t: number; r: number; b: number }

function loadPicture(url: string, onload: (im: HTMLImageElement) => void, onerror?: (im: HTMLImageElement) => void, low = false): HTMLImageElement {
  const im = new Image()
  im.decoding = 'async'
  im.referrerPolicy = 'no-referrer'
  if (low) (im as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low'
  if (!/betterttv/.test(url)) im.crossOrigin = 'anonymous' // BTTV sends no CORS header; it draws either way
  im.onload = () => onload(im)
  im.onerror = () => onerror?.(im)
  im.src = url
  return im
}

/** A picture drawn onto a canvas h px high, or null when it will not draw. */
function bakeTo(im: HTMLImageElement, h: number): { ar: number; img: HTMLCanvasElement } | null {
  const ar = Math.min(2.4, Math.max(0.5, im.naturalWidth / (im.naturalHeight || 1)))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(h * ar))
  c.height = h
  const x = c.getContext('2d')
  if (!x) return null
  x.imageSmoothingQuality = 'high'
  try {
    x.drawImage(im, 0, 0, c.width, h)
    return { ar, img: c }
  } catch {
    return null
  }
}

/** Each picture drawn once onto a 72 px high canvas; a slow CDN never holds the hero back past 5 s. */
function bake(list: readonly ConveyorPic[]): { items: Sprite[]; total: number; ready: Promise<void>; cancel: () => void } {
  const S = { items: [] as Sprite[], total: 0, ready: Promise.resolve(), cancel: () => {} }
  let dead = false
  const imgs: HTMLImageElement[] = []
  S.ready = new Promise<void>((done) => {
    let left = list.length
    if (!left) done()
    const settle = () => { left -= 1; if (left <= 0) done() }
    const timer = window.setTimeout(done, BAKE_TIMEOUT_MS)
    S.cancel = () => {
      dead = true
      window.clearTimeout(timer)
      for (const im of imgs) {
        im.onload = null
        im.onerror = null
      }
      done()
    }
    for (const it of list) {
      let fellBack = false
      imgs.push(loadPicture(it.url, (im) => {
        if (dead) return
        const b = bakeTo(im, BAKE_H) // a picture that will not draw is left out
        if (b) {
          S.items.push({ w: it.w, ar: b.ar, img: b.img, e: it, pic: conveyorPicKey(it.url) })
          S.total += it.w
        }
        settle()
      }, (im) => {
        // the still failed: the moving file once, then give up on this picture
        if (it.moving && !fellBack) {
          fellBack = true
          im.src = it.moving
        } else settle()
      }, true))
    }
  }).then(() => { S.items.sort((a, b) => b.w - a.w) })
  return S
}

export function HubV5Conveyor({ points, refs, animated = NO_FLAGS, spikes = NO_SPIKES, shares = null, onOpen }: {
  points: readonly HubActivityPoint[]
  refs: HubV5ConveyorRefs
  /** The hub's animated top emotes by emoteFlagKey (animatedFlags). */
  animated?: ReadonlySet<string>
  /** Live emote spikes by picture (conveyorSpikes); none on a saved copy. */
  spikes?: ReadonlyMap<string, ConveyorSpike>
  /** The emote map's shares (conveyorShares), for the card. */
  shares?: ConveyorShares | null
  /** Opens an emote in Top emotes, locked. */
  onOpen?: (name: string) => void
}) {
  const fxRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [list, setList] = useState<ConveyorPic[]>([])
  const [on, setOn] = useState(false)
  // what the running loop reads from the answer, without starting it again
  const live = useRef({ spikes, shares, onOpen })
  const redraw = useRef<(() => void) | null>(null)
  useEffect(() => {
    live.current = { spikes, shares, onOpen }
    redraw.current?.()
  }, [spikes, shares, onOpen])

  // made of the first poll that lists emotes, so later polls never re-bake it
  useEffect(() => {
    if (list.length) return
    // the small still: Twitch's static picture; 7TV's 2x still (_static) for an emote the hub flags as animated,
    // else its 2x (a still emote's _static is a 404, and the bucket emotes carry no animated flag of their own)
    const next = conveyorEmotes(points).flatMap((e): ConveyorPic[] => {
      const moving = sanitizeEmoteImageUrl(tilePicUrl(e.url, SZ, false, false, 1.5))
      if (!moving) return []
      const still = e.name && animated.has(emoteFlagKey(e.provider, e.name)) ? sanitizeEmoteImageUrl(tilePicUrl(e.url, SZ, false, true, 1.5)) : null
      return [still && still !== moving ? { ...e, url: still, moving } : { ...e, url: moving }]
    })
    if (next.length) setList(next)
  }, [points, animated, list.length])

  // the layer runs from the top of the hero to the line under it
  useEffect(() => {
    const mast = refs.mast.current
    const fx = fxRef.current
    if (!mast || !fx) return undefined
    const size = () => { fx.style.height = `${refs.foot.current?.offsetTop ?? mast.clientHeight}px` }
    size()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(size)
    ro.observe(mast)
    return () => ro.disconnect()
  }, [refs])

  useEffect(() => {
    const mast = refs.mast.current
    const fx = fxRef.current
    const host = hostRef.current
    const canvas = canvasRef.current
    const card = cardRef.current
    if (!mast || !fx || !host || !canvas || !card || !list.length) return undefined
    const x = canvas.getContext?.('2d')
    if (!x) return undefined
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cv = { w: 0, h: 0 }
    const fit = () => {
      cv.w = canvas.clientWidth
      cv.h = canvas.clientHeight
      canvas.width = Math.round(cv.w * dpr)
      canvas.height = Math.round(cv.h * dpr)
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    let S: ReturnType<typeof bake> = { items: [], total: 0, ready: new Promise<void>(() => {}), cancel: () => {} }
    let R = conveyorRng(SEED)
    let rows: Row[] = []
    let dead = false
    let mx = 0
    let my = 0
    let tx = 0
    let ty = 0
    let visible = !document.hidden
    let raf = 0
    let running = false
    // the mask's clear oval, as numbers (canvas pixels), and the copy it keeps clear
    const M = { cy: 0, rx: 470, ry: 190, set: false }
    let boxes: Box[] = []
    // the part of the layer the page shows (canvas pixels): the layer runs into the gutters, which the page clips
    const V = { l: 0, r: 0 }
    // the pointer (canvas pixels), whether it is over the belt, the row under it, and the emote it lifts
    const P = { x: 0, y: 0, in: false, over: null as Row | null }
    const H = { it: null as Item | null, r: null as Row | null, pinned: false }
    let lift = 0
    let lastType = 'mouse'
    const hi = new Map<Sprite, HTMLCanvasElement | null>()
    const hiLoads: HTMLImageElement[] = []
    let cardKey = ''
    const cardSize = { w: 0, h: 0 }

    const pick = () => {
      let v = R() * S.total
      for (const s of S.items) {
        v -= s.w
        if (v <= 0) return s
      }
      return S.items[0]!
    }
    // the box around each piece of the hero's copy, as tight as its content, in canvas pixels
    const measureCopy = () => {
      const cr = canvas.getBoundingClientRect()
      boxes = []
      for (const el of Array.from(mast.children)) {
        if (el === fx || el === card || el === refs.foot.current || !el.getClientRects().length) continue
        const rg = document.createRange()
        rg.selectNodeContents(el)
        const b = typeof rg.getBoundingClientRect === 'function' ? rg.getBoundingClientRect() : el.getBoundingClientRect()
        if (b.width && b.height) boxes.push({ l: b.left - cr.left, t: b.top - cr.top, r: b.right - cr.left, b: b.bottom - cr.top })
      }
      let l = Math.max(cr.left, 0)
      let r = Math.min(cr.right, document.documentElement.clientWidth || cr.right)
      for (let el = fx.parentElement; el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).overflowX === 'visible') continue
        const b = el.getBoundingClientRect()
        l = Math.max(l, b.left)
        r = Math.min(r, b.right)
      }
      const vl = Math.round(l - cr.left), vr = Math.round(r - cr.left)
      if (vr - vl > 32 && (vl !== V.l || vr !== V.r)) {
        V.l = vl
        V.r = vr
        card.style.maxWidth = `${vr - vl - 16}px`
        cardKey = '' // measured again at its new width
      }
    }
    // keep the title, search, Add to Chrome and Try rows clear: the mask's clear oval follows them
    const place = () => {
      measureCopy()
      const title = refs.title.current
      const field = refs.field.current
      if (!title || !field) return
      const low = [refs.tryRow.current, refs.getRow?.current, field].filter((el): el is HTMLElement => Boolean(el && el.getClientRects().length))
      const r = fx.getBoundingClientRect()
      const top = title.getBoundingClientRect().top - r.top
      const bot = Math.max(...low.map((el) => el.getBoundingClientRect().bottom)) - r.top
      M.cy = Math.round((top + bot) / 2)
      M.rx = Math.round(Math.min(field.offsetWidth / 2 + 110, r.width * 0.72))
      M.ry = Math.round((bot - top) / 2 + 60)
      M.set = true
      host.style.setProperty('--cy', `${M.cy}px`)
      host.style.setProperty('--rx', `${M.rx}px`)
      host.style.setProperty('--ry', `${M.ry}px`)
    }
    /** The CSS mask (hub-v5.css .hv5-hc-conv) as a number at a canvas point: 0 hidden to 1 shown. */
    const maskAt = (px: number, py: number) => {
      const { w, h } = cv
      const d = Math.hypot((px - w / 2) / M.rx, (py - (M.set ? M.cy : h / 2)) / M.ry)
      const o = d <= 0.5 ? 0.06 : d >= 1 ? 1 : 0.06 + (d - 0.5) * 1.88
      const cl = (v: number) => Math.min(1, Math.max(0, v))
      return o * cl(Math.min(px, w - px) / (w * 0.07)) * cl(Math.min(py / 28, (h - py) / 64))
    }
    const lay = () => {
      rows = []
      R = conveyorRng(SEED)
      if (!S.items.length) return
      const { w, h } = cv
      const ext = (w / 2) * Math.abs(Math.sin(TILT)) + ROW
      const n = Math.ceil((h + 2 * ext) / ROW) // enough rows for the tilted corners
      for (let i = 0; i < n; i += 1) {
        const seq: Item[] = []
        let len = 0
        while (len < w * 1.7) {
          const s = pick()
          const ww = SZ * s.ar
          seq.push({ s, o: len + ww / 2, ww })
          len += ww + GAP
        }
        rows.push({ seq, len, y: -ext + (i + 0.5) * ROW, dir: i % 2 ? 1 : -1, v: 9 + (i % 3) * 5, off: R() * len, f: 1 })
      }
    }
    // belt space (before the lean and tilt) and canvas pixels
    const ix = (r: Row, it: Item) => ((it.o + r.off) % r.len) - cv.w * 0.35
    const toScreen = (bx: number, by: number, ox: number, oy: number): [number, number] => {
      const c = Math.cos(TILT), s = Math.sin(TILT), X = bx - cv.w / 2, Y = by - cv.h / 2
      return [cv.w / 2 + ox + c * X - s * Y, cv.h / 2 + oy + s * X + c * Y]
    }
    const toBelt = (sx: number, sy: number, ox: number, oy: number): [number, number] => {
      const c = Math.cos(TILT), s = Math.sin(TILT), X = sx - cv.w / 2 - ox, Y = sy - cv.h / 2 - oy
      return [cv.w / 2 + c * X + s * Y, cv.h / 2 - s * X + c * Y]
    }
    /** The copy under a canvas point that is bright enough to point at; the lifted one keeps its lifted size. */
    const hitAt = (px: number, py: number, sticky: boolean): { r: Row; it: Item } | null => {
      if (!rows.length) return null
      const ox = mx * 10, oy = my * 6
      const [bx, by] = toBelt(px, py, ox, oy)
      if (sticky && H.it && H.r) {
        const cx = ix(H.r, H.it)
        if (Math.abs(bx - cx) <= (H.it.ww * LIFT) / 2 + 4 && Math.abs(by - H.r.y) <= (SZ * LIFT) / 2 + 4) return { r: H.r, it: H.it }
      }
      for (const r of rows) {
        if (Math.abs(by - r.y) > SZ / 2 + 6) continue
        for (const it of r.seq) {
          const cx = ix(r, it)
          if (Math.abs(bx - cx) > it.ww / 2 + 6) continue
          const [sx, sy] = toScreen(cx, r.y, ox, oy)
          return maskAt(sx, sy) < MASK_MIN ? null : { r, it }
        }
      }
      return null
    }
    const rowAt = (py: number) => {
      const [, by] = toBelt(P.x, py, mx * 10, my * 6)
      return rows.find((r) => Math.abs(by - r.y) <= ROW / 2) ?? null
    }
    const sharp = (s: Sprite) => {
      if (hi.has(s)) return
      hi.set(s, null)
      const url = tilePicUrl(s.e.url, SZ * LIFT, true, false, dpr)
      if (!url || url === s.e.url) return
      hiLoads.push(loadPicture(url, (im) => {
        if (dead) return
        const b = bakeTo(im, HI_H)
        if (!b) return
        hi.set(s, b.img)
        still()
      }))
    }
    const hideCard = () => {
      card.removeAttribute('data-on')
    }
    const showCard = (s: Sprite, spike: ConveyorSpike | undefined, sx: number, sy: number) => {
      const { shares } = live.current
      const key = `${s.e.id}|${spike ? `${spike.channel}|${spike.uses}` : ''}|${shares?.window ?? ''}|${shares?.byId.get(s.e.id) ?? ''}`
      if (key !== cardKey) {
        cardKey = key
        // one piece per "· …" part, as the emote card wraps them; the break falls only between parts
        const newPart = (lead: string) => {
          const el = document.createElement('span')
          el.className = 'hv5-hc-part'
          if (lead) el.textContent = lead
          return el
        }
        const parts = [newPart('')]
        for (const wd of conveyorCardWords(s.e, spike, shares)) {
          if (!wd.kind && wd.text === CONVEYOR_SEP) {
            parts.push(newPart('· '))
            continue
          }
          const part = parts[parts.length - 1]!
          if (!wd.kind) {
            part.append(wd.text)
            continue
          }
          const el = document.createElement(wd.kind === 'name' ? 'b' : 'span')
          if (wd.kind === 'fig') el.className = 'hv5-hc-fig'
          el.textContent = wd.text
          part.append(el)
        }
        card.replaceChildren(...parts.flatMap((p, i) => (i ? [document.createTextNode(' '), p] : [p])))
        cardSize.w = card.offsetWidth
        cardSize.h = card.offsetHeight
      }
      // above the emote or below it, inside what the page shows: the one that covers the least of the hero's copy, above on a tie
      const pw = cardSize.w, ph = cardSize.h, size = SZ * LIFT
      const covers = (cx: number, cy: number) => boxes.reduce((a, b) =>
        a + Math.max(0, Math.min(cx + pw, b.r + 6) - Math.max(cx, b.l - 6)) * Math.max(0, Math.min(cy + ph, b.b + 6) - Math.max(cy, b.t - 6)), 0)
      const lo = (V.r > V.l ? V.l : 0) + 8, hi = (V.r > V.l ? V.r : cv.w) - pw - 8
      const px = Math.min(Math.max(lo, sx - pw / 2), Math.max(lo, hi))
      const above = sy - size / 2 - ph - 8, below = sy + size / 2 + 8
      const room = [above, below].filter((y) => y >= 8 && y + ph <= cv.h - 8)
      const py = room.length
        ? room.reduce((best, y) => (covers(px, y) < covers(px, best) ? y : best), room[0]!)
        : Math.min(Math.max(8, above), Math.max(8, cv.h - ph - 8))
      card.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`
      card.setAttribute('data-on', '')
    }
    const setHover = (hit: { r: Row; it: Item } | null) => {
      const it = hit?.it ?? null
      if (it === H.it) return
      H.it = it
      H.r = hit?.r ?? null
      mast.style.cursor = it ? 'pointer' : ''
      if (it) sharp(it.s)
      else hideCard()
    }
    const clearHover = () => {
      H.pinned = false
      setHover(null)
    }
    const draw = (dt: number) => {
      const { w, h } = cv
      x.clearRect(0, 0, w, h)
      if (!rows.length) return
      const k = Math.min(1, dt * 2.5)
      mx += (tx - mx) * k
      my += (ty - my) * k
      if (!H.pinned) setHover(P.in ? hitAt(P.x, P.y, true) : null)
      P.over = P.in ? rowAt(P.y) : null
      const ox = mx * 10, oy = my * 6
      lift = reduce ? (H.it ? 1 : 0) : lift + ((H.it ? 1 : 0) - lift) * Math.min(1, dt * 9)
      const { spikes } = live.current
      const same = H.it?.s
      x.save()
      x.translate(w / 2 + ox, h / 2 + oy)
      x.rotate(TILT)
      x.translate(-w / 2, -h / 2)
      const lit: Array<[number, number, Item]> = []
      for (const r of rows) {
        const target = r === H.r ? 0 : r === P.over ? SLOW : 1
        r.f += (target - r.f) * Math.min(1, dt * 6)
        r.off = (((r.off + r.v * r.dir * r.f * dt) % r.len) + r.len) % r.len
        for (const it of r.seq) {
          const cx = ix(r, it)
          if (cx < -it.ww * BIG || cx > w + it.ww * BIG || it === H.it) continue
          if (spikes.size && spikes.has(it.s.pic)) {
            lit.push([cx, r.y, it])
            continue
          }
          x.globalAlpha = it.s === same ? BASE + (SAME - BASE) * lift : BASE
          x.drawImage(it.s.img, cx - it.ww / 2, r.y - SZ / 2, it.ww, SZ)
        }
      }
      // a live spike's copies over the rest, in full colour
      x.globalAlpha = 1
      for (const [cx, y, it] of lit) {
        const ww = it.ww * BIG, hh = SZ * BIG
        x.drawImage(it.s.img, cx - ww / 2, y - hh / 2, ww, hh)
      }
      if (H.it && H.r) {
        const s = H.it.s
        const spike = spikes.get(s.pic)
        const cx = ix(H.r, H.it)
        const s0 = spike ? BIG : 1
        const sc = s0 + (LIFT - s0) * lift
        x.globalAlpha = spike ? 1 : BASE + (1 - BASE) * lift
        x.drawImage(hi.get(s) || s.img, cx - (H.it.ww * sc) / 2, H.r.y - (SZ * sc) / 2, H.it.ww * sc, SZ * sc)
        x.restore()
        const [sx, sy] = toScreen(cx, H.r.y, ox, oy)
        showCard(s, spike, sx, sy)
      } else {
        x.restore()
      }
    }
    // a frame now when the loop is not running (reduced motion), so the card and the colour still answer
    const still = () => {
      if (!running && !dead && rows.length) draw(0)
    }
    // the frame loop runs only while the hero is on screen in a shown tab; it stops, not idles, otherwise
    let ready = false
    const run = () => {
      cancelAnimationFrame(raf)
      raf = 0
      running = false
      if (dead || reduce || !ready || !visible) return
      running = true
      let t0 = performance.now()
      const step = (t: number) => {
        const dt = Math.min(0.05, (t - t0) / 1000)
        t0 = t
        if (dead || !visible) { raf = 0; running = false; return }
        draw(dt)
        raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    const refit = () => {
      fit()
      place()
      lay()
      clearHover()
      draw(0)
    }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - cv.w) > 2 || Math.abs(host.clientHeight - cv.h) > 2) refit()
      else place()
    })
    ro?.observe(host)
    ro?.observe(mast)
    let seen = true
    const show = () => {
      const was = visible
      visible = seen && !document.hidden
      if (visible && !was) run()
    }
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      seen = Boolean(entry?.isIntersecting)
      show()
    })
    io?.observe(mast)
    const onVis = show
    document.addEventListener('visibilitychange', onVis)

    const at = (event: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect()
      return [event.clientX - r.left, event.clientY - r.top]
    }
    /** Over the belt, not over the hero's copy or anything that takes a click or focus. */
    const overBelt = (event: Event, px: number, py: number) => {
      const t = event.target
      if (!(t instanceof Element) || !mast.contains(t) || fx.contains(t)) return false
      // the search's open suggestions list sits over the belt and takes the pointer, like any control
      const takes = t.closest('a, button, input, select, textarea, label, summary, [role="button"], [role="listbox"], [role="option"], [role="menu"], [role="dialog"], [tabindex]')
      if (takes && takes !== mast && mast.contains(takes)) return false
      if (px < 0 || py < 0 || px > cv.w || py > cv.h) return false
      return !boxes.some((b) => px >= b.l - 6 && px <= b.r + 6 && py >= b.t - 6 && py <= b.b + 6)
    }
    const open = (it: Item) => {
      live.current.onOpen?.(it.s.e.name)
    }
    const onDown = (event: PointerEvent) => { lastType = event.pointerType }
    const onEnter = () => { place() }
    const onMove = (event: PointerEvent) => {
      // a little depth: the rows lean with the pointer
      if (!reduce) {
        const r = mast.getBoundingClientRect()
        tx = ((event.clientX - r.left) / r.width) * 2 - 1
        ty = ((event.clientY - r.top) / r.height) * 2 - 1
      }
      if (event.pointerType === 'touch') return
      const [px, py] = at(event)
      P.x = px
      P.y = py
      P.in = overBelt(event, px, py)
      H.pinned = false
      still()
    }
    const onLeave = () => {
      tx = 0
      ty = 0
      P.in = false
      if (!H.pinned) setHover(null)
      still()
    }
    const onClick = (event: MouseEvent) => {
      const [px, py] = at(event)
      const ok = overBelt(event, px, py)
      if (lastType === 'touch') {
        // first tap lifts it, a second tap on it opens it, a tap elsewhere puts it back
        const hit = ok ? hitAt(px, py, true) : null
        if (hit && hit.it === H.it) {
          clearHover()
          open(hit.it)
        } else {
          setHover(hit)
          H.pinned = Boolean(hit)
        }
        still()
        return
      }
      if (!ok) return
      const hit = H.it ? { it: H.it } : hitAt(px, py, false)
      if (!hit) return
      // the page scrolls to Top emotes: put it back, and point again only once the pointer moves
      P.in = false
      clearHover()
      open(hit.it)
      still()
    }
    // a scroll moves the belt under a still pointer, and a swipe after a tap means moving on: put it back, point again once the pointer moves
    const onScroll = () => {
      if (!P.in && !H.it) return
      P.in = false
      clearHover()
      still()
    }
    // a tap outside the hero puts a lifted emote back too
    const onDocDown = (event: PointerEvent) => {
      if (H.pinned && !(event.target instanceof Node && mast.contains(event.target))) {
        clearHover()
        still()
      }
    }
    mast.addEventListener('pointerdown', onDown)
    mast.addEventListener('pointerenter', onEnter)
    mast.addEventListener('pointermove', onMove)
    mast.addEventListener('pointerleave', onLeave)
    mast.addEventListener('click', onClick)
    document.addEventListener('pointerdown', onDocDown)
    window.addEventListener('scroll', onScroll, { passive: true })
    redraw.current = still
    place()
    const stopIdle = whenIdle(() => {
      if (dead) return
      S = bake(list)
      void S.ready.then(() => {
        if (dead) return
        lay()
        draw(0)
        setOn(true)
        ready = true
        run()
      })
    })
    return () => {
      dead = true
      running = false
      redraw.current = null
      stopIdle()
      S.cancel()
      for (const im of hiLoads) im.onload = null
      cancelAnimationFrame(raf)
      ro?.disconnect()
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      mast.removeEventListener('pointerdown', onDown)
      mast.removeEventListener('pointerenter', onEnter)
      mast.removeEventListener('pointermove', onMove)
      mast.removeEventListener('pointerleave', onLeave)
      mast.removeEventListener('click', onClick)
      document.removeEventListener('pointerdown', onDocDown)
      window.removeEventListener('scroll', onScroll)
      mast.style.cursor = ''
    }
  }, [list, refs])

  // the card sits beside the layer, not in it: the layer is behind the hero's copy, and a card that has to cover the copy on a phone reads over it
  return (
    <>
      <div ref={fxRef} className="hv5-hero-fx" aria-hidden="true">
        <div ref={hostRef} className={`hv5-hc-conv${on ? ' hv5-on' : ''}`}>
          <canvas ref={canvasRef} />
        </div>
      </div>
      <div ref={cardRef} className="hv5-hc-card" aria-hidden="true" />
    </>
  )
}
