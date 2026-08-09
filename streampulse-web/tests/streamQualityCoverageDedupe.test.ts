import { describe, expect, it } from 'vitest'
import { diagnoseStreamQuality } from '@streampulse/analytics-console/utils/streamQuality'

const startedAt = '2026-07-10T12:00:00.000Z'

/** Chat leads viewer samples by 4 minutes — the live_viewer_warmup shape. */
function warmupRollups() {
  return Array.from({ length: 20 }, (_, i) => {
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
}

function detailWithCoverageStart(coverageStartOffsetSeconds: number) {
  return {
    coverageStartOffsetSeconds,
    stream: { startedAt },
    rollups: warmupRollups(),
  } as unknown as Parameters<typeof diagnoseStreamQuality>[0]['detail']
}

describe('diagnoseStreamQuality live viewer warmup', () => {
  it('reports live_viewer_warmup when early chat precedes viewer samples', () => {
    const diagnosis = diagnoseStreamQuality({
      detail: detailWithCoverageStart(0),
      isLive: true,
    })
    expect(diagnosis?.issues).toContain('live_viewer_warmup')
    expect(diagnosis?.message).toMatch(/Viewer samples started at/i)
  })

  it('stays silent when CoverageStartBanner already explains the late start', () => {
    // A late tracking start is rendered by CoverageStartBanner. Repeating it as a
    // quality banner produced two "Viewer samples started at ..." notices.
    const diagnosis = diagnoseStreamQuality({
      detail: detailWithCoverageStart(480),
      isLive: true,
    })
    expect(diagnosis?.issues ?? []).not.toContain('live_viewer_warmup')
    expect(diagnosis?.message ?? '').not.toMatch(/Viewer samples started at/i)
  })
})
