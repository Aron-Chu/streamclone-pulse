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
