import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The landing phone menu's "Open Analytics" is a light primary button
 * (.sc-btn--default). A drawer rule that recolours every link must not reach it:
 * #eee on its #fafafa fill measured about 1.06:1 (release review 2026-10-09).
 */
const landing = readFileSync(resolve(process.cwd(), 'src/ui/components/landing/landing.css'), 'utf8')
const tokens = readFileSync(resolve(process.cwd(), 'src/ui/tokens.css'), 'utf8')

function rules(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Array.from(css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g')), (m) => m[1]!)
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

describe('landing phone menu button contrast', () => {
  it('colours only text links in the drawer, never the primary button', () => {
    const shared = rules(landing, '.sl-mobile-nav__links a')
    expect(shared).toHaveLength(1)
    for (const body of shared) expect(body).not.toMatch(/(?:^|;|\s)color\s*:/)
    expect(rules(landing, '.sl-mobile-nav__links a:not(.sc-btn)').join(' ')).toMatch(/color:\s*#eee/)
    for (const body of rules(landing, '.sl-mobile-nav__links a.sc-btn')) {
      expect(body).not.toMatch(/(?:^|;|\s)(?:color|background)\s*:/)
    }
  })

  it('keeps the primary button label at WCAG AA against its own fill', () => {
    const fg = luminanceOfHsl(hslToken('sc-primary-foreground'))
    const bg = luminanceOfHsl(hslToken('sc-primary'))
    const [hi, lo] = [fg, bg].sort((x, y) => y - x)
    expect((hi! + 0.05) / (lo! + 0.05)).toBeGreaterThanOrEqual(4.5)
  })
})
