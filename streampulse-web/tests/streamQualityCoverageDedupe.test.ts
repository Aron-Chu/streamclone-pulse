import { describe, expect, it } from 'vitest'
import { diagnoseStreamQuality } from '@streampulse/analytics-console/utils/streamQuality'

describe('diagnoseStreamQuality live viewer warmup', () => {
  it('reports live_viewer_warmup when early chat precedes viewer samples', () => {
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
      coverageStartOffsetSeconds: 0,
      stream: { startedAt },
      rollups,
    } as unknown as Parameters<typeof diagnoseStreamQuality>[0]['detail']

    // CoverageStartBanner is a separate UI surface; diagnoseStreamQuality still
    // owns the live_viewer_warmup quality issue when viewer samples lag chat.
    const diagnosis = diagnoseStreamQuality({
      detail,
      isLive: true,
    })
    expect(diagnosis?.issues).toContain('live_viewer_warmup')
    expect(diagnosis?.message).toMatch(/Viewer samples started at/i)
  })
})
