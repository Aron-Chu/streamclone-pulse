import { emoteDeck, findHeroEmote, HERO_EMOTES, isWideEmote, type HeroEmote } from '../heroEmotes'
import type { HeroMoment } from '../heroBackdropModel'
import { clamp, emoteImg, failedEmotes, makeChip, NO_PART, type Part, type Pointer, type SearchEvent } from './shared'

/**
 * The emote rain: drawn from the stored set through a shuffled deck, so many different emotes fall at once
 * and each comes up before any repeats. Three faint depths with blur give it parallax; it is texture behind
 * the page, and a drop near the pointer slows and comes into focus. The search makes it hold its breath, and
 * a live moment stirs the gutters with a handful of different emotes. It falls only in the page gutters.
 *
 * Each drop's rise and sway are handed to the browser as animations, so the compositor moves them and the page's
 * own thread does no work for the rain at rest (11-24: written each frame from script, the rain kept a fast
 * desktop core about a third busy, at the footer too). Script steps in only while something answers the reader:
 * the pointer near a drop, the search held, a live moment's burst.
 */

/** Far, middle and near: height px, opacity, rise px/s, blur px, share of the drops. */
const LAYERS = [
  { sz: 22, a: 0.08, v: 15, blur: 1.4, share: 0.45 },
  { sz: 32, a: 0.12, v: 23, blur: 0.6, share: 0.35 },
  { sz: 44, a: 0.17, v: 32, blur: 0, share: 0.2 },
] as const
const HOVER_A = 0.62
/** Wide emotes catch the eye most, so only this many fall at once, and never in the near layer. */
const MAX_WIDE = 2
/** Below this gutter a drop would cross the words, so the rain keeps to a thin band at each edge instead. */
const MIN_GUTTER = 90
/** That band, as today's rain floors it (2.5rem): small and middle drops only, and no wide emotes. */
const EDGE_BAND = 40
/** The fewest drops, so a narrow screen still has a rain rather than a stray emote. */
const MIN_DROPS = 10
/** The sway's period at base speed: one full side-to-side swing every 2600 ms x 2 pi. */
const SWAY_MS = 2600 * Math.PI * 2
/** A sine's ease, as a curve the compositor runs (easeInOutSine). */
const SINE_EASE = 'cubic-bezier(0.37, 0, 0.63, 1)'
/** Focus and speed this close to where they settle count as settled, and the drop is left to the compositor. */
const SETTLED = 0.004

interface Drop {
  /** Holds the sway, the opacity and the blur. */
  el: HTMLSpanElement
  /** Holds the rise and the turn. */
  fall: HTMLSpanElement
  layer: 0 | 1 | 2
  side: -1 | 1
  e: HeroEmote | null
  h: number
  w: number
  hx: number
  y0: number
  y1: number
  rot0: number
  /** Rise duration at base speed, ms. */
  dur: number
  sw: number
  swayMs: number
  rise: Animation | null
  sway: Animation | null
  rate: number
  focus: number
  /** The look last written, so an unchanged one is not written again. */
  look: string
}

interface Burst {
  el: HTMLSpanElement
  w: number
  x: number
  y: number
  vx: number
  vy: number
  t: number
  life: number
  rot: number
  vr: number
}

const animates = (el: Element) => typeof (el as HTMLElement).animate === 'function'

