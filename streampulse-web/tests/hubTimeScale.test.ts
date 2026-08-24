import { describe, expect, it } from 'vitest'
import {
  hubBucketBarRect,
  hubBucketCenterX,
  hubTimeDomain,
  hubTimeXPercent,
} from '../src/lib/hubTimeScale'

const BUCKET_MS = 6 * 60_000
const START = 100 * BUCKET_MS
const POINTS_24H = Array.from({ length: 240 }, (_, i) => ({ t: START + i * BUCKET_MS }))
const SPAN_MS = 240 * BUCKET_MS

describe('HubTimeScale', () => {
  it('HubTimeScale.mapsFirstBucketCenter', () => {
    const domain = hubTimeDomain(POINTS_24H, BUCKET_MS)
    expect(domain).not.toBeNull()
    const x = hubBucketCenterX(POINTS_24H[0].t, domain!)
    expect(x).toBeCloseTo(((BUCKET_MS / 2) / SPAN_MS) * 100, 5)
  })

  it('HubTimeScale.mapsLastBucketCenter', () => {
    const domain = hubTimeDomain(POINTS_24H, BUCKET_MS)
    expect(domain).not.toBeNull()
    const x = hubBucketCenterX(POINTS_24H[239].t, domain!)
    expect(x).toBeCloseTo(((239 * BUCKET_MS + BUCKET_MS / 2) / SPAN_MS) * 100, 5)
  })

  it('HubTimeScale.mapsExactMomentInsideCoarseBucket', () => {
    const domain = hubTimeDomain(POINTS_24H, BUCKET_MS)!
    const at = POINTS_24H[0].t + 60_000
    const x = hubTimeXPercent(at, domain)
    const bar = hubBucketBarRect(POINTS_24H[0].t, domain)
    expect(x).not.toBeNull()
    expect(bar).not.toBeNull()
    expect(x!).toBeGreaterThanOrEqual(bar!.left)
    expect(x!).toBeLessThan(bar!.left + bar!.width)
    expect(x).not.toBeCloseTo(hubBucketCenterX(POINTS_24H[0].t, domain)!, 5)
  })

  it('HubTimeScale.omitsOutOfDomainMoment', () => {
    const domain = hubTimeDomain(POINTS_24H, BUCKET_MS)!
    expect(hubTimeXPercent(POINTS_24H[0].t - 1, domain)).toBeNull()
    expect(hubTimeXPercent(domain.endExclusive, domain)).toBeNull()
    expect(hubTimeXPercent(domain.endExclusive - 1, domain)).not.toBeNull()
  })
})
