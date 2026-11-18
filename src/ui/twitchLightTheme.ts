/**
 * Twitch light mode for the Pulse panel, built at build time.
 *
 * vite.content.config.ts appends `twitchLightCss()` to content/shadow.css,
 * which sits outside the content/twitch.js size cap. Runtime code must not
 * import this module; the only runtime pieces are `tone()` / `ink()` in
 * theme.ts and the host attributes mount.tsx keeps in sync.
 *
 * The CSS comes in three parts, in cascade order:
 * 1. A layer derived from the panel's own dark CSS. Every rule that sets a
 *    colour-family property gets a light twin under the panel host, with its
 *    colours remapped, so the light cascade keeps the dark cascade's order and
 *    moves whenever the dark CSS moves.
 * 2. Light values for the `tone()` / `ink()` colours that inline styles use.
 * 3. Hand-written fixes the remap cannot make: accent inks, chart lines.
 *
 * The remap is the one the approved board used (light-panel-board-20261115,
 * option A): dark-panel lightness maps onto Twitch's light ramp (#fff,
 * #f7f7f8, #efeff1, #dedee3, #53535f, #0e0e10). Text colours additionally
 * darken until they keep 4.5:1 on #efeff1, Twitch's darkest light surface.
 */

import { CHART_LANE, CHART_SIGNAL } from './chartTheme.ts'

/** Panel host only: the tab strip host keeps its own hand-made light rules. */
export const LIGHT_HOST = '#streamclone-pulse-root[data-twitch-theme=light]'
const HOST = `:host(${LIGHT_HOST})`
/** Twitch's darkest light surface; every light ink is measured on it. */
export const LIGHT_INK_GROUND: Rgb = [239, 239, 241]
export const LIGHT_INK_MIN_CONTRAST = 4.5

export type Rgb = [number, number, number]
interface Rgba { rgb: Rgb; a: number }

// ---- colour maths (OKLab, as the board's capture tool) ----

const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const toGam = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
}

function toOk([r, g, b]: Rgb): { L: number; C: number; H: number } {
  const lr = toLin(r), lg = toLin(g), lb = toLin(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) }
}

function fromOk(L: number, C: number, H: number): Rgb {
  for (let k = 0; k < 24; k++) {
    const A = C * Math.cos(H), B = C * Math.sin(H)
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    const inGamut = [r, g, b].every(v => v >= -0.001 && v <= 1.001)
    if (inGamut || C < 0.001) return [toGam(r), toGam(g), toGam(b)]
    C *= 0.88
  }
  return [0, 0, 0]
}

// Dark panel lightness -> Twitch light lightness.
const RAMP: [number, number][] = [[0, 1], [0.16, 1], [0.22, 0.977], [0.29, 0.955], [0.38, 0.9], [0.5, 0.74], [0.66, 0.53], [0.73, 0.45], [0.985, 0.17], [1, 0.16]]
function ramp(L: number): number {
  for (let i = 1; i < RAMP.length; i++) {
    if (L <= RAMP[i][0]) {
      const [a, fa] = RAMP[i - 1], [b, fb] = RAMP[i]
      return fa + (fb - fa) * (L - a) / (b - a)
    }
  }
  return 0.16
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export function over({ rgb, a }: Rgba, ground: Rgb): Rgb {
  return rgb.map((c, i) => Math.round(c * a + ground[i] * (1 - a))) as Rgb
}

/** The board's surface remap: grounds, borders, washes, shadows, lines. */
export function remapTone({ rgb, a }: Rgba): Rgba {
  const { L, C, H } = toOk(rgb)
  if (C < 0.035) {
    if (a < 0.999 && L < 0.12) return { rgb, a: a * 0.45 } // shadows and scrims stay dark, lighter
    if (a < 0.999 && L > 0.9) return { rgb: [14, 14, 16], a: Math.min(1, a * 0.9) } // white washes become ink washes
    return { rgb: fromOk(ramp(L), C * 0.5, H), a }
  }
  if (a < 0.6) return { rgb, a } // accent tints read fine on white
  if (L < 0.42) return { rgb: fromOk(ramp(L), Math.min(C * 0.35, 0.03), H), a } // tinted dark surfaces
  if (L > 0.72) return { rgb: fromOk(0.5, C, H), a } // pale tints need ink
  return { rgb, a }
}

/** Text: the surface remap, then darker until it keeps 4.5:1 on #efeff1. */
export function remapInk(color: Rgba): Rgba {
  const mapped = remapTone(color)
  // A faint wash used as text (placeholder, disabled) keeps its faintness.
  if (mapped.a < 0.6) return mapped
  let { rgb } = mapped
  const { L, C, H } = toOk(rgb)
  for (let next = L; contrast(over({ rgb, a: mapped.a }, LIGHT_INK_GROUND), LIGHT_INK_GROUND) < LIGHT_INK_MIN_CONTRAST && next > 0; ) {
    next -= 0.01
    rgb = fromOk(next, C, H)
  }
  return { rgb, a: mapped.a }
}

// ---- parsing and printing colours ----

// One pass, one regex, so a colour this pass wrote is never mapped twice.
const COLOUR_RE = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)|(?<![-\w])(white|black)(?![-\w])/g

