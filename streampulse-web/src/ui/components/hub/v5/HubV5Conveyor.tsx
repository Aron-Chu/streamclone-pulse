/**
 * The hero's conveyor (R5-15, Aron's pick from the hero lab, at Soft; mockup
 * d3-v5 hub-hero.js / hub-hero.css): tilted rows of the emotes chat used most
 * slide past behind the title and search, in opposite directions at three
 * speeds, and lean a little with the pointer. Each picture is baked once onto a
 * small canvas, so animated emotes hold their first frame. A mask keeps an oval
 * clear around the title, search and Try row, fades the left and right edges,
 * and fades out before the line under the hero. It fades in once its pictures
 * are drawn, pauses off screen or in a hidden tab, and holds one still frame
 * under reduced motion. Decorative: aria-hidden, no numbers, no pointer events.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { HubActivityPoint } from '../../../../lib/publicHub'
import { conveyorEmotes, conveyorRng, type ConveyorEmote } from './hubV5EmoteMapModel'

const TILT = -0.12
const SZ = 32
const GAP = 28
const ROW = SZ + 24
const SEED = 825
const ALPHA = 0.34
const BAKE_H = 72
const BAKE_TIMEOUT_MS = 5000

export interface HubV5ConveyorRefs {
  mast: RefObject<HTMLElement | null>
  kicker: RefObject<HTMLElement | null>
  field: RefObject<HTMLElement | null>
  tryRow: RefObject<HTMLElement | null>
  foot: RefObject<HTMLElement | null>
}

interface Sprite { w: number; ar: number; img: HTMLCanvasElement }

/** Each picture drawn once onto a 72 px high canvas; a slow CDN never holds the hero back past 5 s. */
function bake(list: readonly ConveyorEmote[]): { items: Sprite[]; total: number; ready: Promise<void>; cancel: () => void } {
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
      const im = new Image()
      imgs.push(im)
      im.decoding = 'async'
      im.referrerPolicy = 'no-referrer'
      if (!/betterttv/.test(it.url)) im.crossOrigin = 'anonymous' // BTTV sends no CORS header; it draws either way
      im.onload = () => {
        if (dead) return
        const ar = Math.min(2.4, Math.max(0.5, im.naturalWidth / (im.naturalHeight || 1)))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(BAKE_H * ar))
        c.height = BAKE_H
        const x = c.getContext('2d')
        if (x) {
          x.imageSmoothingQuality = 'high'
          try {
            x.drawImage(im, 0, 0, c.width, BAKE_H)
            S.items.push({ w: it.w, ar, img: c })
            S.total += it.w
          } catch { /* a picture that will not draw is left out */ }
        }
        settle()
      }
      im.onerror = settle
      im.src = it.url
    }
  }).then(() => { S.items.sort((a, b) => b.w - a.w) })
  return S
}

