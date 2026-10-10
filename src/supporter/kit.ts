import { SUPPORTER_CREST_GEMS, SUPPORTER_CREST_PULSE_PATH, type SupporterPaintStyle, type SupporterTenure } from '../shared/supporterPaint.ts'

/**
 * Shared pieces of the Supporter design lab (round 2, "pulse-supporter-banners"):
 * its emotes, paints, crest stages, canned chatter and the small DOM builders
 * the Your Line and Emote Pile stages are drawn with.
 *
 * Ported from the lab rather than redrawn so the extension looks and moves like
 * the approved page. The two changes are the emote set (Twitch globals mixed
 * with wide 7TV emotes, served from the two CDNs the extension already loads)
 * and real Supporter data where a Supporter is shown their own kit.
 *
 * Framework-free on purpose: the quick-settings card runs this from a separate
 * script injected only when the card is shown, so none of it ships in the
 * size-gated Twitch content script.
 */

export type KitFinish = 'glass' | 'etched' | 'halo'

interface KitEmote { readonly cdn: 'twitch' | '7tv'; readonly id: string; readonly aspect?: number }

/**
 * Every emote a Supporter stage may draw. Twitch globals come from Twitch's own
 * CDN; 7TV emotes from 7TV's. Both hosts are already in the extension's host
 * permissions. `aspect` marks the wide emotes (width ÷ height).
 */
export const KIT_EMOTES = {
  Kappa: { cdn: 'twitch', id: '25' },
  LUL: { cdn: 'twitch', id: '425618' },
  PogChamp: { cdn: 'twitch', id: '305954156' },
  Kreygasm: { cdn: 'twitch', id: '41' },
  SeemsGood: { cdn: 'twitch', id: '64138' },
  '4Head': { cdn: 'twitch', id: '354' },
  NotLikeThis: { cdn: 'twitch', id: '58765' },
  HeyGuys: { cdn: 'twitch', id: '30259' },
  wideSpeedLaugh4: { cdn: '7tv', id: '01J7VZYB08000E8DPG2XYMKQYR', aspect: 3.1 },
  wideReacting: { cdn: '7tv', id: '01HMM8VG3R0007GXBD883VP2YY', aspect: 3.3 },
  wideSpeedNod: { cdn: '7tv', id: '01K6YP3JPX47KY68B19S6MY6DY', aspect: 3 },
  // The lab's sample emote, from the 7TV global set: decoration on your line.
  PepePls: { cdn: '7tv', id: '01GAFTZ9K80003DHH026MC7JW0' },
} as const satisfies Record<string, KitEmote>

export type KitEmoteName = keyof typeof KIT_EMOTES

/** Chat's emotes on every stage: the Twitch globals mixed with the wide 7TV emotes. */
export const AMBIENT: ReadonlyArray<KitEmoteName> = ['Kappa', 'LUL', 'PogChamp', 'Kreygasm', 'SeemsGood', '4Head', 'NotLikeThis', 'HeyGuys', 'wideSpeedLaugh4', 'wideReacting', 'wideSpeedNod']

/** The lab's sample kit, shown to anyone who is not (yet) a Supporter. */
export const SAMPLE_KIT = { name: 'you', finish: 'etched', tenure: '12m' } as const satisfies { name: string; finish: KitFinish; tenure: SupporterTenure }

/**
 * The lab's sample emote at the end of your line on the Supporter card. It is
 * decoration, the same for everyone: there is no emote to choose.
 */
export const LINE_EMOTE: KitEmoteName = 'PepePls'

export function isKitEmote(name: unknown): name is KitEmoteName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(KIT_EMOTES, name)
}

export function emoteAspect(name: KitEmoteName): number {
  const emote: KitEmote = KIT_EMOTES[name]
  return emote.aspect ?? 1
}

/** Static frames under reduced motion: 7TV's `2x_static`; Twitch globals are already still. */
export function kitEmoteSrc(name: KitEmoteName, still: boolean): string {
  const emote: KitEmote = KIT_EMOTES[name]
  return emote.cdn === 'twitch'
    ? `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/2.0`
    : `https://cdn.7tv.app/emote/${emote.id}/${still ? '2x_static' : '2x'}.webp`
}

