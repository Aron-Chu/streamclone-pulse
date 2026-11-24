import { heroEmoteUrl, type HeroEmote } from '../heroEmotes'
import type { HeroMoment } from '../heroBackdropModel'

/** A pointer position in viewport (client) coordinates. */
export interface Pointer {
  x: number
  y: number
}

export type SearchEvent = 'focus' | 'blur' | 'input'

/** One layer of the background: the chat columns, the emote rain or the ridge. */
export interface Part {
  tick(now: number, dt: number): void
  /**
   * The pointer, or null when it is off the page or over a page control. `claimed` is true when a layer read
   * earlier already holds it, so this one shows no label of its own. Returns true when this layer holds it.
   */
  pointer(p: Pointer | null, claimed: boolean): boolean
  search(ev: SearchEvent, value: string): void
  moment(m: HeroMoment, nowMs: number): void
  dispose(): void
}

export const NO_PART: Part = { tick() {}, pointer: () => false, search() {}, moment() {}, dispose() {} }

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Emotes whose picture failed to load this visit; the decks pass over them. */
export const failedEmotes = new Set<string>()

/** An emote picture: the smallest file, no referrer, and a failed load simply drops out. */
export function emoteImg(emote: HeroEmote, height: number): HTMLImageElement {
  const img = document.createElement('img')
  img.alt = ''
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  img.draggable = false
  img.height = height
  img.width = Math.round(height * emote.aspect)
  img.addEventListener('error', () => {
    failedEmotes.add(emote.name)
    img.remove()
  }, { once: true })
  img.src = heroEmoteUrl(emote)
  return img
}

export interface ChipText {
  text: string
  small?: string
  emote?: HeroEmote | null
}

/** A small label in a layer's own coordinates, kept inside the layer. Text only, never markup. */
export function makeChip(parent: HTMLElement, tone?: 'moment') {
  const el = document.createElement('div')
  el.className = `sl-bgchip${tone ? ` sl-bgchip--${tone}` : ''}`
  parent.appendChild(el)
  let last = ''
  return {
    el,
    show({ text, small, emote }: ChipText) {
      const key = `${emote?.name ?? ''}|${text}|${small ?? ''}`
      if (key !== last) {
        last = key
        el.replaceChildren()
        if (emote && !failedEmotes.has(emote.name)) el.appendChild(emoteImg(emote, 18))
        const b = document.createElement('span')
        b.textContent = text
        el.appendChild(b)
        if (small) {
          const s = document.createElement('small')
          s.textContent = small
          el.appendChild(s)
        }
      }
      el.classList.add('is-on')
    },
    hide() {
      el.classList.remove('is-on')
    },
    /** Centre the chip over (x, y), clamped to the layer's width. */
    at(x: number, y: number, width: number) {
      const half = (el.offsetWidth || 160) / 2
      el.style.left = `${clamp(x, half + 12, Math.max(half + 12, width - half - 12)).toFixed(1)}px`
      el.style.top = `${y.toFixed(1)}px`
    },
    dispose() {
      el.remove()
    },
  }
}

export type Chip = ReturnType<typeof makeChip>

export type Rgb = [number, number, number]

/** A theme colour (an HSL triplet such as "189 94% 55%") as RGB, for the canvas. */
export function tokenRgb(el: Element, name: string, fallback: Rgb): Rgb {
  const raw = getComputedStyle(el).getPropertyValue(name).trim()
  const m = /^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(raw)
  if (!m) return fallback
  const h = (((Number(m[1]) % 360) + 360) % 360) / 360
  const s = Number(m[2]) / 100
  const l = Number(m[3]) / 100
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as Rgb
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (u < 1 / 6) return p + (q - p) * 6 * u
    if (u < 1 / 2) return q
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6
    return p
  }
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((v) => Math.round(v * 255)) as Rgb
}

export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Rgb
export const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1).toFixed(3)})`