export function HubV5Conveyor({ points, refs }: { points: readonly HubActivityPoint[]; refs: HubV5ConveyorRefs }) {
  const fxRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [list, setList] = useState<ConveyorEmote[]>([])
  const [on, setOn] = useState(false)

  // made of the first poll that lists emotes, so later polls never re-bake it
  useEffect(() => {
    if (list.length) return
    const next = conveyorEmotes(points)
    if (next.length) setList(next)
  }, [points, list.length])

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
    if (!mast || !fx || !host || !canvas || !list.length) return undefined
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
    const S = bake(list)
    let R = conveyorRng(SEED)
    let rows: Array<{ seq: Array<{ s: Sprite; o: number }>; len: number; y: number; dir: number; v: number; off: number }> = []
    let dead = false
    let mx = 0
    let my = 0
    let tx = 0
    let ty = 0
    let visible = !document.hidden
    let raf = 0
    const pick = () => {
      let v = R() * S.total
      for (const s of S.items) {
        v -= s.w
        if (v <= 0) return s
      }
      return S.items[0]!
    }
    // keep the title, search and Try row clear: the mask's clear oval follows them
    const place = () => {
      const k = refs.kicker.current
      const field = refs.field.current
      if (!k || !field) return
      const low = [refs.tryRow.current, field].filter((el): el is HTMLElement => Boolean(el && el.getClientRects().length))
      const r = fx.getBoundingClientRect()
      const top = k.getBoundingClientRect().top - r.top
      const bot = Math.max(...low.map((el) => el.getBoundingClientRect().bottom)) - r.top
      host.style.setProperty('--cy', `${Math.round((top + bot) / 2)}px`)
      host.style.setProperty('--rx', `${Math.round(Math.min(field.offsetWidth / 2 + 110, r.width * 0.72))}px`)
      host.style.setProperty('--ry', `${Math.round((bot - top) / 2 + 60)}px`)
    }
    const lay = () => {
      rows = []
      R = conveyorRng(SEED)
      if (!S.items.length) return
      const { w, h } = cv
      const ext = (w / 2) * Math.abs(Math.sin(TILT)) + ROW
      const n = Math.ceil((h + 2 * ext) / ROW) // enough rows for the tilted corners
      for (let i = 0; i < n; i += 1) {
        const seq: Array<{ s: Sprite; o: number }> = []
        let len = 0
        while (len < w * 1.7) {
          const s = pick()
          const ww = SZ * s.ar
          seq.push({ s, o: len + ww / 2 })
          len += ww + GAP
        }
        rows.push({ seq, len, y: -ext + (i + 0.5) * ROW, dir: i % 2 ? 1 : -1, v: 9 + (i % 3) * 5, off: R() * len })
      }
    }
    const draw = (dt: number) => {
      const { w, h } = cv
      x.clearRect(0, 0, w, h)
      if (!rows.length) return
      const k = Math.min(1, dt * 2.5)
      mx += (tx - mx) * k
      my += (ty - my) * k
      x.save()
      x.translate(w / 2 + mx * 10, h / 2 + my * 6)
      x.rotate(TILT)
      x.translate(-w / 2, -h / 2)
      x.globalAlpha = ALPHA
      for (const r of rows) {
        r.off = (r.off + r.v * r.dir * dt + r.len) % r.len
        for (const it of r.seq) {
          const ww = SZ * it.s.ar
          const cx = ((it.o + r.off) % r.len) - w * 0.35
          if (cx < -ww || cx > w + ww) continue
          x.drawImage(it.s.img, cx - ww / 2, r.y - SZ / 2, ww, SZ)
        }
      }
      x.restore()
    }
    const run = () => {
      cancelAnimationFrame(raf)
      let t0 = performance.now()
      const step = (t: number) => {
        const dt = Math.min(0.05, (t - t0) / 1000)
        t0 = t
        if (dead) return
        if (visible) draw(dt)
        raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    const refit = () => {
      fit()
      place()
      lay()
      draw(0)
    }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - cv.w) > 2 || Math.abs(host.clientHeight - cv.h) > 2) refit()
      else place()
    })
    ro?.observe(host)
    ro?.observe(mast)
    let seen = true
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      seen = Boolean(entry?.isIntersecting)
      visible = seen && !document.hidden
    })
    io?.observe(mast)
    const onVis = () => { visible = seen && !document.hidden }
    document.addEventListener('visibilitychange', onVis)
    // a little depth: the rows lean with the pointer
    const onMove = (event: PointerEvent) => {
      const r = mast.getBoundingClientRect()
      tx = ((event.clientX - r.left) / r.width) * 2 - 1
      ty = ((event.clientY - r.top) / r.height) * 2 - 1
    }
    const onLeave = () => {
      tx = 0
      ty = 0
    }
    if (!reduce) {
      mast.addEventListener('pointermove', onMove)
      mast.addEventListener('pointerleave', onLeave)
    }
    place()
    void S.ready.then(() => {
      if (dead) return
      lay()
      draw(0)
      setOn(true)
      if (!reduce) run()
    })
    return () => {
      dead = true
      S.cancel()
      cancelAnimationFrame(raf)
      ro?.disconnect()
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      mast.removeEventListener('pointermove', onMove)
      mast.removeEventListener('pointerleave', onLeave)
    }
  }, [list, refs])

  return (
    <div ref={fxRef} className="hv5-hero-fx" aria-hidden="true">
      <div ref={hostRef} className={`hv5-hc-conv${on ? ' hv5-on' : ''}`}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