/** The lab's FINISHES: each paint's colour, its rgb, its light core and its moving gradient. */
export const FINISHES: Record<KitFinish, { label: string; c: string; rgb: string; core: string; paint: string }> = {
  glass: { label: 'Glass', c: '#78dce8', rgb: '120, 220, 232', core: '#e3f8fb', paint: 'linear-gradient(100deg, #78dce8 0%, #a5b4fc 22%, #78dce8 40%, #e3f8fb 48%, #ffffff 50%, #e3f8fb 52%, #78dce8 60%, #67e8f9 80%, #78dce8 100%)' },
  etched: { label: 'Etched', c: '#efc96a', rgb: '239, 201, 106', core: '#fdf4dc', paint: 'linear-gradient(100deg, #b8862b 0%, #efc96a 20%, #fff1c2 30%, #d9a441 42%, #fdf4dc 49%, #ffffff 50%, #efc96a 58%, #a87420 76%, #efc96a 100%)' },
  halo: { label: 'Halo', c: '#e6a9d6', rgb: '230, 169, 214', core: '#fbeaf6', paint: 'linear-gradient(100deg, #e6a9d6 0%, #c4b5fd 24%, #e6a9d6 40%, #fbeaf6 48%, #ffffff 50%, #fbeaf6 52%, #fcb69f 66%, #e6a9d6 100%)' },
}

/** A Supporter on the default accent has no paint: their highlight is the free Peak teal. */
const NO_FINISH = { c: '#2dd4bf', rgb: '45, 212, 191', core: '#ccfbf1' }

/** CSS custom properties for a kit's paint colour, read by every stage style. */
export function finishVars(finish: KitFinish | null): Record<'--spk-fin' | '--spk-fin-rgb' | '--spk-fin-core', string> {
  const f = finish ? FINISHES[finish] : NO_FINISH
  return { '--spk-fin': f.c, '--spk-fin-rgb': f.rgb, '--spk-fin-core': f.core }
}

/** The lab's TENURES: each crest stage's name and short label. */
export const TENURES: ReadonlyArray<{ id: SupporterTenure; label: string; short: string; title: string }> = [
  { id: 'new', label: 'New', short: 'New', title: 'First signal' },
  { id: '3m', label: '3 months', short: '3 mo', title: 'Signal set' },
  { id: '6m', label: '6 months', short: '6 mo', title: 'Steady signal' },
  { id: '12m', label: '12 months', short: '12 mo', title: 'Year-one crest' },
  { id: '24m', label: '24 months', short: '24 mo', title: 'Two-year pinnacle' },
]

export const tenureIndex = (id: SupporterTenure | undefined): number => Math.max(0, TENURES.findIndex(stage => stage.id === id))

/**
 * Canned, neutral stream chatter, from the lab with its emote words swapped
 * for this emote set. Never real chat, and no line ever mentions or praises
 * Supporter: perks are stated by Pulse, not by invented viewers.
 */
export const LINES: ReadonlyArray<string> = [
  'that spike was insane', 'CLIP IT', 'LUL LUL LUL', 'chat is cooking', 'W stream', 'no way he hit that wideReacting',
  'Kappa', 'LETSGO', 'the chart called it', 'PogChamp PogChamp', 'SeemsGood SeemsGood SeemsGood', 'peak incoming', '+1', 'wideSpeedLaugh4',
  'Kreygasm', 'run it back', 'chat woke up', 'HeyGuys HeyGuys', 'NotLikeThis', 'GG', 'he is locked in', 'wideSpeedNod', '4Head 4Head',
]
export const NAMES: ReadonlyArray<string> = ['mochi_rx', 'tilted_tom', 'vod_goblin', 'orbit42', 'sleepyyy', 'nightowl', 'pixelpanda', 'clipchimp', 'ramen_cat', 'lowping']
export const NAME_COLORS: ReadonlyArray<string> = ['#ff7f50', '#1e90ff', '#9acd32', '#daa520', '#ff69b4', '#00ff7f', '#5f9ea0', '#d2691e', '#b48cff', '#ff4f4f']

