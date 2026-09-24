import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const extensionVersion = JSON.parse(read('manifest.json')).version as string
const portalVersion = JSON.parse(read('streampulse-web/package.json')).version as string

const releasePolicy = read('docs/pulse-extension/release.md')
const storeReadme = read('store/cws/README.md')
const storeChecklist = read('docs/pulse-extension/chrome-web-store-review-checklist.md')
const portalStatus = read('docs/website-portal/release-status.md')

describe('release documentation contract', () => {
  it('keeps the extension candidate wording aligned with source metadata', () => {
    for (const doc of [releasePolicy, storeReadme, storeChecklist, portalStatus]) {
      expect(doc).toContain(extensionVersion)
    }
    expect(storeReadme).not.toMatch(/Source manifests are \*\*0\.1\.3\*\*/)
    expect(portalStatus).toContain(`Portal package version | \`${portalVersion}\``)
  })

  it('names the current analytics routes without claiming live deployment proof', () => {
    expect(portalStatus).toContain('`/analytics` is the Command Center with Live Wire')
    expect(portalStatus).toContain('`/analytics/moments` is the canonical Moments workspace')
    expect(portalStatus).toContain('SOURCE GREEN / LIVE RECHECK OPEN')
  })

  it('keeps manual and live release evidence explicit', () => {
    expect(releasePolicy).toContain('Mocked browser screenshots and a locally')
    expect(storeChecklist).toContain('mocked Playwright is not live evidence')
    expect(portalStatus).toMatch(/Source\s+and mocked tests alone do not establish either service is operational/)
    expect(portalStatus).toContain('live-mode Stripe Tax registration decision')
    expect(portalStatus).toMatch(/representative\s+checkout tax result/)
  })
})
