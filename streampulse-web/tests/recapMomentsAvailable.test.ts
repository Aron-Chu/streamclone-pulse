import { describe, expect, it } from 'vitest'
import { hasRecapMomentsAvailable } from '@streampulse/analytics-console/utils/recapMomentsAvailable'
import type { PulseStreamRecap } from '@streampulse/analytics-console/apiTypes'

describe('hasRecapMomentsAvailable', () => {
  it('returns true when recap has ranked top moments', () => {
    const recap: PulseStreamRecap = {
      streamId: '1',
      topMoments: [{ offsetSeconds: 120, score: 0.9, chatCount: 40, emoteCount: 12 }],
    }
    expect(hasRecapMomentsAvailable(recap)).toBe(true)
  })

  it('returns false when recap has no moment rows', () => {
    const recap: PulseStreamRecap = {
      streamId: '1',
      topMoments: [],
      clipCandidates: [],
    }
    expect(hasRecapMomentsAvailable(recap)).toBe(false)
  })
})

describe('analytics console moments overlap guard', () => {
  it('does not stack SessionRecapMomentsStrip and MomentReviewPanel in one unconditional fragment', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const consolePath = path.resolve(
      import.meta.dirname,
      '../../../streampulse-backend/packages/analytics-console/src/components/AnalyticsConsole.tsx',
    )
    const source = await fs.readFile(consolePath, 'utf8')
    expect(source).toContain('recapMomentsAvailable')
    expect(source).not.toMatch(
      /SessionRecapMomentsStrip[\s\S]{0,400}<MomentReviewPanel/,
    )
  })
})
