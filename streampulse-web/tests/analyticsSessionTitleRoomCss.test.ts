import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/charts/sp-session-page.css'), 'utf8')
const H1 = '.analytics-console[data-analytics-console-shell] header[data-session-header] h1.ssp-h1'
const STATUS = `${H1}:not([data-channel-name])`
const NAME = `${H1}[data-channel-name]`

function escape(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The declarations of `selector` inside one `@media (max-width: Npx)` block, or ''. */
function ruleBelow(maxWidth: number, selector: string): string {
  const block = css.match(new RegExp(`@media \\(max-width: ${maxWidth}px\\) \\{([^@]*?)\\n\\}`))?.[1] ?? ''
  return block.match(new RegExp(`${escape(selector)} \\{([^}]*)\\}`))?.[1] ?? ''
}

describe('session heading on phones', () => {
  it('keeps room for two lines below 640 px (2 x the 1.08 line height) for a status heading', () => {
    expect(css).toMatch(new RegExp(`${escape(H1)} \\{[^}]*line-height: 1\\.08;`))
    expect(ruleBelow(639, STATUS)).toMatch(/min-height:\s*2\.16em;/)
    expect(ruleBelow(639, H1)).not.toMatch(/min-height/)
  })

  it('reserves it for the status headings only (not recorded, not found, an error), and only on phones', () => {
    const reservations = [...css.matchAll(/([^{}\n]*h1\.ssp-h1[^{}\n]*)\{[^}]*min-height/g)].map(m => m[1].trim())
    expect(reservations).toEqual([STATUS])
    expect(css).not.toContain('data-session-title')
  })
})

describe('channel name heading (C1, 11-11)', () => {
  it('is one line, cut with an ellipsis, beside the picture', () => {
    const name = css.match(new RegExp(`${escape(NAME)} \\{([^}]*)\\}`))?.[1] ?? ''
    expect(name).toContain('white-space: nowrap;')
    expect(name).toContain('text-overflow: ellipsis;')
    expect(name).toContain('overflow: hidden;')
  })

  it('puts the stream title on one grey line that keeps its slot', () => {
    const title = css.match(/header\[data-session-header\] > \.ssp-title \{([^}]*)\}/)?.[1] ?? ''
    expect(title).toContain('white-space: nowrap;')
    expect(title).toContain('text-overflow: ellipsis;')
    expect(title).toMatch(/min-height: 22px;/)
  })
})
