import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * WCAG 1.4.3 for the /support card's small and placeholder text. The
 * backgrounds are the ones measured on the page: the page behind the Discord
 * line (rgb(14, 12, 19)) and the inputs' own fill.
 */
const css = readFileSync(resolve(process.cwd(), 'src/routes/public/support.css'), 'utf8')

function colorOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  const color = rule && /(?:^|;|\s)color:\s*(#[0-9a-fA-F]{6})/.exec(rule[1]!)
  if (!color) throw new Error(`no hex color for ${selector}`)
  return color[1]!
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('/support text contrast', () => {
  it.each([
    { selector: '.support-discord-line small', background: '#0e0c13' },
    { selector: '.feedback-input::placeholder', background: '#09090b' },
    { selector: '.feedback-public__note', background: '#121218' },
    { selector: '.support-page__aside', background: '#0e0c13' },
    { selector: '.feedback-card__private', background: '#121218' },
  ])('$selector is at least 4.5:1 on $background', ({ selector, background }) => {
    expect(contrast(colorOf(selector), background)).toBeGreaterThanOrEqual(4.5)
  })

  it('reads the inputs’ background from the stylesheet it checks against', () => {
    expect(/\.feedback-input \{[^}]*background: #09090b;/.test(css)).toBe(true)
  })
})
