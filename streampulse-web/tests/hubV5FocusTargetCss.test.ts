import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const page = read('src/routes/analytics/AnalyticsHubV5Page.tsx')
const css = read('src/ui/components/hub/v5/hub-v5.css')

describe('hub v5 "Analytics content" focus target', () => {
  it('is on the page, which does not load the old hub\'s discovery-layout.css', () => {
    expect(page).toContain('className="analytics-focus-target"')
    expect(page).toContain("import '../../ui/components/hub/v5/hub-v5.css'")
    expect(page).not.toContain('discovery-layout.css')
  })

  it('is visually hidden by hub-v5.css until it takes focus', () => {
    expect(css).toMatch(/\n\.analytics-focus-target \{[^}]*position: absolute;[^}]*width: 1px;[^}]*height: 1px;[^}]*overflow: hidden;[^}]*clip-path: inset\(50%\);/)
    expect(css).toMatch(/\n\.analytics-focus-target:focus \{[^}]*position: static;[^}]*width: auto;[^}]*height: auto;[^}]*clip-path: none;/)
  })
})

describe('the Top emotes chips’ focus ring (11-19)', () => {
  it('is inset, as the hub’s other rows in a scroller have it, so the row’s overflow does not clip it', () => {
    expect(css).toMatch(/\.hv5-emr-list \{[^}]*overflow-x: auto;/)
    expect(css).toMatch(/\.hub-v5 \.hv5-emr button\.hv5-emr-c:focus-visible \{ outline: 2px solid var\(--sp-focus\); outline-offset: -2px; \}/)
    for (const row of ['.hv5-feed .hv5-fd', '.hv5-games .hv5-gr', '.hv5-top .hv5-tm-row']) {
      expect(css).toContain(`.hub-v5 ${row}:focus-visible { outline: 2px solid var(--sp-focus); outline-offset: -2px; }`)
    }
  })
})
