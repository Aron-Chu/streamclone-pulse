import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FEEDBACK_DETAIL_NEUTRAL, FEEDBACK_DETAIL_PRIVATE, FEEDBACK_FORM_LIVE } from '../src/shared/feedbackPolicy.ts'

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
    expect(portalStatus).toContain('`/analytics` is the d3-v5 hub (the Command Center and its Live Wire are removed)')
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

  it('gives one rule for the private feedback form in release.md, the store checklist and the store README (D19)', () => {
    // The form may stay off at upload; the extension then makes no privacy promise.
    expect(FEEDBACK_FORM_LIVE).toBe(false)
    for (const doc of [releasePolicy, storeChecklist]) {
      expect(doc).toContain('owner decision D19')
      expect(doc).toContain('`FEEDBACK_FORM_LIVE`')
      expect(doc).toContain(`"${FEEDBACK_DETAIL_NEUTRAL}"`)
      expect(doc).toContain(`"${FEEDBACK_DETAIL_PRIVATE}"`)
      expect(doc).toContain('makes no privacy promise')
    }
    expect(storeReadme).toContain('FEEDBACK_FORM_LIVE')
    // No doc still holds the upload until the form is on.
    for (const doc of [releasePolicy, storeChecklist, storeReadme]) {
      expect(doc).not.toMatch(/private feedback form is (?:on|live)\b/)
      expect(doc).not.toContain('Private. Only the team reads it.')
    }
  })
})
