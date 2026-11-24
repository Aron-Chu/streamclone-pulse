import { emoteDeck, findHeroEmote, HERO_EMOTES, isWideEmote, type HeroEmote } from '../heroEmotes'
import type { HeroMoment } from '../heroBackdropModel'
import { clamp, emoteImg, failedEmotes, makeChip, NO_PART, type Part, type Pointer, type SearchEvent } from './shared'

/**
 * The emote rain: drawn from the stored set through a shuffled deck, so many different emotes fall at once
 * and each comes up before any repeats. Three faint depths with blur give it parallax; it is texture behind
 * the page, and a drop near the pointer slows and comes into focus. The search makes it hold its breath, and
 * a live moment stirs the gutters with a handful of different emotes. It falls only in the page gutters.
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

interface Drop {
  el: HTMLSpanElement
  layer: 0 | 1 | 2
  side: -1 | 1
  e: HeroEmote | null
  h: number
  w: number
  hx: number
  x: number
  y: number
  ph: number
  sw: number
  rot: number
  vr: number
  vs: number
  focus: number
  blur: number
  /** The opacity last written, so an unchanged one is not written again each frame. */
  op: string
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

export function mountEmoteRain(host: HTMLElement): Part {
  host.replaceChildren()
  const W = host.clientWidth
  const H = host.clientHeight
  if (H < 200) return NO_PART
  // The content column's width comes from the page (--sl-shell), so the rain follows it if it changes.
  const shell = parseFloat(getComputedStyle(host).getPropertyValue('--sl-shell')) || 1120
  const gutter = Math.max(0, (W - shell) / 2)
  const narrow = gutter < MIN_GUTTER
  const gw = narrow ? Math.max(EDGE_BAND, gutter) : gutter
  const margin = narrow ? 4 : 10

  const R = Math.random
  const drops: Drop[] = []
  const deck = emoteDeck(HERO_EMOTES, R)
  const tip = makeChip(host)

  const pick = (self: Drop | null, allowWide: boolean) => {
    const wide = drops.reduce((n, o) => n + (o !== self && o.e && isWideEmote(o.e) ? 1 : 0), 0)
    return deck((e) => failedEmotes.has(e.name) || (isWideEmote(e) && (narrow || !allowWide || wide >= MAX_WIDE)))
  }

  function dress(d: Drop, e: HeroEmote | undefined) {
    if (!e || (d.e === e && d.el.firstChild)) return
    d.e = e
    d.w = d.h * e.aspect
    d.el.replaceChildren(emoteImg(e, d.h))
    d.el.style.width = `${d.w.toFixed(1)}px`
    d.el.style.height = `${d.h}px`
  }

  function place(d: Drop, scatter: boolean) {
    dress(d, pick(d, d.layer !== 2))
    const lo = d.side < 0 ? margin : W - gw + margin
    d.hx = lo + R() * Math.max(margin, gw - 2 * margin - d.w)
    d.y = scatter ? R() * (H + 60) : H + 20 + R() * 80
    d.ph = R() * 6.28
    d.sw = 5 + R() * 9
    d.rot = (R() - 0.5) * 0.5
    d.vr = (R() - 0.5) * 0.14
    d.vs = 0.85 + R() * 0.3
  }

  const N = Math.max(MIN_DROPS, Math.round(26 * Math.min(1, gw / 400)))
  for (let i = 0; i < N; i++) {
    // In the edge band the near layer would be too big for the room; its share goes to the far one.
    const x = R()
    const layer = (narrow
      ? x < LAYERS[0].share + LAYERS[2].share ? 0 : 1
      : x < LAYERS[0].share ? 0 : x < LAYERS[0].share + LAYERS[1].share ? 1 : 2) as Drop['layer']
    const el = document.createElement('span')
    el.className = 'sl-fx__drop'
    const d: Drop = { el, layer, side: i % 2 ? 1 : -1, e: null, h: LAYERS[layer].sz, w: LAYERS[layer].sz, hx: 0, x: 0, y: 0, ph: 0, sw: 0, rot: 0, vr: 0, vs: 1, focus: 0, blur: -1, op: '' }
    place(d, true)
    d.x = d.hx
    drops.push(d)
  }
  drops.sort((a, b) => a.layer - b.layer)
  for (const d of drops) host.insertBefore(d.el, tip.el)

  let speed = 1
  let held = false
  let hovered: Drop | null = null
  let pointer: Pointer | null = null
  let lit: { name: string; until: number } | null = null
  const bursts: Burst[] = []

  function paint(el: HTMLElement, x: number, y: number, rot: number, scale: number, a: number, blur: number, d: Drop | null) {
    el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(3)}rad) scale(${scale.toFixed(3)})`
    const op = a.toFixed(3)
    if (!d || d.op !== op) {
      el.style.opacity = op
      if (d) d.op = op
    }
    const b = Math.round(blur * 10) / 10
    if (!d || d.blur !== b) {
      el.style.filter = `${b > 0 ? `blur(${b}px) ` : ''}saturate(0.75)`
      if (d) d.blur = b
    }
  }

  return {
    tick(now, dt) {
      speed += ((held ? 0.3 : 1) - speed) * Math.min(1, dt * 2.5)
      for (const d of drops) {
        // A drop whose picture failed takes the next emote in the deck.
        if (d.e && !d.el.firstChild) {
          const next = pick(d, d.layer !== 2)
          if (next && next !== d.e) dress(d, next)
          else d.e = null
        }
        const L = LAYERS[d.layer]
        let near = 0
        if (pointer && d.layer > 0) {
          const dd = Math.hypot(d.x + d.w / 2 - pointer.x, d.y + d.h / 2 - pointer.y)
          near = clamp(1 - (dd - 40) / 150, 0, 1)
        }
        d.focus += (near - d.focus) * Math.min(1, dt * 6)
        if (d !== hovered) d.y -= L.v * d.vs * speed * (1 - 0.8 * d.focus) * dt
        if (d.y < -d.h - 30) place(d, false)
        d.x = d.hx + Math.sin((now / 2600) * d.vs + d.ph) * d.sw
        d.rot += d.vr * dt * speed
        const glow = lit && d.e && lit.name === d.e.name && now < lit.until ? 1 : 0
        const fx = Math.max(d.focus, glow, d === hovered ? 1 : 0)
        const a = L.a + (HOVER_A - L.a) * fx * (d === hovered ? 1 : 0.45)
        paint(d.el, d.x, d.y, d.rot, 1 + 0.18 * fx, a, L.blur * (1 - fx), d)
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
        paint(b.el, b.x, b.y, b.rot, 1, Math.min(1, b.t * 4) * (1 - b.t / b.life) * (0.1 + 0.18 * into), 0, null)
      }
      if (hovered) tip.at(hovered.x + hovered.w / 2, hovered.y - 4, W)
    },
    pointer(p, claimed) {
      pointer = p
      let best: Drop | null = null
      let bd = Infinity
      // Drops still come into focus near the pointer; only the label waits while another layer holds it.
      if (p && !claimed) {
        for (const d of drops) {
          if (d.layer === 0 || !d.e) continue
          const dx = Math.abs(d.x + d.w / 2 - p.x)
          const dy = Math.abs(d.y + d.h / 2 - p.y)
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
    },
    moment(m: HeroMoment) {
      const now = performance.now()
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
        el.className = 'sl-fx__drop'
        el.style.width = `${w.toFixed(1)}px`
        el.style.height = `${h.toFixed(1)}px`
        el.style.opacity = '0'
        el.appendChild(emoteImg(e, Math.round(h)))
        host.insertBefore(el, tip.el)
        const x0 = side < 0 ? row.left : row.right
        bursts.push({ el, w, x: x0 - w / 2, y: row.top + row.height / 2 - h / 2 + (R() - 0.5) * 16, vx: side * (230 + R() * 230), vy: -(10 + R() * 120), t: 0, life: 3 + R() * 1.4, rot: 0, vr: (R() - 0.5) * 1.2 })
      }
    },
    dispose() {
      host.replaceChildren()
    },
  }
}