export function parseColour(text: string): Rgba | null {
  COLOUR_RE.lastIndex = 0
  const m = COLOUR_RE.exec(text.trim())
  if (!m || m.index !== 0 || m[0].length !== text.trim().length) return null
  return matchToRgba(m)
}

function matchToRgba(m: RegExpExecArray): Rgba {
  const [, hex, r, g, b, alpha, word] = m
  if (hex) {
    const h = hex.length <= 4 ? hex.split('').map(c => c + c).join('') : hex
    const rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb
    return { rgb, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }
  }
  if (r != null) {
    const a = alpha == null ? 1 : alpha.endsWith('%') ? parseFloat(alpha) / 100 : Number(alpha)
    return { rgb: [Number(r), Number(g), Number(b)], a }
  }
  return { rgb: word === 'black' ? [0, 0, 0] : [255, 255, 255], a: 1 }
}

export function formatColour({ rgb, a }: Rgba): string {
  const hex = rgb.map(c => c.toString(16).padStart(2, '0')).join('')
  if (a >= 0.999) return `#${hex}`
  return `rgba(${rgb.join(',')},${Math.round(a * 1000) / 1000})`
}

/** Remaps every colour literal outside var() and url() groups. */
function remapValue(value: string, map: (c: Rgba) => Rgba): string {
  const kept: string[] = []
  const masked = maskGroups(value, kept)
  const mapped = masked.replace(COLOUR_RE, (...args) => formatColour(map(matchToRgba(args as unknown as RegExpExecArray))))
  return mapped.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)])
}

function maskGroups(value: string, kept: string[]): string {
  let out = ''
  for (let i = 0; i < value.length;) {
    const rest = value.slice(i)
    const head = /^(var|url)\(/i.exec(rest)
    if (head && !/[-\w]/.test(value[i - 1] ?? '')) {
      const end = matchingParen(value, i + head[0].length - 1)
      kept.push(value.slice(i, end + 1))
      out += `\u0000${kept.length - 1}\u0000`
      i = end + 1
    } else {
      out += value[i]
      i++
    }
  }
  return out
}

function matchingParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") { i = text.indexOf(ch, i + 1); if (i < 0) break; continue }
    if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return text.length - 1
}

// ---- the derived layer ----

interface Block { prelude: string; body: string }

/** Splits a stylesheet (or a block body) into top-level `prelude { body }` blocks. */
function blocks(css: string): Block[] {
  const out: Block[] = []
  let start = 0, depth = 0, open = -1
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '"' || ch === "'") { i = css.indexOf(ch, i + 1); if (i < 0) break; continue }
    if (ch === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue }
    if (ch === '{') { if (depth++ === 0) open = i }
    else if (ch === '}' && --depth === 0) {
      const prelude = css.slice(start, open).split(';').pop()!.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      out.push({ prelude, body: css.slice(open + 1, i) })
      start = i + 1
    }
  }
  return out
}

function splitTop(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") { i = text.indexOf(ch, i + 1); if (i < 0) break; continue }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts.map(p => p.trim()).filter(Boolean)
}

const COLOUR_FAMILY = /^(color|background(-[\w-]+)?|border(-[\w-]+)?|outline(-[\w-]+)?|box-shadow|text-shadow|fill(-opacity)?|stroke(-[\w-]+)?|stop-color|flood-color|lighting-color|caret-color|accent-color|text-decoration(-[\w-]+)?|text-emphasis(-color)?|column-rule(-[\w-]+)?|-webkit-text-fill-color|-webkit-text-stroke(-[\w-]+)?|scrollbar-color|filter)$/
/**
 * Properties that overlap (a shorthand and its longhands) share a group. A
 * group whose values never change in light mode needs no twins at all; one
 * that changes anywhere gets every declaration twinned, so the light cascade
 * keeps the dark cascade's order.
 */
