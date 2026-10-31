import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/charts/sp-session-page.css'), 'utf8')
const H1 = '.analytics-console[data-analytics-console-shell] header[data-session-header] h1.ssp-h1'

function escape(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The declarations of `selector` inside one `@media (max-width: Npx)` block, or ''. */
function ruleBelow(maxWidth: number, selector: string): string {
  const block = css.match(new RegExp(`@media \\(max-width: ${maxWidth}px\\) \\{([^@]*?)\\n\\}`))?.[1] ?? ''
  return block.match(new RegExp(`${escape(selector)} \\{([^}]*)\\}`))?.[1] ?? ''
}

describe('session heading on phones', () => {
  it('keeps room for two title lines below 640 px (2 x the 1.08 line height)', () => {
    expect(css).toMatch(new RegExp(`${escape(H1)} \\{[^}]*line-height: 1\\.08;`))
    expect(ruleBelow(639, H1)).toMatch(/min-height:\s*2\.16em;/)
  })

  it('reserves it for every heading the h1 shows (stream, not-recorded, error), and only on phones', () => {
    const reservations = [...css.matchAll(/([^{}\n]*h1\.ssp-h1[^{}\n]*)\{[^}]*min-height/g)].map(m => m[1].trim())
    expect(reservations).toEqual([H1])
    expect(css).not.toContain('data-session-title')
  })
})
