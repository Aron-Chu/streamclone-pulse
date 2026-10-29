import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/charts/sp-session-page.css'), 'utf8')
const PENDING = '.analytics-console .ssp-meta-w[data-session-meta-pending]'

/** The pending meta slot's min-height inside one `@media (max-width: Npx)` block, or null. */
function pendingMinHeightBelow(maxWidth: number): string | null {
  const block = css.match(new RegExp(`@media \\(max-width: ${maxWidth}px\\) \\{([^@]*?)\\n\\}`))?.[1] ?? ''
  const rule = block.match(/\.analytics-console \.ssp-meta-w\[data-session-meta-pending\] \{([^}]*)\}/)?.[1] ?? ''
  return rule.match(/min-height:\s*([^;]+);/)?.[1] ?? null
}

describe('session meta line while the first read is out', () => {
  it('hides the line and reserves its loaded rows: 3 below 456 px, 2 up to 797 px, 1 from 798 px', () => {
    // 24 px rows with 2 px row gaps (.ssp-meta row-gap, .mi min-height).
    expect(css).toMatch(/\.analytics-console \.ssp-meta \{[^}]*row-gap: 2px;/)
    expect(css).toMatch(/\.analytics-console \.ssp-meta > \.mi \{[^}]*min-height: 24px;/)
    const base = css.match(/\.analytics-console \.ssp-meta-w\[data-session-meta-pending\] \{([^}]*)\}/)?.[1] ?? ''
    expect(base).toContain('visibility: hidden;')
    expect(base).not.toContain('min-height')
    expect(pendingMinHeightBelow(455)).toBe('76px')
    expect(pendingMinHeightBelow(797)).toBe('50px')
    // The 3-row rule comes after the 2-row rule, so it wins below 456 px.
    expect(css.indexOf('@media (max-width: 455px)')).toBeGreaterThan(css.indexOf('@media (max-width: 797px)'))
  })

  it('reserves rows only while pending, never on the loaded line', () => {
    const reservations = [...css.matchAll(/([^{}\n]*\.ssp-meta-w[^{}\n]*)\{[^}]*min-height/g)].map(m => m[1].trim())
    expect(reservations).toEqual([PENDING, PENDING])
  })
})
