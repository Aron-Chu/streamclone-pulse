/**
 * A degraded-coverage snapshot keeps its degraded warning when the backend also
 * served its 24h live-pool fallback and ingest reads "operational" (CX-1 fix,
 * 10-30). Backend b1098ac never derives coverage.state from the activity source
 * (hub_overview.go 917-970): degraded comes from a failed DB ping or a degraded
 * corpus pipeline (corpus_readiness.go 513-515, e.g. zero_chat_after_age "Live
 * Top-N rows are aged without chat rollups"). ingest "operational" only says
 * desired <= active and every active collector has a stream id (hub_ingest.go
 * 63-79); joinAcknowledged is that bound-stream proxy, not an IRC join. So the
 * banner takes no activity or ingest, and never says chat collection is fine.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivitySummary } from '../../../lib/hubActivitySummary'
import { normalizePublicHub, type PublicHub, type PublicHubInput } from '../../../lib/publicHub'
import { HubDataHealthBanner } from './HubDataHealthBanner'

afterEach(() => cleanup())

// The 2026-10-30 07:19Z 24h answer (trimmed): coverage degraded, backend
// live_pool_fallback, ingest operational 1000/1000. The fixture drops the
// corpusPipeline block; the one below is copied from the same saved answer
// (codex-audit/inputs/evidence/hub-24h.json), relevant fields only.
const raw = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tests/fixtures/hub_screener_down_20261030.json'), 'utf8'),
) as Record<string, unknown> & { activity: Record<string, unknown>; ingest: Record<string, unknown>; coverage: Record<string, unknown> }

const corpusPipeline = {
  generatedAt: '2026-10-30T07:19:05.316775501Z',
  state: 'degraded',
  topN: 1000,
  liveAdmissionEnabled: true,
  liveAdmissionTopN: 1000,
  maxActiveIrcChannels: 1000,
  collectorActive: 1000,
  collectorMax: 1000,
  roster: {
    live: 34,
    collectorTracking: 34,
    expectedCollectorRows: 34,
    liveCollectorDeficitRows: 0,
    metadataStale: 0,
    capacityBlocked: 0,
    connectedQuiet: 21,
    collecting: 13,
    // Backend: ZeroChatAfterAgeRows > 0 => pipeline degraded, reason rollup_collapse.
    zeroChatAfterAge: 21,
  },
}

const raw24h = { ...raw, corpusPipeline }
// The 30m tab at the same instant: same coverage, pipeline and ingest; plain activity, no fallback marker.
const raw30m = {
  ...raw24h,
  activity: { windowMinutes: 30, bucketMinutes: 1, channelCount: 999, points: raw.activity.points },
}

/** The saved answer, or a variant of it, as the hub reads it. */
const hubOf = (input: unknown): PublicHub => normalizePublicHub(input as PublicHubInput)

const summary: ActivitySummary = {
  pointCount: 12, expectedBuckets: 12, missingBuckets: 0, coveragePct: 100,
  nonZeroCount: 8, gapCount: 0, bucketMinutes: 1, windowLabel: '30 minutes', footnote: '',
}

/** Same props AnalyticsHubV5Page passes for a measured snapshot. */
function renderBanner(hub: PublicHub, loadSource: 'full' | 'cache' = 'full') {
  return render(
    <HubDataHealthBanner
      loadSource={loadSource}
      hubEndpointOk
      activitySummary={summary}
      pipeline={hub.corpusPipeline}
      coverageState={hub.coverage.state}
      coverageDatabaseOk={hub.coverage.databaseOk}
      liveRosterCount={hub.coverage.liveChannels}
    />,
  )
}

const DEGRADED = 'Tracking or coverage is degraded in this snapshot — analytics may be incomplete.'
const FINE_CLAIM = /\bfine\b/i

describe('the degraded-coverage warning survives the 24h backend fallback', () => {
  it('the fixture is the case under test: degraded coverage, backend fallback, operational ingest', () => {
    const hub = hubOf(raw24h)
    expect(hub.coverage.state).toBe('degraded')
    expect(hub.activity.source).toBe('live_pool_fallback')
    expect(hub.ingest?.state).toBe('operational')
    expect(hub.ingest?.joinAcknowledged).toBeGreaterThan(0)
  })

  it('the 30m tab of the same snapshot shows the degraded warning', () => {
    const view = renderBanner(hubOf(raw30m))
    expect(screen.getByText(DEGRADED)).toBeTruthy()
    expect(view.container.textContent).not.toMatch(FINE_CLAIM)
  })

  it('the 24h tab of the same snapshot keeps the degraded warning', () => {
    const view = renderBanner(hubOf(raw24h))
    expect(screen.getByText(DEGRADED)).toBeTruthy()
    expect(view.container.textContent).not.toMatch(FINE_CLAIM)
  })

  it('a saved copy (loadSource cache) keeps it too', () => {
    const view = renderBanner(hubOf(raw24h), 'cache')
    expect(screen.getByText(DEGRADED)).toBeTruthy()
    expect(view.container.textContent).not.toMatch(FINE_CLAIM)
  })

  it('a failed database check keeps it next to the database line', () => {
    const hub = hubOf({
      ...raw24h,
      coverage: { ...raw.coverage, databaseOk: false, state: 'degraded' },
      corpusPipeline: { ...corpusPipeline, state: 'healthy', roster: { ...corpusPipeline.roster, zeroChatAfterAge: 0 } },
    })
    const view = renderBanner(hub)
    expect(screen.getByText(/Database check failed/)).toBeTruthy()
    expect(screen.getByText(DEGRADED)).toBeTruthy()
    expect(view.container.textContent).not.toMatch(FINE_CLAIM)
  })

  it('operational ingest with no chat in the last 5 minutes keeps it', () => {
    const hub = hubOf({
      ...raw24h,
      ingest: { ...raw.ingest, chatActive5m: 0, chatActive15m: 0, connectedQuiet: 1000 },
    })
    expect(hub.ingest?.state).toBe('operational')
    const view = renderBanner(hub)
    expect(screen.getByText(DEGRADED)).toBeTruthy()
    expect(view.container.textContent).not.toMatch(FINE_CLAIM)
  })
})
