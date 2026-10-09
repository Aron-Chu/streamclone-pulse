import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/analytics/analytics-compact.css'), 'utf8')
const streamBlock = css.slice(css.indexOf('Stream page: fit the session timeline'))

describe('stream page compact layout CSS (option)', () => {
  it('is desktop-only: a 1100px media block plus a stat row that needs 105rem', () => {
    expect(streamBlock.length).toBeGreaterThan(0)
    expect(streamBlock).toMatch(/@media \(min-width: 1100px\)/)
    expect(streamBlock).toMatch(/\[data-session-stat-row\] \{\s*container-type: inline-size;/)
    // Card layout changes only inside the container query, never for every card.
    expect(streamBlock).toMatch(/@container \(min-width: 105rem\) \{\s*\.sc-analytics-console \[data-session-stat-row\] > \.sc-stat-card/)
    const outsideQueries = streamBlock.replace(/@(?:media|container)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    expect(outsideQueries).not.toMatch(/sc-stat-card|data-games-played|data-chart-|data-session-status-row/)
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
      '.sc-analytics-console [data-session-stat-row] > .sc-stat-card',
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
