import { describe, expect, it } from 'vitest'
import { ircSlotMetrics } from '../src/lib/coverageHealthMetrics'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'
import type { HubCorpusPipeline, HubCoverage } from '../src/lib/publicHub'

const coverageFixture: HubCoverage = {
  liveChannels: 103,
  trackingMax: 10,
  backfillActive: 0,
  backfillMax: 1,
  syncActive: 8,
  emotesIndexed: 0,
  databaseOk: true,
  state: 'degraded',
}

const pipelineFixture: HubCorpusPipeline = hubCorpusPipelineFixture({
  generatedAt: '2026-06-28T16:54:13.764Z',
  state: 'degraded',
  topN: 500,
  collectorActive: 10,
  collectorMax: 10,
  roster: {
    live: 103,
    collectorTracking: 8,
    expectedCollectorRows: 10,
    liveCollectorDeficitRows: 2,
    metadataOnly: 16,
    metadataStale: 0,
    admissionDisabled: 0,
    capacityBlocked: 1,
    warming: 0,
    collecting: 12,
    viewerOnly: 74,
    zeroChatAfterAge: 0,
  },
})

describe('ircSlotMetrics', () => {
  it('uses collector slot fill when pipeline is present', () => {
    const row = ircSlotMetrics(coverageFixture, pipelineFixture)
    expect(row.label).toBe('IRC collector slots')
    expect(row.pct).toBe(100)
    expect(row.meta).toContain('10/10 slots')
    expect(row.meta).toContain('8 with chat')
    expect(row.meta).toContain('103 live on roster')
    expect(row.color).toBe('hsl(var(--chart-4))')
  })

  it('does not divide roster live by slots (legacy bug)', () => {
    const row = ircSlotMetrics(coverageFixture, pipelineFixture)
    expect(row.pct).not.toBe(10)
  })

  it('falls back to syncActive when pipeline is missing', () => {
    const row = ircSlotMetrics(coverageFixture)
    expect(row.pct).toBe(80)
    expect(row.meta).toContain('8/10 slots')
  })

  it('shows zero pct when nothing is live', () => {
    const row = ircSlotMetrics(
      { ...coverageFixture, liveChannels: 0, syncActive: 0, trackingMax: 0 },
      undefined,
    )
    expect(row.pct).toBe(0)
  })
})