/** The Supporter shown on a stage: the lab sample, or a Supporter's own verified kit. */
export interface Kit {
  name: string
  finish: KitFinish | null
  tenure: SupporterTenure
  /** A Supporter's own wave and sheen: their name is drawn with the header's real paint. */
  paint?: SupporterPaintStyle
}

export const rand = (a: number, b: number): number => a + Math.random() * (b - a)
export const pick = <T,>(list: ReadonlyArray<T>): T => list[Math.floor(Math.random() * list.length)]
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))

/** The lab's `em()`: one emote image at a given height. */
export function emoteImg(name: KitEmoteName, h: number | null, still: boolean): HTMLImageElement {
  const img = document.createElement('img')
  img.alt = ''
  img.draggable = false
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  img.className = 'spk-em'
  img.dataset.em = name
  img.src = kitEmoteSrc(name, still)
  img.onerror = () => { img.style.visibility = 'hidden' }
  // A known width lets a line be measured before the image loads.
  if (h) { img.style.height = `${h}px`; img.style.width = `${Math.round(h * emoteAspect(name))}px` }
  return img
}

/** The lab's `crestSvg()`: the tenure crest, its frame drawn in the kit's paint colour. */
export function crestSvg(tenure: SupporterTenure, size: number, finish: KitFinish | null): string {
  const g = SUPPORTER_CREST_GEMS[tenure]
  const edge = finish ? FINISHES[finish].c : g.edge
  return `<svg width="${size}" height="${size}" viewBox="0 0 18 18" aria-hidden="true"><polygon points="${g.points}" fill="#08080a" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>${g.crown ? `<path d="${g.crown}" fill="none" stroke="#ffe8a6" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"/>` : ''}<path d="${g.rank}" fill="none" stroke="${g.edge}" stroke-width="1.5" stroke-linecap="round"/><path d="${SUPPORTER_CREST_PULSE_PATH}" fill="none" stroke="#fff" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/></svg>`
}

/** The lab's `kitCrest()`. */
export function kitCrest(kit: Kit, size: number, tenure: SupporterTenure = kit.tenure): HTMLSpanElement {
  const s = document.createElement('span')
  s.className = 'spk-crest'
  s.dataset.tenure = tenure
  s.innerHTML = crestSvg(tenure, size, kit.finish)
  return s
}

/**
 * The lab's `kitName()`: the painted name. A Supporter's own name wears the
 * header's real paint (finish, wave and sheen); the sample wears the lab's paint.
 */
export function kitName(kit: Kit): HTMLElement {
  const b = document.createElement('b')
  b.textContent = kit.name
  if (kit.finish && kit.paint) {
    b.className = 'spk-name pulse-paint'
    b.dataset.finish = kit.finish
    b.dataset.wave = kit.paint.wave
    b.dataset.sheen = kit.paint.sheen
    b.dataset.text = kit.name
  } else if (kit.finish) {
    b.className = 'spk-name spk-paint'
    b.style.setProperty('--spk-paint', FINISHES[kit.finish].paint)
  } else {
    b.className = 'spk-name'
  }
  return b
}

/** The lab's `kitEmote()`: the fixed sample emote that ends your line. */
export function lineEmote(h: number, still: boolean): HTMLImageElement {
  const img = emoteImg(LINE_EMOTE, h, still)
  img.classList.add('spk-kit-emote')
  return img
}

/** The lab's `renderWords()`: chat text with emote words drawn as emotes. */
export function renderWords(text: string, h: number, still: boolean): DocumentFragment {
  const frag = document.createDocumentFragment()
  text.split(' ').forEach((word, i) => {
    if (isKitEmote(word)) frag.append(emoteImg(word, h, still))
    else frag.append(document.createTextNode(`${i ? ' ' : ''}${word} `))
  })
  return frag
}
