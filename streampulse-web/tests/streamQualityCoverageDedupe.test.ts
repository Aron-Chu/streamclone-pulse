import { describe, expect, it } from 'vitest'
import { diagnoseStreamQuality } from '@streampulse/analytics-console/utils/streamQuality'

describe('diagnoseStreamQuality coverage banner ownership', () => {
  it('skips live_viewer_warmup when CoverageStartBanner would already show', () => {
    const startedAt = '2026-07-10T12:00:00.000Z'
    const rollups = Array.from({ length: 20 }, (_, i) => {
      const minuteTs = Date.parse(startedAt) + i * 60_000
      if (i < 4) {
        return {
          minuteTs,
          missing: false,
          chatCount: 40,
          totalEmoteCount: 5,
          viewerSamples: 0,
          viewerAvg: 0,
        }
      }
      return {
        minuteTs,
        missing: false,
        chatCount: 40,
        totalEmoteCount: 5,
        viewerSamples: 3,
        viewerAvg: 1200,
      }
    })

    const detail = {
      coverageStartOffsetSeconds: 480,
      stream: { startedAt },
      rollups,
    } as unknown as Parameters<typeof diagnoseStreamQuality>[0]['detail']

    const withBanner = diagnoseStreamQuality({
      detail,
      isLive: true,
      coverageStartOffsetSeconds: 480,
    })
    expect(withBanner?.issues.includes('live_viewer_warmup') ?? false).toBe(false)

    const withoutBanner = diagnoseStreamQuality({
      detail,
      isLive: true,
      coverageStartOffsetSeconds: 60,
    })
    expect(withoutBanner?.issues).toContain('live_viewer_warmup')
    expect(withoutBanner?.message).toMatch(/Viewer samples started at/i)
  })
})
