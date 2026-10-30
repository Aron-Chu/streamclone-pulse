// A newly displayed repair shell must not inherit an older saved snapshot's load time.
import { render, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendUrl } from '../src/lib/apiClient'
import { clearPublicHubCacheForTests, publicHubCacheKey, writePublicHubCache } from '../src/lib/publicHubCache'
import { normalizePublicHub, type PublicHub } from '../src/lib/publicHub'
import { summarizeActivity } from '../src/lib/hubActivitySummary'
import { resetHubBucketSelectionForTests } from '../src/lib/hubBucketSelection'

const fetchPublicHubBase = vi.fn()
const fetchPublicHubStatsFallback = vi.fn()

vi.mock('../src/lib/publicHub', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/publicHub')>('../src/lib/publicHub')
  return {
    ...actual,
    fetchPublicHubBase: (signal?: AbortSignal, w?: string, p?: string) => fetchPublicHubBase(signal, w, p),
    fetchPublicHubStatsFallback: (signal?: AbortSignal) => fetchPublicHubStatsFallback(signal),
  }
})

import { usePublicHubData } from '../src/hooks/usePublicHubData'
import { HubActivityPanelV5 } from '../src/ui/components/analytics/HubActivityPanelV5'

function sampleHub(poolSize: number): PublicHub {
  return normalizePublicHub({
    poolSize,
    generatedAt: '2026-06-30T12:00:00.000Z',
    activity: { points: [{ t: 1_700_000_000, chat: 40, emotes: 12, seventv: 5, viewers: 1000 }], windowMinutes: 1440, channelCount: 3 },
    corpusPipeline: { topN: 500, state: 'healthy', generatedAt: '2026-06-30T12:00:00.000Z', collectorActive: 10, collectorMax: 50 },
  } as unknown as Partial<PublicHub>)
}

// Same shape as usePublicHubData.test.tsx repairHubResult: a coarse long-window fallback.
function repairHubResult(poolSize: number) {
  const data = sampleHub(poolSize)
  data.activity = { ...data.activity, windowMinutes: 1440, requestedWindowMinutes: 1440, servedWindowMinutes: 30, availableWindowMinutes: 30, bucketMinutes: 6, state: 'degraded', source: 'live_pool_fallback', reason: 'historical_projection_unavailable' }
  return { data, loadSource: 'full' as const, hubEndpointOk: true, status: 200 }
}

// Copy of AnalyticsHubV5Page formatUpdatedAgo (not exported).
function formatUpdatedAgo(ts: number | null, nowMs: number): string | undefined {
  if (!ts) return undefined
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

describe('repair shell age after cache hydrate', () => {
  beforeEach(() => {
    resetHubBucketSelectionForTests()
    clearPublicHubCacheForTests()
    fetchPublicHubBase.mockReset()
    fetchPublicHubStatsFallback.mockReset()
  })

  it.each(['rate_limited', 'unauthorized'])('labels the new shell with its own load time after a %s repair refusal', async (kind) => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(42))
    const key = publicHubCacheKey(getBackendUrl(), '24h')
    const saved = JSON.parse(localStorage.getItem(key)!)
    saved.cachedAt = Date.now() - 2 * 60 * 60_000
    localStorage.setItem(key, JSON.stringify(saved))

    fetchPublicHubBase.mockResolvedValueOnce(repairHubResult(7)).mockRejectedValueOnce({ kind, status: kind === 'rate_limited' ? 429 : 401, message: 'stop' })
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    expect(result.current.loadSource).toBe('cache')
    await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.activityRefreshing).toBe(false))

    const hub = result.current
    expect(hub.data?.poolSize).toBe(7) // the newly displayed shell, not the saved copy
    expect(hub.loadSource).toBe('full')
    expect(hub.dataAsOf).toBeNull()
    expect(hub.lastSuccessfulPollAt).toBe(saved.cachedAt) // the old successful snapshot remains unchanged
    expect(hub.displayedSnapshotAt).toBeGreaterThan(saved.cachedAt)

    const now = Date.now()
    const { getByTestId } = render(<MemoryRouter>
      <HubActivityPanelV5
        hub={hub.data!}
        activitySummary={summarizeActivity([], 30, 0)}
        suggestions={[]}
        loading={hub.activityRefreshing}
        activityRefreshing={hub.activityRefreshing}
        updatedAgo={formatUpdatedAgo(hub.dataAsOf, now)}
        lastAppliedAgo={formatUpdatedAgo(hub.displayedSnapshotAt, now)}
        lastAppliedFromCache={hub.loadSource === 'cache'}
      />
    </MemoryRouter>)
    expect(getByTestId('hub-data-age').textContent).toMatch(/^Data age unavailable · Loaded \d+s ago$/)
  })
})
