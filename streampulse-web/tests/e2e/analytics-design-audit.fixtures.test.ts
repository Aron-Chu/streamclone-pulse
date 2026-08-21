import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const analyticsSpec = readFileSync(join(here, 'analytics-design-audit.spec.ts'), 'utf8')
const landingSpec = readFileSync(join(here, 'landing-design-audit.spec.ts'), 'utf8')
const captureHelper = readFileSync(join(here, 'helpers/designAuditCapture.ts'), 'utf8')

describe('analytics-design-audit fixture lock', () => {
  it('installs local hub and session mocks', () => {
    expect(analyticsSpec).toContain('installPortalConsoleMock')
    expect(analyticsSpec).toContain('installHubUxMock')
    expect(analyticsSpec).toContain('/analytics/${LOGIN}/${STREAM_ID}')
  })

  it('does not use a hosted July session path or waitForTimeout', () => {
    expect(analyticsSpec).not.toContain('2026-07-09')
    expect(analyticsSpec).not.toContain('ANALYTICS_E2E_SESSION_PATH')
    expect(analyticsSpec).not.toContain('waitForTimeout')
  })

  it('records required capture metadata fields', () => {
    expect(analyticsSpec).toContain('writeCaptureArtifact')
    expect(analyticsSpec).toContain('attachHubRequestTracker')
    expect(captureHelper).toContain('prefersReducedMotion')
    expect(captureHelper).toContain('deviceScaleFactor')
    expect(captureHelper).toContain('headShort')
  })
})

describe('landing-design-audit fixture lock', () => {
  it('captures first paint before hub and honest empty/error phases', () => {
    expect(landingSpec).toContain('installHubUxMock')
    expect(landingSpec).toContain('01-immediate-first-paint')
    expect(landingSpec).toContain("'empty', 'error'")
    expect(landingSpec).toContain('honesty-probes.json')
    expect(landingSpec).toContain('containsFallbackEmote')
    expect(landingSpec).not.toContain('page.waitForTimeout')
  })
})
