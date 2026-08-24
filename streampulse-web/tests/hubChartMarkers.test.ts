import { describe, expect, it } from 'vitest'
import {
  classifyMomentMarker,
  resolveAnnotationCollisions,
  type HubChartAnnotation,
} from '../src/lib/hubChartMarkers'

describe('classifyMomentMarker', () => {
  it('returns spike for chat_spike', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'chat_spike' })).toBe('spike')
  })

  it('returns spike for emote_spike', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'emote_spike' })).toBe('spike')
  })

  it('returns spike for viewer_spike', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'viewer_spike' })).toBe('spike')
  })

  it('returns spike case-insensitively', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'CHAT_SPIKE' })).toBe('spike')
  })

  it('returns moment for unknown kind', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'lifecycle' })).toBe('moment')
  })

  it('returns moment when kind is undefined', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0 })).toBe('moment')
  })
})

describe('resolveAnnotationCollisions', () => {
  const ann = (key: string, bucketT: number, xPercent?: number): HubChartAnnotation => ({
    key,
    bucketT,
    kind: 'moment',
    channelName: 'ch',
    source: 'network',
    ...(xPercent === undefined ? {} : { xPercent }),
  })

  it('returns the same annotations when no two are close', () => {
    const list = [ann('a', 0, 0), ann('b', 1000, 50), ann('c', 2000, 90)]
    expect(resolveAnnotationCollisions(list, { minSpacingPx: 24 })).toEqual(list)
  })

  it('marks the later annotation as dimmed when two are close', () => {
    const list = [ann('a', 0, 10), ann('b', 10, 30)]
    const out = resolveAnnotationCollisions(list, { minSpacingPx: 24 })
    expect(out[0].opacity).toBeUndefined()
    expect(out[1].opacity).toBe(0.4)
    expect(out[1].labelOmitted).toBe(true)
  })

  it('treats an annotation as a 100-px-wide column when xPercent is missing', () => {
    const list = [ann('a', 0), ann('b', 5)]
    const out = resolveAnnotationCollisions(list, { minSpacingPx: 200 })
    expect(out[1].opacity).toBe(0.4)
  })
})