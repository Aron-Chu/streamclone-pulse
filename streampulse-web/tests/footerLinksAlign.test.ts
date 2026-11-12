import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Footer links share one text line (site batch 3, item 11). "Analytics preferences" is a
 * <details> whose summary has a 44px tap box, which used to make every footer row 44px
 * tall: Discord and the label sat ~12px below the plain links, and an open panel
 * stretched the row and dragged Discord to the middle of it. jsdom cannot measure
 * layout, so this pins the two declarations that fix it.
 */
const preferences = readFileSync(resolve(process.cwd(), 'src/ui/components/AnalyticsPreferences.css'), 'utf8')
const landing = readFileSync(resolve(process.cwd(), 'src/ui/components/landing/landing.css'), 'utf8')

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return css.match(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('footer link alignment', () => {
  it('keeps the 44px tap box on Analytics preferences but gives it one text line of layout', () => {
    const summary = ruleBody(preferences, '.analytics-preferences > summary')
    expect(summary).toMatch(/min-height:\s*44px;/)
    // (1lh - 44px) / 2 on each side cancels the box's extra height, so the row is as tall as its links.
    expect(summary).toMatch(/margin-block:\s*calc\(\(1lh - 44px\) \/ 2\);/)
  })

  it('top-aligns the home footer row so an open panel moves no other link', () => {
    const row = ruleBody(landing, '.sl-foot__links')
    expect(row).toMatch(/display:\s*flex;/)
    expect(row).toMatch(/align-items:\s*flex-start;/)
  })
})