export function mountEmoteRain(host: HTMLElement): Part {
  host.replaceChildren()
  const W = host.clientWidth
  const H = host.clientHeight
  if (H < 200 || !animates(host)) return NO_PART
  // The content column's width comes from the page (--sl-shell), so the rain follows it if it changes.
  const shell = parseFloat(getComputedStyle(host).getPropertyValue('--sl-shell')) || 1120
  const gutter = Math.max(0, (W - shell) / 2)
  const narrow = gutter < MIN_GUTTER
  const gw = narrow ? Math.max(EDGE_BAND, gutter) : gutter
  const margin = narrow ? 4 : 10
  // A drop comes into focus within 190 px of the pointer, and the drops keep to the gutters (plus their sway): a
  // pointer farther in than that can light none of them, so it needs no frames.
  const REACH = 190 + 20
  const inReach = (p: Pointer) => p.x < gw + REACH || p.x > W - gw - REACH

  const R = Math.random
  const drops: Drop[] = []
  const deck = emoteDeck(HERO_EMOTES, R)
  const tip = makeChip(host)

  const pick = (self: Drop | null, allowWide: boolean) => {
    const wide = drops.reduce((n, o) => n + (o !== self && o.e && isWideEmote(o.e) ? 1 : 0), 0)
    return deck((e) => failedEmotes.has(e.name) || (isWideEmote(e) && (narrow || !allowWide || wide >= MAX_WIDE)))
  }

  function dress(d: Drop, e: HeroEmote | undefined) {
    if (!e || (d.e === e && d.fall.firstChild)) return
    d.e = e
    d.w = d.h * e.aspect
    d.look = ''
    const img = emoteImg(e, d.h)
    // A picture that fails takes the next emote in the deck, at once rather than on a frame.
    img.addEventListener('error', () => {
      if (d.e !== e) return
      const next = pick(d, d.layer !== 2)
      if (next && next !== e) dress(d, next)
      else d.e = null
    }, { once: true })
    d.fall.replaceChildren(img)
    for (const el of [d.el, d.fall]) {
      el.style.width = `${d.w.toFixed(1)}px`
      el.style.height = `${d.h}px`
    }
  }

  /** The drop's look: opacity, blur and size, from how much it is in focus. Written only when it changes. */
  function look(d: Drop, fx: number, hovered: boolean) {
    const L = LAYERS[d.layer]
    const a = (L.a + (HOVER_A - L.a) * fx * (hovered ? 1 : 0.45)).toFixed(3)
    const b = Math.round(L.blur * (1 - fx) * 10) / 10
    const s = (1 + 0.18 * fx).toFixed(3)
    const key = `${a}|${b}|${s}`
    if (key === d.look) return
    d.look = key
    d.el.style.opacity = a
    d.el.style.filter = `${b > 0 ? `blur(${b}px) ` : ''}saturate(0.75)`
    const img = d.fall.firstElementChild as HTMLElement | null
    if (img) img.style.transform = s === '1.000' ? '' : `scale(${s})`
  }

  /** Where the drop is now, in the layer's coordinates, from its animations' clocks. */
  function at(d: Drop): { x: number; y: number } {
    const t = Number(d.rise?.currentTime ?? 0)
    const y = d.y0 + (d.y1 - d.y0) * clamp(t / d.dur, 0, 1)
    const half = d.swayMs / 2
    const c = Number(d.sway?.currentTime ?? 0)
    const u = (c % half) / half
    const eased = (1 - Math.cos(Math.PI * u)) / 2
    const s = Math.floor(c / half) % 2 ? 1 - 2 * eased : -1 + 2 * eased
    return { x: d.hx + s * d.sw, y }
  }

  /** Skips steps under 1% while easing; a settled rate is always applied, since the loop may stop after it. */
  function setRate(d: Drop, rate: number, settled: boolean) {
    if (rate === d.rate) return
    if (!settled && Math.abs(rate - d.rate) < 0.01 && !(rate === 0 && d.rate !== 0)) return
    d.rate = rate
    d.rise?.updatePlaybackRate(rate)
  }

  function place(d: Drop, scatter: boolean) {
    dress(d, pick(d, d.layer !== 2))
    const L = LAYERS[d.layer]
    const lo = d.side < 0 ? margin : W - gw + margin
    const vs = 0.85 + R() * 0.3
    d.hx = lo + R() * Math.max(margin, gw - 2 * margin - d.w)
    d.y0 = scatter ? R() * (H + 60) : H + 20 + R() * 80
    d.y1 = -d.h - 30
    d.sw = 5 + R() * 9
    d.rot0 = (R() - 0.5) * 0.5
    const vr = (R() - 0.5) * 0.14
    d.dur = ((d.y0 - d.y1) / (L.v * vs)) * 1000
    d.swayMs = SWAY_MS / vs
    const turn = d.rot0 + (vr * d.dur) / 1000
    d.rise?.cancel()
    d.rise = d.fall.animate([
      { transform: `translate3d(${d.hx.toFixed(1)}px,${d.y0.toFixed(1)}px,0) rotate(${d.rot0.toFixed(3)}rad)` },
      { transform: `translate3d(${d.hx.toFixed(1)}px,${d.y1.toFixed(1)}px,0) rotate(${turn.toFixed(3)}rad)` },
    ], { duration: d.dur, easing: 'linear' })
    if (d.rate !== 1) d.rise.updatePlaybackRate(d.rate)
    d.rise.onfinish = () => place(d, false)
    if (!d.sway) {
      d.sway = d.el.animate([
        { transform: `translateX(${(-d.sw).toFixed(1)}px)` },
        { transform: `translateX(${d.sw.toFixed(1)}px)` },
      ], { duration: d.swayMs / 2, easing: SINE_EASE, direction: 'alternate', iterations: Infinity })
      d.sway.currentTime = R() * d.swayMs
    }
    if (hidden) pauseAll()
  }

  let hidden = document.hidden
  const pauseAll = () => {
    for (const d of drops) {
      d.rise?.pause()
      d.sway?.pause()
    }
  }
  // While the tab is hidden the drops wait where they are, as the frame loop's drops did; otherwise they would all
  // finish together and come back up from the bottom in one wave.
  const onVisibility = () => {
    hidden = document.hidden
    if (hidden) return pauseAll()
    for (const d of drops) {
      d.rise?.play()
      d.sway?.play()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  const N = Math.max(MIN_DROPS, Math.round(26 * Math.min(1, gw / 400)))
  for (let i = 0; i < N; i++) {
    // In the edge band the near layer would be too big for the room; its share goes to the far one.
    const x = R()
    const layer = (narrow
      ? x < LAYERS[0].share + LAYERS[2].share ? 0 : 1
      : x < LAYERS[0].share ? 0 : x < LAYERS[0].share + LAYERS[1].share ? 1 : 2) as Drop['layer']
    const el = document.createElement('span')
    el.className = 'sl-fx__drop'
    const fall = document.createElement('span')
    fall.className = 'sl-fx__fall'
    el.appendChild(fall)
    const h = LAYERS[layer].sz
    drops.push({ el, fall, layer, side: i % 2 ? 1 : -1, e: null, h, w: h, hx: 0, y0: 0, y1: 0, rot0: 0, dur: 1, sw: 0, swayMs: SWAY_MS, rise: null, sway: null, rate: 1, focus: 0, look: '' })
  }
  drops.sort((a, b) => a.layer - b.layer)
  for (const d of drops) {
    host.insertBefore(d.el, tip.el)
    look(d, 0, false)
    place(d, true)
  }

  let speed = 1
  let held = false
  let hovered: Drop | null = null
  let pointer: Pointer | null = null
  let lit: { name: string; until: number } | null = null
  /** True while a drop is lit or easing, so the frame loop keeps calling until everything has settled. */
  let moving = false
  const bursts: Burst[] = []

  function paint(el: HTMLElement, x: number, y: number, rot: number, a: number) {
    el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(3)}rad)`
    el.style.opacity = a.toFixed(3)
  }

  return {
    tick(now, dt) {
      const target = held ? 0.3 : 1
      speed += (target - speed) * Math.min(1, dt * 2.5)
      if (Math.abs(target - speed) < SETTLED) speed = target
      let busy = speed !== target
      const glowing = lit && now < lit.until ? lit.name : null
      if (lit && !glowing) lit = null
      for (const d of drops) {
        let near = 0
        if (pointer && d.layer > 0) {
          const p = at(d)
          const dd = Math.hypot(p.x + d.w / 2 - pointer.x, p.y + d.h / 2 - pointer.y)
          near = clamp(1 - (dd - 40) / 150, 0, 1)
        }
        d.focus += (near - d.focus) * Math.min(1, dt * 6)
        if (Math.abs(near - d.focus) < SETTLED) d.focus = near
        else busy = true
        const glow = glowing && d.e && glowing === d.e.name ? 1 : 0
        const fx = Math.max(d.focus, glow, d === hovered ? 1 : 0)
        look(d, fx, d === hovered)
        setRate(d, d === hovered ? 0 : speed * (1 - 0.8 * d.focus), speed === target && d.focus === near)
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i]
        b.t += dt
        b.vx *= Math.exp(-dt * 0.9)
        b.vy -= 16 * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.rot += b.vr * dt
        if (b.t > b.life) {
          b.el.remove()
          bursts.splice(i, 1)
          continue
        }
        // Brightest out in the gutters, faint where it crosses the words.
        const into = clamp((Math.abs(b.x + b.w / 2 - W / 2) - 380) / 160, 0, 1)
        paint(b.el, b.x, b.y, b.rot, Math.min(1, b.t * 4) * (1 - b.t / b.life) * (0.1 + 0.18 * into))
      }
      if (hovered) {
        const p = at(hovered)
        tip.at(p.x + hovered.w / 2, p.y - 4, W)
      }
      moving = busy || !!glowing || !!hovered || bursts.length > 0
    },
    idle() {
      return !moving && !hovered && !(pointer && inReach(pointer))
    },
    pointer(p, claimed) {
      pointer = p
      moving = true
      let best: Drop | null = null
      let bd = Infinity
      // Drops still come into focus near the pointer; only the label waits while another layer holds it.
      if (p && !claimed) {
        for (const d of drops) {
          if (d.layer === 0 || !d.e) continue
          const q = at(d)
          const dx = Math.abs(q.x + d.w / 2 - p.x)
          const dy = Math.abs(q.y + d.h / 2 - p.y)
          if (dx < d.w / 2 + 10 && dy < d.h / 2 + 10 && dx + dy < bd) {
            bd = dx + dy
            best = d
          }
        }
      }
      if (best !== hovered) {
        hovered = best
        if (best?.e) tip.show({ text: best.e.name, small: best.e.provider === '7tv' ? '7TV' : 'Twitch', emote: null })
        else tip.hide()
      }
      return best != null
    },
    search(ev: SearchEvent) {
      if (ev === 'focus') held = true
      if (ev === 'blur') held = false
      moving = true
    },
    moment(m: HeroMoment) {
      const now = performance.now()
      moving = true
      if (m.emote) lit = { name: m.emote, until: now + 3600 }
      // Out from both ends of the hero's ticker row, when it is on screen.
      const row = document.querySelector('.sl-tickwrap')?.getBoundingClientRect()
      if (!row || row.bottom < 0 || row.top > H) return
      const lead = findHeroEmote(m.emote)
      for (let i = 0; i < 8; i++) {
        const side = i % 2 ? 1 : -1
        const e = i === 0 && lead && !isWideEmote(lead) && !failedEmotes.has(lead.name) ? lead : pick(null, false)
        if (!e) continue
        const h = 24 + R() * 10
        const w = h * e.aspect
        const el = document.createElement('span')
        el.className = 'sl-fx__drop sl-fx__drop--burst'
        el.style.width = `${w.toFixed(1)}px`
        el.style.height = `${h.toFixed(1)}px`
        el.style.opacity = '0'
        el.style.filter = 'saturate(0.75)'
        el.appendChild(emoteImg(e, Math.round(h)))
        host.insertBefore(el, tip.el)
        const x0 = side < 0 ? row.left : row.right
        bursts.push({ el, w, x: x0 - w / 2, y: row.top + row.height / 2 - h / 2 + (R() - 0.5) * 16, vx: side * (230 + R() * 230), vy: -(10 + R() * 120), t: 0, life: 3 + R() * 1.4, rot: 0, vr: (R() - 0.5) * 1.2 })
      }
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibility)
      for (const d of drops) {
        if (d.rise) d.rise.onfinish = null
        d.rise?.cancel()
        d.sway?.cancel()
      }
      host.replaceChildren()
    },
  }
}
