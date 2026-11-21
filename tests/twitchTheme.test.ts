// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transform } from 'lightningcss'
import { describe, expect, it } from 'vitest'
import { twitchTheme } from '../src/content/mount.tsx'
import { CHAT_STACK_CSS, EMOTE_PILE_CSS } from '../src/supporter/styles.ts'
import { CHART_LANE, CHART_SIGNAL, CHART_THEME } from '../src/ui/chartTheme.ts'
import { overlayBaseStyles } from '../src/ui/overlayStyles.ts'
import { ACCENT_PALETTES } from '../src/ui/overlayTheme.ts'
import { ink, shadowStyles, tone } from '../src/ui/theme.ts'
import {
  LIGHT_ACCENT_INKS,
  LIGHT_CHART_SVG,
  LIGHT_HOST,
  LIGHT_INK_GROUND,
  collectLightTokens,
  contrast as lightContrast,
  lightTokenName,
  over as lightOver,
  parseColour,
  twitchLightCss,
} from '../src/ui/twitchLightTheme.ts'

type Rgb = [number, number, number]
const hex = (value: string): Rgb => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as Rgb
const over = ([r, g, b]: Rgb, alpha: number, base: Rgb): Rgb => [r * alpha + base[0] * (1 - alpha), g * alpha + base[1] * (1 - alpha), b * alpha + base[2] * (1 - alpha)]
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgb, b: Rgb) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
/** Declarations of the single light-theme rule whose selector ends with `selector`. */
function lightRule(selector: string): Record<string, string> {
  const rules = [...shadowStyles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, head]) => head.split(',').some(part => part.trim() === `:host([data-twitch-theme="light"]) ${selector}`))
  expect(rules).toHaveLength(1)
  return Object.fromEntries(rules[0][2].split(';').map(d => d.split(':').map(v => v.trim())).filter(([k, v]) => k && v))
}
const rgba = (value: string): [Rgb, number] => {
  const [r, g, b, a] = value.match(/rgba\(([^)]+)\)/)![1].split(',').map(Number)
  return [[r, g, b], a]
}

describe('Twitch theme mirroring', () => {
  it('reads Twitch light and dark root classes, defaulting to dark', () => {
    const root = document.createElement('html')
    expect(twitchTheme(root)).toBe('dark')
    root.className = 'tw-root--hover tw-root--theme-light'
    expect(twitchTheme(root)).toBe('light')
    root.className = 'tw-root--theme-dark'
    expect(twitchTheme(root)).toBe('dark')
  })
})

