import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/charts/sp-session-page.css'), 'utf8')
const PENDING = '.analytics-console .ssp-meta-w[data-session-meta-pending]'
// The reserved rows hold while the first read is out (pending, hidden) and while the status and
// summary reads can still add to the shown line (settling).
const RESERVED = '.analytics-console .ssp-meta-w:is([data-session-meta-pending], [data-session-meta-settling])'
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The reserved meta slot's min-height inside one `@media (max-width: Npx)` block, or null. */
function reservedMinHeightBelow(maxWidth: number): string | null {
  const block = css.match(new RegExp(`@media \\(max-width: ${maxWidth}px\\) \\{([^@]*?)\\n\\}`))?.[1] ?? ''
  const rule = block.match(new RegExp(`${escape(RESERVED)} \\{([^}]*)\\}`))?.[1] ?? ''
  return rule.match(/min-height:\s*([^;]+);/)?.[1] ?? null
}

describe('session meta line while its reads are out', () => {
  it('hides the line while the first read is out and reserves its loaded rows: 3 below 394 px, 2 up to 777 px, 1 from 778 px', () => {
    // 24 px rows with 2 px row gaps (.ssp-meta row-gap, .mi min-height).
    expect(css).toMatch(/\.analytics-console \.ssp-meta \{[^}]*row-gap: 2px;/)
    expect(css).toMatch(/\.analytics-console \.ssp-meta > \.mi \{[^}]*min-height: 24px;/)
    const base = css.match(/\.analytics-console \.ssp-meta-w\[data-session-meta-pending\] \{([^}]*)\}/)?.[1] ?? ''
    expect(base).toContain('visibility: hidden;')
    expect(base).not.toContain('min-height')
    expect(reservedMinHeightBelow(393)).toBe('76px')
    expect(reservedMinHeightBelow(777)).toBe('50px')
    // The 3-row rule comes after the 2-row rule, so it wins below 394 px.
    expect(css.indexOf('@media (max-width: 393px)')).toBeGreaterThan(css.indexOf('@media (max-width: 777px)'))
  })

  it('keeps the settling line visible: only the pending line is hidden', () => {
    expect([...css.matchAll(/([^{}\n]*\.ssp-meta-w[^{}\n]*)\{[^}]*visibility: hidden/g)].map(m => m[1].trim())).toEqual([PENDING])
  })

  it('reserves rows only while pending or settling, never on the settled line', () => {
    const reservations = [...css.matchAll(/([^{}\n]*\.ssp-meta-w[^{}\n]*)\{[^}]*min-height/g)].map(m => m[1].trim())
    expect(reservations).toEqual([RESERVED, RESERVED])
  })
})
