import { describe, expect, it } from 'vitest'
import { hubAuditEdgeCaseMoment } from './fixtures/hubAuditEdgeCases'
import { withComputedBurstShare } from '../src/lib/emoteShare'
import { sourceLabel, vodStateLabel } from '../src/lib/pulseMomentsUtils'

describe('hub audit edge-case fixture', () => {
  it('covers vod_ready, unknown source, and zero sharePct shapes', () => {
    const moment = hubAuditEdgeCaseMoment()
    expect(vodStateLabel(moment.vodState)).toBe('VOD ready')
    expect(sourceLabel(moment.source)).toBe('Unknown source')
    expect(moment.topEmotes?.[0]?.count).toBeGreaterThan(0)
    expect((moment.topEmotes?.[0] as { sharePct?: number } | undefined)?.sharePct).toBe(0)
  })

  it('estimates sharePct when moment topEmotes omit backend share', () => {
    const moment = hubAuditEdgeCaseMoment()
    const bursts = withComputedBurstShare(
      (moment.topEmotes ?? []).map((emote) => ({
        code: emote.name,
        count: emote.count ?? 0,
        sharePct: (emote as { sharePct?: number }).sharePct,
      })),
    )
    expect(bursts[0]?.shareEstimated).toBe(true)
    expect(bursts[0]?.sharePct).toBeGreaterThan(0)
  })
})