describe('light Twitch tab row', () => {
  // Twitch light surfaces: #ffffff page, #f7f7f8 alternate. Check the darker.
  const header = hex('#f7f7f8')
  const [trackColor, trackAlpha] = rgba(lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tabs-compact').background)
  const track = over(trackColor, trackAlpha, header)

  it('scopes the overrides to the tab row', () => {
    for (const rule of shadowStyles.match(/:host\(\[data-twitch-theme="light"\]\)[^{,]*/g) ?? []) {
      expect(rule).toMatch(/\.pulse-sidebar-(header-edge|header-tabs)/)
    }
  })

  it('keeps labels at AA text contrast on the track, idle and hovered', () => {
    expect(contrast(hex(lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tab').color), track)).toBeGreaterThanOrEqual(4.5)
    const hover = lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tab:not(.active):hover:not(:disabled)')
    expect(contrast(hex(hover.color), over(...rgba(hover.background), track))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps edge icons and their states at AA non-text contrast', () => {
    expect(contrast(hex(lightRule('.pulse-sidebar-header-edge').color), header)).toBeGreaterThanOrEqual(3)
    const hover = lightRule('.pulse-sidebar-header-edge:hover')
    expect(contrast(hex(hover.color), over(...rgba(hover.background), header))).toBeGreaterThanOrEqual(3)
    const pressed = lightRule('.pulse-sidebar-header-edge-active')
    expect(pressed.color).toBe('#0e0e10')
    const ring = rgba(pressed['box-shadow'])
    for (const palette of Object.values(ACCENT_PALETTES)) {
      const fill = over(hex(palette.accent), 0.18, header)
      expect(contrast(hex(pressed.color), fill)).toBeGreaterThanOrEqual(3)
      expect(contrast(over(...ring, fill), header)).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the active accent pill readable and outlined for every accent', () => {
    const active = lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tab.active')
    expect(active.color).toContain('--pulse-on-accent')
    const ring = rgba(active['box-shadow'])
    for (const palette of Object.values(ACCENT_PALETTES)) {
      const pill = hex(palette.accentStrong)
      expect(contrast(hex(palette.onAccent), pill)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(over(...ring, pill), track)).toBeGreaterThanOrEqual(3)
    }
    expect(shadowStyles).toContain(':is(:host, .pulse-host, .pl-library)')
  })
})

// ---- the light panel (shadow.css, outside the twitch.js cap) ----

const minify = (code: string) => transform({ filename: 'light.css', code: Buffer.from(code), minify: true, targets: { chrome: 109 << 16, firefox: 115 << 16 } }).code.toString()
const SRC = resolve(__dirname, '../src')
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}
// As vite.content.config.ts builds it.
const injected = ['content/catchMeUp.ts', 'content/momentFrames.ts']
  .map(file => /^const CSS = `([\s\S]*?)^`/m.exec(readFileSync(resolve(SRC, file), 'utf8'))![1])
  .join('') + CHAT_STACK_CSS + EMOTE_PILE_CSS
const tokens = { tone: new Set<string>(), ink: new Set<string>() }
for (const file of sourceFiles()) collectLightTokens(readFileSync(file, 'utf8'), tokens)
const lightCssRaw = twitchLightCss({ css: minify(overlayBaseStyles) + minify(shadowStyles) + minify(injected), tokens })
const lightCss = minify(lightCssRaw)
const PANEL_HOST = `:host(${LIGHT_HOST})`

/** A selector list split at its top-level commas. */
function selectorParts(list: string): string[] {
  const parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < list.length; i++) {
    if ('(['.includes(list[i])) depth++
    else if (')]'.includes(list[i])) depth--
    else if (list[i] === ',' && depth === 0) { parts.push(list.slice(start, i)); start = i + 1 }
  }
  return [...parts, list.slice(start)]
}

/** Style rules of a minified stylesheet, @media bodies included. */
function styleRules(css: string): { selector: string; decls: Record<string, string> }[] {
  const out: { selector: string; decls: Record<string, string> }[] = []
  let start = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '}') { start = i + 1; continue }
    if (css[i] !== '{') continue
    const head = css.slice(start, i).trim()
    start = i + 1
    if (head.startsWith('@')) continue
    const end = css.indexOf('}', i)
    const decls = Object.fromEntries(css.slice(i + 1, end).split(';')
      .map(d => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()])
      .filter(([k]) => k))
    out.push({ selector: head, decls })
    i = end
    start = end + 1
  }
  return out
}
const rules = styleRules(lightCss)
const hostTokens: Record<string, string> = Object.assign({}, ...rules.filter(rule => rule.selector === PANEL_HOST).map(rule => rule.decls))
/** The light twin(s) for a dark selector, merged in cascade order. */
function twin(selector: string): Record<string, string> {
  const found = rules.filter(rule => selectorParts(rule.selector).some(part => part === `${PANEL_HOST} ${selector}`))
  expect(found.length, selector).toBeGreaterThan(0)
  return Object.assign({}, ...found.map(rule => rule.decls))
}
const rgbOf = (value: string) => parseColour(value)!.rgb

describe('light Pulse panel', () => {
  it('scopes every light rule to the light panel host', () => {
    expect(rules.length).toBeGreaterThan(100)
    for (const { selector } of rules) {
      for (const part of selectorParts(selector)) expect(part.startsWith(':host(#streamclone-pulse-root'), part).toBe(true)
    }
  })

  it('leaves the hand-made tab block alone and repeats it at panel-host strength', () => {
    expect(twin('.pulse-sidebar-header-tabs .pulse-sidebar-tab').color).toBe(lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tab').color)
  })

  it('paints Twitch light grounds and inks for the named tokens', () => {
    expect(hostTokens[lightTokenName('tone', '#0b0b0f')]).toBe('#fff')
    expect(hostTokens[lightTokenName('tone', '#18181b')]).toBe('#f7f7f8')
    expect(hostTokens[lightTokenName('tone', '#262633')]).toBe('#efeff1')
    expect(hostTokens[lightTokenName('ink', '#fafafc')]).toBe('#0e0e10')
    expect(hostTokens[lightTokenName('ink', '#a1a1b2')]).toBe('#53535f')
    expect(hostTokens['--pulse-chart-bg']).toBe('#f7f7f8')
  })

  it('keeps every ink token at 4.5:1 on the darkest light ground', () => {
    expect(tokens.ink.size).toBeGreaterThan(10)
    for (const colour of tokens.ink) {
      const value = parseColour(hostTokens[lightTokenName('ink', colour)])!
      if (value.a < 0.6) continue // faint placeholder-style text stays faint
      expect(lightContrast(lightOver(value, LIGHT_INK_GROUND), LIGHT_INK_GROUND), colour).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives every accent light inks at 4.5:1 on the darkest light ground', () => {
    expect(Object.keys(LIGHT_ACCENT_INKS).sort()).toEqual(Object.keys(ACCENT_PALETTES).sort())
    for (const [accent, inks] of Object.entries(LIGHT_ACCENT_INKS)) {
      for (const value of Object.values(inks)) expect(lightContrast(rgbOf(value), LIGHT_INK_GROUND), `${accent} ${value}`).toBeGreaterThanOrEqual(4.5)
      const selector = accent === 'aurora' ? PANEL_HOST : `:host(${LIGHT_HOST}[data-pulse-accent=${accent}])`
      const decls: Record<string, string> = Object.assign({}, ...rules.filter(rule => rule.selector === selector).map(rule => rule.decls))
      expect(decls['--pulse-accent-ink']).toBe(inks.ink)
    }
  })

  it('keeps white on brand fills and dark scrims on pictures', () => {
    expect(twin('.pulse-hub-discord').color).toBe('#fff')
    const badge = twin('.pulse-clip-duration')
    expect(badge.color).toBe('#fafafc')
    expect(parseColour(badge.background)).toEqual({ rgb: [0, 0, 0], a: 0.8 })
    expect(twin('.pmf-chip').color).toBe('#fff')
  })

  it('darkens the chart lanes to 3:1 on the chart ground and keeps axis text at 4.5:1', () => {
    const ground = rgbOf('#f7f7f8')
    for (const key of [CHART_SIGNAL.viewers, CHART_SIGNAL.chat, CHART_LANE.chatTrend, CHART_SIGNAL.emotes, CHART_SIGNAL.heat, CHART_SIGNAL.game, CHART_SIGNAL.live, ...CHART_THEME.perEmotePalette]) {
      expect(LIGHT_CHART_SVG[key], key).toBeDefined()
      expect(lightContrast(rgbOf(LIGHT_CHART_SVG[key]), ground), key).toBeGreaterThanOrEqual(3)
    }
    // The highlighted game segment's edges carry alpha, so measure them composited.
    for (const key of ['rgba(249, 115, 22, 0.95)', 'rgba(249, 115, 22, 0.7)']) {
      expect(LIGHT_CHART_SVG[key], key).toBeDefined()
      expect(lightContrast(lightOver(parseColour(LIGHT_CHART_SVG[key])!, ground), ground), key).toBeGreaterThanOrEqual(3)
    }
    expect(lightContrast(rgbOf(LIGHT_CHART_SVG['rgba(161, 161, 170, 0.95)']), ground)).toBeGreaterThanOrEqual(4.5)
    // The live metric icons set stroke on the <svg> itself, so the rule matches it as well as its children.
    expect(lightCssRaw).toContain(`${PANEL_HOST} svg[stroke="${CHART_SIGNAL.viewers}"],${PANEL_HOST} svg [stroke="${CHART_SIGNAL.viewers}"]{stroke:${LIGHT_CHART_SVG[CHART_SIGNAL.viewers]}}`)
  })

  it('only overrides SVG values that src still renders', () => {
    const source = sourceFiles().map(file => readFileSync(file, 'utf8')).join('\n')
    for (const key of Object.keys(LIGHT_CHART_SVG)) expect(source, key).toContain(key)
  })

  it('names each token as the runtime helpers do, falling back to the dark literal', () => {
    expect(tone('#18181b')).toBe(`var(${lightTokenName('tone', '#18181b')}, #18181b)`)
    expect(ink('rgba(187, 247, 208, 0.95)')).toBe(`var(${lightTokenName('ink', 'rgba(187, 247, 208, 0.95)')}, rgba(187, 247, 208, 0.95))`)
  })

  it('passes a colour literal to every tone() and ink() call in src', () => {
    for (const file of sourceFiles()) {
      if (file.endsWith('twitchLightTheme.ts')) continue
      const text = readFileSync(file, 'utf8')
      const calls = text.match(/\b(tone|ink)\(/g)?.length ?? 0
      const literal = text.match(/\b(tone|ink)\(\s*(['"])[^'"]+\2\s*\)/g)?.length ?? 0
      expect(literal, file).toBe(calls)
    }
  })
})
