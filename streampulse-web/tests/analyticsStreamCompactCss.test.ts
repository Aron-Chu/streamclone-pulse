import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/analytics/analytics-compact.css'), 'utf8')
const streamBlock = css.slice(css.indexOf('Stream page: fit the session timeline'))

describe('stream page compact layout CSS (option)', () => {
  it('lives in one desktop-only block', () => {
    expect(streamBlock.length).toBeGreaterThan(0)
    expect(streamBlock).toMatch(/@media \(min-width: 1100px\)/)
    // Nothing in the block applies outside the desktop media query.
    const afterMedia = streamBlock.slice(streamBlock.indexOf('@media'))
    expect(afterMedia.trimEnd().endsWith('}')).toBe(true)
  })

  it('rearranges rows without zoom, transforms or font changes', () => {
    expect(streamBlock).not.toMatch(/\bzoom\s*:/)
    expect(streamBlock).not.toMatch(/\btransform\s*:/)
    expect(streamBlock).not.toMatch(/\bscale\(/)
    expect(streamBlock).not.toMatch(/font-size\s*:/)
    expect(streamBlock).not.toMatch(/min-height:\s*(?:[0-3]?\d|4[0-3])px/)
  })

  it('covers the rows it promises to merge', () => {
    for (const selector of [
      '.sc-analytics-console .sc-stat-card',
      '.sc-analytics-console [data-session-status-row]',
      '.sc-analytics-console [data-games-played]',
      '.sc-analytics-console [data-chart-focus-bar] > [data-chart-overlay-focus-row]',
      '.sc-analytics-console [data-chart-header-block]',
    ]) {
      expect(streamBlock).toContain(selector)
    }
    // The games strip keeps room for its 70px box-art targets.
    expect(streamBlock).toMatch(/\[data-games-played-track\][^}]*min-height:\s*72px/)
  })
})
