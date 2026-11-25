import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The phone Menu is one drawer on every page (site-header.css, 11-24). Its text is read on the drawer's own
 * panel, so each link colour is checked against that fill. The landing's light primary button keeps its own
 * check: its label against its fill (release review 2026-10-09).
 */
const header = readFileSync(resolve(process.cwd(), 'src/ui/components/site-header.css'), 'utf8')
const tokens = readFileSync(resolve(process.cwd(), 'src/ui/tokens.css'), 'utf8')

type Rgb = [number, number, number]

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  if (!found) throw new Error(`missing rule ${selector}`)
  return found[1]!
}

function hex(value: string): Rgb {
  let h = value.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
}

/** A colour written as a hex value or as a site token, hsl(var(--sc-name)). */
function colourOf(body: string, property: 'color' | 'background'): Rgb {
  const found = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*(#[0-9a-f]{3,6}|hsl\\(var\\(--([a-z-]+)\\)\\))\\s*;`, 'i').exec(body)
  if (!found) throw new Error(`no ${property} in ${body}`)
  return found[2] ? rgbOfHsl(hslToken(found[2])) : hex(found[1]!)
}

function rgbOfHsl([h, s, l]: [number, number, number]): Rgb {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [channel(0), channel(8), channel(4)]
}

function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

function hslToken(name: string): [number, number, number] {
  const match = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(tokens)
  if (!match) throw new Error(`missing token ${name}`)
  return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100]
}

function luminanceOfHsl([h, s, l]: [number, number, number]): number {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4)
}

describe('phone menu contrast', () => {
  const panel = colourOf(rule(header, '.site-menu__panel'), 'background')

  it('reads the pages and the site information at WCAG AA on the drawer', () => {
    for (const selector of ['.site-menu .site-menu__main a', '.site-menu .site-menu__more a']) {
      expect(contrast(colourOf(rule(header, selector), 'color'), panel), selector).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the current page white on its lighter pill', () => {
    const body = rule(header, '.site-menu .site-menu__main a[aria-current]')
    expect(body).toMatch(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.08\)/)
    const pill = panel.map((v) => v * 0.92 + 255 * 0.08) as Rgb
    expect(contrast(colourOf(body, 'color'), pill)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('landing primary button contrast', () => {
  it('keeps the primary button label at WCAG AA against its own fill', () => {
    const fg = luminanceOfHsl(hslToken('sc-primary-foreground'))
    const bg = luminanceOfHsl(hslToken('sc-primary'))
    const [hi, lo] = [fg, bg].sort((x, y) => y - x)
    expect((hi! + 0.05) / (lo! + 0.05)).toBeGreaterThanOrEqual(4.5)
  })
})