function colourGroup(prop: string): string | null {
  if (prop.startsWith('--')) return prop
  if (!COLOUR_FAMILY.test(prop) || /^border-(\w+-)*radius$|^border-(collapse|spacing)$/.test(prop)) return null
  const head = /^(-webkit-text-stroke|text-decoration|text-emphasis|column-rule|background|border|outline)/.exec(prop)
  return head ? head[1] : prop
}
const TEXT_PROPS = new Set(['color', '-webkit-text-fill-color'])
const LIGHT_HOST_RE = /:host\(\[data-twitch-theme=["']?light["']?\]\)/
const SKIPPED_AT = /^@(keyframes|-webkit-keyframes|font-face|property|counter-style|page|import|charset|namespace)\b/

/** Prefixes one selector with the light panel host, merging a leading :host. */
export function lightSelector(selector: string): string | null {
  if (/data-twitch-theme/.test(selector)) {
    return LIGHT_HOST_RE.test(selector) ? selector.replace(LIGHT_HOST_RE, HOST) : null
  }
  if (selector.startsWith(':host(')) {
    const end = matchingParen(selector, ':host'.length)
    return `:host(${selector.slice(':host('.length, end)}${LIGHT_HOST})${selector.slice(end + 1)}`
  }
  if (/^:host(?![-\w(])/.test(selector)) return `${HOST}${selector.slice(':host'.length)}`
  if (/^:root\b|^html\b|^body\b/.test(selector)) return null
  return `${HOST} ${selector}`
}

function declarations(body: string): [string, string][] {
  return splitTop(body, ';').flatMap(decl => {
    const colon = decl.indexOf(':')
    return colon > 0 ? [[decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()] as [string, string]] : []
  })
}

function mapFor(prop: string) {
  return TEXT_PROPS.has(prop) ? remapInk : remapTone
}

/** Groups (see colourGroup) with at least one value that light mode changes. */
function changedGroups(css: string, found = new Set<string>()): Set<string> {
  for (const { prelude, body } of blocks(css)) {
    if (prelude.startsWith('@')) { if (!SKIPPED_AT.test(prelude)) changedGroups(body, found); continue }
    for (const [prop, value] of declarations(body)) {
      const group = colourGroup(prop)
      if (group && remapValue(value, mapFor(prop)) !== value) found.add(group)
    }
  }
  return found
}

function overPicture(decls: [string, string][]): boolean {
  // Every black ground or text shadow in the panel's CSS sits on a picture.
  return decls.some(([prop, value]) => /^(background(-color|-image)?|text-shadow)$/.test(prop) &&
    [...maskGroups(value, []).matchAll(COLOUR_RE)].some(m => {
      const { rgb, a } = matchToRgba(m)
      const { L, C } = toOk(rgb)
      return C < 0.035 && L < 0.12 && a >= 0.5
    }))
}

/** The rule's own fill in light mode, when it is one opaque colour. */
function ownFill(decls: [string, string][]): Rgb | null {
  const fill = decls.filter(([prop]) => prop === 'background' || prop === 'background-color').pop()
  const colour = fill && parseColour(fill[1])
  return colour && colour.a >= 0.999 ? remapTone(colour).rgb : null
}

/**
 * Text on its own fill keeps whichever ink reads better on that fill in light
 * mode: white stays on a brand fill the remap leaves alone (Discord, LIVE),
 * while a pale ink on a dark fill that turns light takes the remapped ink.
 */
function inkOn(value: string, fill: Rgb | null): string {
  const colour = parseColour(value)
  const mapped = remapValue(value, remapInk)
  if (!fill || !colour || colour.a < 0.999) return mapped
  const kept = contrast(colour.rgb, fill)
  const next = parseColour(mapped)
  return kept >= LIGHT_INK_MIN_CONTRAST && (!next || kept >= contrast(next.rgb, fill)) ? value : mapped
}

function lightRules(css: string, groups: Set<string>): string {
  let out = ''
  for (const { prelude, body } of blocks(css)) {
    if (prelude.startsWith('@')) {
      if (SKIPPED_AT.test(prelude)) continue
      const inner = lightRules(body, groups)
      if (inner) out += `${prelude}{${inner}}`
      continue
    }
    const selectors = splitTop(prelude, ',')
    const passthrough = selectors.filter(s => /data-twitch-theme/.test(s)).map(lightSelector).filter(Boolean)
    const derived = selectors.filter(s => !/data-twitch-theme/.test(s)).map(lightSelector).filter(Boolean)
    const decls = declarations(body)
    if (passthrough.length && decls.length) {
      out += `${passthrough.join(',')}{${decls.map(([p, v]) => `${p}:${v}`).join(';')}}`
    }
    // A black scrim over a picture (a duration badge, a chip on a still) keeps
    // its dark look and white text, as Twitch's own thumbnail badges do. Its
    // twin repeats the dark values at host strength so no light twin wins.
    const keep = overPicture(decls)
    const fill = ownFill(decls)
    const twins = decls.flatMap(([prop, value]) => {
      const group = colourGroup(prop)
      if (!group || !groups.has(group)) return []
      return [`${prop}:${keep ? value : TEXT_PROPS.has(prop) ? inkOn(value, fill) : remapValue(value, mapFor(prop))}`]
    })
    if (derived.length && twins.length) out += `${derived.join(',')}{${twins.join(';')}}`
  }
  return out
}

/**
 * The derived layer for minified dark CSS (inline base styles first, then the
 * shadow stylesheet, as the shadow root applies them).
 */
export function twitchLightLayer(css: string): string {
  return lightRules(css, changedGroups(css))
}

// ---- tone() / ink() token values ----

const TOKEN_CALL_RE = /\b(tone|ink)\(\s*(['"])([^'"]+)\2\s*\)/g

/** Finds the literal colours passed to tone() and ink() in one source file. */
export function collectLightTokens(source: string, into = { tone: new Set<string>(), ink: new Set<string>() }) {
  for (const m of source.matchAll(TOKEN_CALL_RE)) into[m[1] as 'tone' | 'ink'].add(m[3])
  return into
}

/** Mirrors theme.ts so the build and the runtime agree on each name. */
export const lightTokenName = (kind: 'tone' | 'ink', colour: string) => `--pulse-${kind}-${colour.replace(/\W/g, '')}`

/**
 * Twitch's own light values where a token is one of the panel's named grounds
 * or inks; everything else follows the remap.
 */
export const TWITCH_LIGHT_SNAP: Record<string, string> = {
  '#0b0b0f': '#ffffff', // bgCanvas -> Twitch panel white
  '#18181b': '#f7f7f8', // bg -> Twitch raised grey
  '#262633': '#efeff1', // panel -> Twitch input / track grey
  '#fafafc': '#0e0e10', // textPrimary -> Twitch ink
  '#fafafa': '#0e0e10', // the title's own white -> Twitch ink
  '#a1a1b2': '#53535f', // textSecondary -> Twitch secondary ink
}

export function lightTokenCss(tokens: { tone: Iterable<string>; ink: Iterable<string> }): string {
  const decls: string[] = []
  for (const kind of ['tone', 'ink'] as const) {
    for (const colour of [...tokens[kind]].sort()) {
      const parsed = parseColour(colour)
      if (!parsed) throw new Error(`${kind}('${colour}') is not a colour literal`)
      const snapped = TWITCH_LIGHT_SNAP[colour.toLowerCase()]
      const value = snapped ?? formatColour((kind === 'ink' ? remapInk : remapTone)(parsed))
      decls.push(`${lightTokenName(kind, colour)}:${value}`)
    }
  }
  return decls.length ? `${HOST}{${decls.join(';')}}` : ''
}

// ---- hand-written fixes ----

/**
 * Accent inks for a light ground. The dark palettes' soft / light / ink are
 * pale tints made for #0b0b0f; on white they need the deep end of each hue.
 * Every value keeps 4.5:1 on #efeff1 (tests/twitchTheme.test.ts).
 */
export const LIGHT_ACCENT_INKS = {
  aurora: { ink: '#5b21b6', soft: '#6d28d9', light: '#7c3aed' },
  emerald: { ink: '#065f46', soft: '#047857', light: '#047857' },
  volt: { ink: '#9a3412', soft: '#c2410c', light: '#c2410c' },
  azure: { ink: '#155e75', soft: '#0e7490', light: '#0e7490' },
} as const

const rgbList = (hex: string) => parseColour(hex)!.rgb.join(',')

function accentInkCss(): string {
  return Object.entries(LIGHT_ACCENT_INKS).map(([accent, { ink, soft, light }]) => {
    // Aurora is also the default before the accent attribute lands.
    const selector = accent === 'aurora' ? HOST : `:host(${LIGHT_HOST}[data-pulse-accent=${accent}])`
    return `${selector}{--pulse-accent-ink:${ink};--pulse-accent-soft:${soft};--pulse-accent-light:${light};--pulse-accent-soft-rgb:${rgbList(soft)};--pulse-accent-light-rgb:${rgbList(light)}}`
  }).join('')
}

/** Chart ground and lanes, matched against the board's a-chart mock. */
export const LIGHT_CHART = {
  background: '#f7f7f8',
} as const

/**
 * The chart draws with SVG presentation attributes, which take no var(), so
 * light mode overrides them by their value (CSS beats an attribute). Lanes get
 * the deep end of their hue (lines keep 3:1 on the chart ground); the Viewers
 * tag turns white with a teal edge, as on the board. Each literal key is a value
 * src renders (tests/twitchTheme.test.ts keeps them in step).
 */
export const LIGHT_CHART_SVG: Record<string, string> = {
  [CHART_SIGNAL.viewers]: '#0e7490',
  [CHART_SIGNAL.chat]: '#7c3aed',
  [CHART_LANE.chatTrend]: '#6d28d9',
  [CHART_SIGNAL.emotes]: '#047857',
  [CHART_SIGNAL.heat]: '#b45309',
  [CHART_SIGNAL.game]: '#c2410c',
  [CHART_SIGNAL.live]: '#15803d',
  '#67e8f9': '#0e7490', // viewer moment marker (PulseOverviewChart)
  '#6ee7b7': '#047857', // 7TV lane (chatActivityEmotes)
  '#60a5fa': '#1d4ed8', // BTTV lane
  '#f472b6': '#be185d', // FFZ lane
  // Picked-emote overlay lines (CHART_THEME.perEmotePalette; its amber and
  // green are the heat and live keys above). The rose is also the spike dot.
  '#fb7185': '#e11d48',
  '#38bdf8': '#0369a1',
  '#c084fc': '#9333ea',
  'rgb(8, 15, 24)': '#ffffff', // Viewers tag ground
  'rgba(34, 211, 238, 0.32)': 'rgba(14,116,144,0.4)', // Viewers tag edge
  'rgba(161, 161, 170, 0.95)': '#53535f', // axis labels
}
/** White hairlines and bands become ink washes, by the same remap as the CSS. */
const CHART_SVG_WASHES = ['rgba(255, 255, 255, 0.025)', 'rgba(255,255,255,0.02)', 'rgba(255, 255, 255, 0.08)', 'rgba(255,255,255,0.055)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.10)']

function chartSvgCss(): string {
  const map: [string, string][] = [
    ...Object.entries(LIGHT_CHART_SVG),
    ...CHART_SVG_WASHES.map(v => [v, formatColour(remapTone(parseColour(v)!))] as [string, string]),
  ]
  const attrs = ['fill', 'stroke', 'stop-color']
  // The <svg> itself too: small icons set stroke on it for their children to inherit.
  const rules = map.map(([from, to]) => attrs.map(a => `${HOST} svg[${a}="${from}"],${HOST} svg [${a}="${from}"]{${a}:${to}}`).join('')).join('')
  // The legend's swatches are inline-styled from the same constants, in a
  // fixed order: [viewers], chat, emotes.
  const legend = `${HOST} .pulse-ch-stroke{border-color:${LIGHT_CHART_SVG[CHART_SIGNAL.viewers]}!important}`
    + `${HOST} .pulse-ch-legend>:nth-last-child(2)>.pulse-ch-dot{background:${LIGHT_CHART_SVG[CHART_SIGNAL.chat]}!important}`
    + `${HOST} .pulse-ch-legend>:last-child>.pulse-ch-dot{background:${LIGHT_CHART_SVG[CHART_SIGNAL.emotes]}!important}`
  return rules + legend
}

/**
 * The Supporter card's link takes its colour from the shown paint (--spk-fin,
 * set at runtime by the card's own chunk). Every paint is a pale tint, so light
 * mode mixes it toward Twitch ink; where color-mix is missing (Chrome < 111)
 * the declaration drops to the card's inherited ink.
 */
const SUPPORTER_LINK = `${HOST} .pulse-supporter-cta-head span{color:color-mix(in oklab,var(--spk-fin,#efc96a) 45%,#0e0e10)}`

export function twitchLightOverrides(): string {
  return `${accentInkCss()}${HOST}{--pulse-chart-bg:${LIGHT_CHART.background}}${chartSvgCss()}${SUPPORTER_LINK}`
}

/** Everything content/shadow.css appends for Twitch light mode. */
export function twitchLightCss({ css, tokens }: { css: string; tokens: { tone: Iterable<string>; ink: Iterable<string> } }): string {
  return `${twitchLightLayer(css)}${lightTokenCss(tokens)}${twitchLightOverrides()}`
}
