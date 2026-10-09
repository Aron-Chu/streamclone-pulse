import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/analytics/analytics-compact.css'), 'utf8')

describe('stream page stat cards', () => {
  it('keeps the wide one-line stat row a row although the card is a column flex', () => {
    // StatCard is `flex flex-col` with the value at `mt-auto pt-1`, so values
    // share a bottom line when a label wraps. The wide layout puts label and
    // value on one line and must override both.
    expect(css).toMatch(/\[data-session-stat-row\] > \.sc-stat-card \{[^}]*display: flex;[^}]*flex-direction: row;/)
    expect(css).toMatch(/\[data-session-stat-row\] \.sc-stat-card__value \{[^}]*margin-top: 0;[^}]*padding-top: 0;/)
  })
})
