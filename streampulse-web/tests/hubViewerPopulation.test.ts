import { describe, expect, it } from 'vitest'
import { normalizePublicHub, type HubActivityPoint } from '../src/lib/publicHub'
import { hasViewerSample, isViewerCoverageQualified } from '../src/lib/hubActivitySummary'
import { deriveHubChartActivityModel } from '../src/lib/hubChartActivityModel'

const start = Date.parse('2026-09-12T12:00:00Z')
const point = (i: number, extra: Partial<HubActivityPoint> = {}): HubActivityPoint => ({
  t: start + i * 360000, chat: 100, emotes: 50, seventv: 10,
  viewers: 2438333, hasViewerRollup: true, hasChatRollup: true, bucketComplete: true, ...extra,
})
const snapshot = (i: number, viewers = 500000) => point(i, {
  viewers, viewerCoverage: 'complete', viewerContributors: 80, viewerExpectedContributors: 500,
})
const normalize = (points: HubActivityPoint[], extra = {}) => normalizePublicHub({activity: {
  points, channelCount: 500, windowMinutes: 1440, requestedWindowMinutes: 1440, servedWindowMinutes: 1440,
  source: 'historical_projection', projectionGeneration: 'hub_activity_scalar', peakViewersAt: start,
  ...extra,
}}).activity

describe('historical viewer population compatibility', () => {
  it('keeps 240 buckets and reaction data but not corpus fallback viewers in a snapshot timeline', () => {
    const raw = Array.from({length: 240}, (_, i) => i === 0 ? point(i) : snapshot(i))
    const activity = normalize(raw)
    expect(activity.points).toHaveLength(240)
    expect(activity.points[0]).toMatchObject({chat: 100, emotes: 50, hasChatRollup: true, viewers: 0, hasViewerRollup: false, viewerCoverage: 'unknown', viewerSourceMismatch: true})
    expect(hasViewerSample(activity.points[0])).toBe(false)
    expect(activity.peakViewersAt).not.toBe(start)
    expect(raw[0].viewers).toBe(2438333)
    expect(normalize(activity.points).points).toEqual(activity.points)
    const model = deriveHubChartActivityModel({points: activity.points, windowMinutes: 1440, livePoolViewerSum: 5000000})
    expect(model.chartPoints).toHaveLength(240)
    expect(model.peakViewers).toBe(500000)
    expect(model.peakViewersAt).toBe(activity.peakViewersAt)
  })
  it('preserves all-unknown legacy timelines and other source generations', () => {
    expect(normalize([point(0),point(1)]).points.map(p=>p.viewers)).toEqual([2438333,2438333])
    expect(normalize([point(0,{viewerCoverage:'unknown'}),point(1,{viewerCoverage:'unknown'})]).points.map(p=>p.viewers)).toEqual([2438333,2438333])
    for (const extra of [{source:'live_pool_fallback'}, {projectionGeneration:undefined}, {projectionGeneration:'future_generation'}]) {
      expect(normalize([point(0),snapshot(1)],extra).points[0].viewers).toBe(2438333)
    }
  })
  it('preserves real high peaks, measured zero, partial snapshots, and missing viewers', () => {
    const raw = [point(0),snapshot(1,9000000),snapshot(2,0),snapshot(3,200000),point(4,{viewers:0,hasViewerRollup:false,viewerCoverage:'unknown'})]
    raw[3].viewerCoverage = 'partial'
    const a = normalize(raw)
    expect(a.points.map(p=>p.viewers)).toEqual([0,9000000,0,200000,0])
    expect(isViewerCoverageQualified(a.points[1])).toBe(true)
    expect(hasViewerSample(a.points[2])).toBe(true)
    expect(hasViewerSample(a.points[4])).toBe(false)
    expect(a.peakViewersAt).toBe(raw[1].t)
  })
  it('does not infer incompatibility from magnitude or incomplete provenance', () => {
    const raw = [point(0,{viewerCoverage:'complete'}),snapshot(1),point(2,{viewerContributors:5}),point(3,{viewerCoverageDetail:{state:'unknown'}})]
    expect(normalize(raw).points.map(p=>p.viewers)).toEqual(raw.map(p=>p.viewers))
  })
})
