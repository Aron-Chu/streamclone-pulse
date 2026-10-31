import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/hub/v5/hub-v5.css'), 'utf8')

/** The rules inside every `@media (max-width: 719px)` block, joined. */
const phone = [...css.matchAll(/@media \(max-width: 719px\) \{([^@]*?)\n\}/g)].map(m => m[1]).join('\n')

describe('the phone peek while it waits (U6, 10-28)', () => {
  it('keeps the height of its head and three rows, so they land without a shift', () => {
    // The head is border-box: its 1 px rule and 4 px padding, the 22 px heading, then the 16 px age line on its own
    // line (10-30); each phone row is 52 px and its 1 px rule.
    expect(css).toMatch(/\.hv5-rh \{[^}]*min-height: 40px;[^}]*border-top: 1px[^}]*padding-top: 4px;/)
    expect(css).toMatch(/\.hub-v5 :is\([^)]*\.hv5-f3-peek[^)]*\) :is\(\*, \*::before, \*::after\),[^{]*\{\s*box-sizing: border-box;/)
    expect(css).toMatch(/\n\.hv5-top \.hv5-rh \{ flex: none; flex-wrap: wrap; row-gap: 0; \}/)
    expect(css).toMatch(/\n\.hv5-top \.hv5-rh h2 \{ line-height: 22px; \}/)
    expect(css).toMatch(/\n\.hv5-top \.hv5-rh \.hv5-f2-fresh \{ order: 1; flex-basis: 100%; min-height: 16px;/)
    expect(css).toMatch(/\n\.hv5-f2-fresh \{[^}]*font: 500 12px\/16px/)
    expect(css).toMatch(/\n\.hv5-tm-it \{ border-bottom: 1px solid/)
    expect(phone).toMatch(/\.hub-v5 \.hv5-top \.hv5-tm-row \{ min-height: 52px; \}/)
    expect(phone).toMatch(/\.hv5-f3-peek\[data-wait\] \{ min-height: 202px; \}/)
    expect(1 + 4 + 22 + 16 + 3 * (52 + 1)).toBe(202)
  })

  it('reserves it only while waiting, and only on phones', () => {
    const reservations = [...css.matchAll(/([^{}\n]*\.hv5-f3-peek[^{}\n]*)\{[^}]*min-height/g)].map(m => m[1].trim())
    expect(reservations).toEqual(['.hv5-f3-peek[data-wait]'])
    expect(css.split('[data-wait]')).toHaveLength(2)
    expect(phone).toContain('.hv5-f3-peek[data-wait]')
  })
})

describe('the rail’s head, chips and links (10-30)', () => {
  it('keeps the head and the chips whole in the sticky column when the rows overflow', () => {
    // both sit in the >= 1536 px flex column above the scrolling rows; the chips are a scroll box (min-height 0)
    expect(css).toMatch(/\.hv5-feed\.hv5-top \{ display: flex; flex-direction: column;/)
    expect(css).toMatch(/\n\.hv5-top \.hv5-rh \{ flex: none;/)
    expect(css).toMatch(/\n\.hv5-tm-games \{ flex: none;/)
  })

  it('brings the rail and its rows up under the phone nav, not behind it', () => {
    expect(phone).toMatch(/\.hub-v5 :is\(#latest, \.hv5-tm-it\) \{ scroll-margin-top: 112px; \}/)
  })

  it('wraps the last line’s link as one piece, its arrow with it', () => {
    expect(css).toMatch(/\.hub-v5 \.hv5-top \.hv5-tm-lnk \{[^}]*white-space: nowrap;/)
  })
})
