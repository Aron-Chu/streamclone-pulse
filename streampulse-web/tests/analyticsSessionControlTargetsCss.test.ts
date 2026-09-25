import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/analytics-tailwind.css'), 'utf8')

describe('portal session control target CSS', () => {
  it('sizes session, chart, zoom, navigation, and data-alternative controls to 44px', () => {
    expect(css).toContain('.sc-analytics-console .analytics-console[data-analytics-console-shell] header :is(a, button)')
    for (const selector of [
      '[data-session-details-tabs]',
      '[data-chart-focus-bar]',
      '[data-chart-viewport-controls]',
      '[data-chart-position-rail]',
      '[data-chart-data-alternative]',
    ]) {
      expect(css).toContain(`.sc-analytics-console ${selector}`)
    }
    expect(css).toMatch(/min-width:\s*44px !important;\s*\n\s*min-height:\s*44px !important;/)
    expect(css).toMatch(/data-chart-data-alternative[^}]*summary[\s\S]*?min-height:\s*44px !important;/)
  })

  it('keeps the override portal-scoped and wraps dense chart toolbars', () => {
    expect(css).not.toMatch(/(?:^|\n)\s*:where\([^\n]*button[^\n]*\)\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.sc-analytics-console \[data-chart-focus-top-row\][\s\S]*?flex-wrap:\s*wrap;/)
  })

  it('scrolls the range controls sideways rather than growing the toolbar', () => {
    expect(css).toMatch(
      /\.sc-analytics-console \[data-chart-viewport-controls\][^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s,
    )
  })
})
