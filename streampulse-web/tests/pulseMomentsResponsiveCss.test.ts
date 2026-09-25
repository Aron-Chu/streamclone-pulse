import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  resolve(process.cwd(), 'src/ui/components/analytics/figma-analytics.css'),
  'utf8',
)

describe('Pulse Moments responsive CSS contract', () => {
  it('gives filters and inspector actions a 44px minimum target', () => {
    expect(css).toMatch(/\.pulse-moments-live__filter\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.pulse-moments__inspector \.hub-openbtn\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.pulse-moments__info-btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s)
  })
})
