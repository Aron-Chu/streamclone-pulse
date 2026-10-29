import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/hub/v5/hub-v5.css'), 'utf8')

/** The rules inside every `@media (max-width: 719px)` block, joined. */
const phone = [...css.matchAll(/@media \(max-width: 719px\) \{([^@]*?)\n\}/g)].map(m => m[1]).join('\n')

describe('the phone peek while it waits (U6, 10-28)', () => {
  it('keeps the height of its head and three rows, so they land without a shift', () => {
    // The head is 40 px with its border and padding inside (border-box), each phone row 56 px.
    expect(css).toMatch(/\.hv5-rh \{[^}]*min-height: 40px;[^}]*border-top: 1px[^}]*padding-top: 4px;/)
    expect(css).toMatch(/\.hub-v5 :is\([^)]*\.hv5-f3-peek[^)]*\) :is\(\*, \*::before, \*::after\),[^{]*\{\s*box-sizing: border-box;/)
    expect(phone).toMatch(/\.hub-v5 :is\(\.hv5-feed, \.hv5-f3-peek\) \.hv5-fd \{ height: 56px; \}/)
    expect(phone).toMatch(/\.hv5-f3-peek\[data-wait\] \{ min-height: 208px; \}/)
    expect(40 + 3 * 56).toBe(208)
  })

  it('reserves it only while waiting, and only on phones', () => {
    const reservations = [...css.matchAll(/([^{}\n]*\.hv5-f3-peek[^{}\n]*)\{[^}]*min-height/g)].map(m => m[1].trim())
    expect(reservations).toEqual(['.hv5-f3-peek[data-wait]'])
    expect(css.split('[data-wait]')).toHaveLength(2)
    expect(phone).toContain('.hv5-f3-peek[data-wait]')
  })
})
