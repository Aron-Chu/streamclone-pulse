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

  it('trims status-row padding only on a lifecycle row that holds a 44px link', () => {
    // A blanket rule turned a lone coverage notice into a ~20px strip.
    expect(streamBlock).not.toMatch(/\[data-session-status-row\] > \* \{[^}]*padding/)
    expect(streamBlock).toMatch(/\[data-session-status-row\] > \[data-session-lifecycle-row\]\[data-has-action\] \{\s*padding-block: 0\.125rem;/)
  })

  it('shows the hovered or pinned game in full under the label without sizing the strip', () => {
    const details = streamBlock.match(/\[data-games-played\] > \[data-games-played-details\] \{([^}]*)\}/)?.[1] ?? ''
    // Positioned inside its grid area: it never grows the strip, so the plot cannot move.
    expect(streamBlock).toMatch(/\.sc-analytics-console \[data-games-played\] \{\s*position: relative;/)
    expect(details).toMatch(/position: absolute;/)
    // Explicit end lines: an absolute grid item's auto end is the strip's edge, so it would cover the art.
    expect(details).toMatch(/grid-column: 1 \/ 2;/)
    expect(details).toMatch(/grid-row: 2 \/ 3;/)
    expect(details).toMatch(/overflow: hidden;/)
    // Wraps instead of truncating to one line, so the window and pinned mark stay readable.
    expect(details).toMatch(/flex-wrap: wrap;/)
    expect(details).toMatch(/white-space: normal;/)
    expect(details).not.toMatch(/contain:/)
    expect(streamBlock).toMatch(/\[data-games-played-details\] > \[data-games-played-details-name\] \{[^}]*flex: 0 0 100%;/)
  })
})
