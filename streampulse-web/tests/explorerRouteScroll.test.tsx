import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeExplorerEnvelope, type ExplorerEnvelope } from '../src/lib/explorer'
import { RouteScrollManager } from '../src/ui/RouteScrollManager'

const { mockUseExplorerData } = vi.hoisted(() => ({ mockUseExplorerData: vi.fn() }))
vi.mock('../src/hooks/useExplorerData', () => ({ useExplorerData: mockUseExplorerData }))

import AnalyticsExplorerPage from '../src/routes/analytics/AnalyticsExplorerPage'

const occurredAt = Date.UTC(2026, 8, 3, 12, 0, 0)

function moment(id: string, streamId: string) {
  const metric = {
    state: 'ready', currentPerMin: 120, baselinePerMin: 40, absoluteDeltaPerMin: 80, changePct: 200, multiplier: 3,
    currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 20, baselineExpectedMinutes: 20, baselineCoveragePct: 100,
  }
  const evidence = {
    ircBound: true, eventRollupAvailable: true, streamIdentityMatched: true, rollupChatSource: 'irc', rollupSourceConfidence: 'verified',
    metadataStreamMatched: true, baselineMeasuredMinutes: 20, baselineExpectedMinutes: 20, baselineCoveragePct: 100,
  }
  const comparison = {
    baselineKind: 'current_stream_measured_average_before_event',
    eventAt: occurredAt,
    baselineWindow: { start: occurredAt - 20 * 60_000, end: occurredAt, expectedMinutes: 20, measuredMinutes: 20, coveragePct: 100 },
    chat: metric,
    emotes: { ...metric, currentPerMin: 160, multiplier: 4 },
    evidence,
  }
  return {
    id, revision: 1, detectorEventKey: `event-${id}`, updateKind: 'signal',
    occurredAt: new Date(occurredAt).toISOString(), publishedAt: new Date(occurredAt + 1000).toISOString(),
    signal: 'emotes', lifecycle: 'confirmed',
    headline: 'Emote activity rose well above this broadcast baseline',
    summary: 'Verified emote and chat rollups identify one qualified moment.',
    score: 91, comparison, evidence,
    topEmotes: [{ name: 'KEKW', provider: '7TV', count: 90, sharePct: 40 }],
    momentRef: { publicMomentId: `public-${id}`, streamId, occurrenceAt: occurredAt, offsetSeconds: 240 },
    notificationEligible: true, isLate: false,
  }
}

function broadcast(login: string, streamId: string) {
  const strongest = moment(`m-${login}`, streamId)
  return {
    id: `pulse-${login}-${streamId}`, login, displayName: login, category: 'Just Chatting', streamId, state: 'live',
    primarySignal: 'emotes', momentCount: 1, strongestScore: 91,
    firstActivityAt: strongest.occurredAt, lastActivityAt: strongest.occurredAt,
    strongestMoment: strongest, latestMoment: strongest, sources: [],
  }
}

function envelope(): ExplorerEnvelope {
  const first = broadcast('xqc', 'stream-1')
  const data = normalizeExplorerEnvelope({
    schemaVersion: 1, status: 'ready',
    generatedAt: new Date(occurredAt + 2000).toISOString(), dataThrough: new Date(occurredAt + 1000).toISOString(),
    window: '24h', query: { window: '24h', signal: 'all', state: 'all', sort: 'strongest' },
    summary: { broadcastCount: 2, momentCount: 2, categoryCount: 1 },
    facets: { signals: [], categories: [{ value: 'just chatting', label: 'Just Chatting', count: 2 }], states: [] },
    broadcasts: [first, broadcast('hasanabi', 'stream-2')],
    broadcast: first,
    moments: [first.strongestMoment],
  })
  if (!data) throw new Error('fixture envelope did not normalize')
  return data
}

let scrollTo: ReturnType<typeof vi.fn>
let path = ''

function PathProbe() {
  path = useLocation().pathname
  return null
}

function renderExplorer() {
  const data = envelope()
  mockUseExplorerData.mockImplementation(() => ({
    data, loading: false, refreshing: false, loadingMore: false, error: null, unavailable: false, announcement: '',
    refresh: vi.fn(), loadMore: vi.fn(),
  }))
  return render(
    <MemoryRouter initialEntries={['/analytics/explore']}>
      <PathProbe />
      <RouteScrollManager />
      <Routes>
        <Route path="/analytics/explore" element={<AnalyticsExplorerPage />} />
        <Route path="/analytics/explore/:broadcastId" element={<AnalyticsExplorerPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** explorer.css stacks the workspace below 960 px; tests set which side of that the window is on. */
function setStacked(stacked: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(max-width: 959px)' ? stacked : false,
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
}

async function settle() {
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  scrollTo = vi.fn()
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
})

afterEach(() => {
  cleanup()
  mockUseExplorerData.mockReset()
})

describe('Explorer list and detail scroll', () => {
  it('keeps the reader in place on desktop, where the list stays beside the detail', async () => {
    setStacked(false)
    renderExplorer()
    await settle()

    fireEvent.click(screen.getAllByRole('link', { name: /hasanabi/i })[0])
    await settle()
    expect(path).toBe('/analytics/explore/pulse-hasanabi-stream-2')
    expect(scrollTo).not.toHaveBeenCalled()

    // Another broadcast from the list, then Escape back to the list.
    fireEvent.click(screen.getAllByRole('link', { name: /xqc/i })[0])
    await settle()
    expect(path).toBe('/analytics/explore/pulse-xqc-stream-1')
    fireEvent.keyDown(window, { key: 'Escape' })
    await settle()
    expect(path).toBe('/analytics/explore')
    expect(scrollTo).not.toHaveBeenCalled()

    // A filter changed while a broadcast is open returns to the list in place too.
    fireEvent.click(screen.getAllByRole('link', { name: /hasanabi/i })[0])
    await settle()
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'recent' } })
    await settle()
    expect(path).toBe('/analytics/explore')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('opens the detail and the list at the top on narrow screens, where one replaces the other', async () => {
    setStacked(true)
    renderExplorer()
    await settle()

    fireEvent.click(screen.getAllByRole('link', { name: /hasanabi/i })[0])
    await settle()
    expect(path).toBe('/analytics/explore/pulse-hasanabi-stream-2')
    expect(scrollTo).toHaveBeenCalledWith(0, 0)

    scrollTo.mockClear()
    fireEvent.keyDown(window, { key: 'Escape' })
    await settle()
    expect(path).toBe('/analytics/explore')
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('uses the breakpoint where explorer.css stacks the list and the detail', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../src/ui/components/explorer/explorer.css'), 'utf8')
    const stacked = css.slice(css.indexOf('@media (max-width: 959px)'))
    expect(stacked).toMatch(/^@media \(max-width: 959px\) \{[\s\S]*?\.pulse-explorer--detail-route \.explorer-results \{\s*display: none;/)
  })
})
