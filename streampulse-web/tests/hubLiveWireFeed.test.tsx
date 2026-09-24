import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mapHubPulseMoment,
  momentRowKey,
  resolveLivePulseMoments,
  type FigmaMomentRow,
  type LivePulseMomentsResult,
} from '../src/lib/figmaSessionAnalytics'
import type { HubLivePulseMoment, PublicHub } from '../src/lib/publicHub'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'
import { HubLiveWireFeed } from '../src/ui/components/analytics/HubLiveWireFeed'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'

const { gsapFrom } = vi.hoisted(() => ({ gsapFrom: vi.fn() }))

vi.mock('gsap', () => ({
  default: { to: vi.fn(), from: gsapFrom, fromTo: vi.fn(), registerPlugin: vi.fn() },
}))

function comparison(eventAt: number) {
  const end = Math.floor(eventAt / 60_000) * 60_000
  const baseline = {
    state: 'ready' as const,
    currentPerMin: 133,
    baselinePerMin: 40,
    absoluteDeltaPerMin: 93,
    changePct: 232.5,
    multiplier: 3.325,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 24,
    baselineExpectedMinutes: 30,
    baselineCoveragePct: 80,
  }
  return {
    baselineKind: 'current_stream_measured_average_before_event' as const,
    eventAt,
    baselineWindow: {
      start: end - 30 * 60_000,
      end,
      expectedMinutes: 30,
      measuredMinutes: 24,
      coveragePct: 80,
    },
    chat: { ...baseline, currentPerMin: 393, baselinePerMin: 160, absoluteDeltaPerMin: 233, changePct: 145.6, multiplier: 2.456 },
    emotes: baseline,
    evidence: {
      ircBound: true,
      eventRollupAvailable: true,
      baselineMeasuredMinutes: 24,
      baselineExpectedMinutes: 30,
      baselineCoveragePct: 80,
    },
  }
}

function makeMoment(overrides: Partial<HubLivePulseMoment> & Pick<HubLivePulseMoment, 'login'>): HubLivePulseMoment {
  return {
    offsetSeconds: 60,
    label: 'Chat spike',
    kind: 'chat_spike',
    chatPerMin: 200,
    emotesPerMin: 40,
    viewers: 5000,
    category: 'Just Chatting',
    at: Date.now() - 2 * 60_000,
    streamId: `s-${overrides.login}`,
    ...overrides,
    score: overrides.score ?? 80,
  }
}

function sampleHub(): PublicHub {
  return {
    generatedAt: new Date().toISOString(),
    poolSize: 96,
    corpus: { streamsTracked: 1200, momentsDetected: 45000, chatMessagesProcessed: 9_000_000, emotesIndexed: 120_000, vodsAnalyzed: 800 },
    coverage: { liveChannels: 2, trackingMax: 300, backfillActive: 0, backfillMax: 4, syncActive: 0, emotesIndexed: 120_000, databaseOk: true, state: 'operational' },
    corpusPipeline: hubCorpusPipelineFixture({
      generatedAt: new Date().toISOString(), state: 'healthy', topN: 500, collectorActive: 40, collectorMax: 96,
      roster: { live: 2, collectorTracking: 2, expectedCollectorRows: 2, liveCollectorDeficitRows: 0, metadataOnly: 0, metadataStale: 0, admissionDisabled: 0, capacityBlocked: 0, warming: 0, collecting: 2, viewerOnly: 0, zeroChatAfterAge: 0 },
    }),
    activity: { points: [], windowMinutes: 24 * 60, channelCount: 2 },
    emoteIntel: { emotesPerMin: 88, topEmoteSharePct: 22, uniqueEmotes: 140, biggestPeakPerMin: 320, seventvSharePct: 61, providerShares: [] },
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 }],
    topMovers: [],
    liveChannels: [
      { login: 'xqc', displayName: 'xQc', category: 'Minecraft', viewers: 12000, chatPerMin: 393, emotesPerMin: 133, seventvPerMin: 100, coverageState: 'synced', trendPct: 5 },
      { login: 'sodapoppin', displayName: 'sodapoppin', category: 'Just Chatting', viewers: 9800, chatPerMin: 280, emotesPerMin: 95, seventvPerMin: 70, coverageState: 'synced', trendPct: -2 },
    ],
    moments: [], livePulseMoments: [], featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
  }
}

function networkFeed(now = Date.now()): { hub: PublicHub; feed: LivePulseMomentsResult } {
  const hub = sampleHub()
  const eventAt = now - 5 * 60_000
  hub.livePulseMoments = [
    makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', kind: 'emote_spike', label: 'Twitch emote spike', chatPerMin: 393, emotesPerMin: 133, viewers: 12_000, category: 'Minecraft', at: eventAt, comparison: comparison(eventAt), topEmotes: [{ name: 'DinoDance', provider: 'twitch', count: 123, sharePct: 39 }] }),
    makeMoment({ login: 'sodapoppin', displayName: 'sodapoppin', streamId: 's2', chatPerMin: 280, emotesPerMin: 95, viewers: 9800, category: 'Just Chatting', at: now - 8 * 60_000 }),
  ]
  return { hub, feed: resolveLivePulseMoments(hub) }
}

function renderFeed(
  feed: LivePulseMomentsResult,
  hub = sampleHub(),
  opts: {
    reducedMotion?: boolean
    loadSource?: 'full' | 'stats-fallback' | 'cache'
    hubEndpointOk?: boolean
    pollSequence?: number
    selectedMomentKey?: string | null
    onSelectMoment?: (moment: FigmaMomentRow) => void
    canSelectMoment?: (moment: FigmaMomentRow) => boolean
  } = {},
) {
  const { reducedMotion = false, loadSource = 'full', hubEndpointOk = true, pollSequence = 0, selectedMomentKey, onSelectMoment, canSelectMoment } = opts
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
  return render(
    <MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed
      hub={hub} feed={feed} loadSource={loadSource}
      hubEndpointOk={hubEndpointOk} pollSequence={pollSequence}
      selectedMomentKey={selectedMomentKey} onSelectMoment={onSelectMoment}
      canSelectMoment={canSelectMoment}
    /></AnalyticsThemeProvider></MemoryRouter>,
  )
}

describe('HubLiveWireFeed (chart event tape)', () => {
  beforeEach(() => gsapFrom.mockClear())
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('preserves public identity and server-owned comparison through the presentation mapper', () => {
    const at = Date.now() - 60_000
    const evidence = comparison(at)
    const moment = makeMoment({ login: 'xqc', streamId: 's1', publicMomentId: 'pm-test', at, comparison: evidence })
    const mapped = mapHubPulseMoment(moment)
    expect(mapped.publicMomentId).toBe('pm-test')
    expect(mapped.streamId).toBe('s1')
    expect(mapped.comparison).toBe(evidence)
    expect(mapped.href).toBe('/analytics/xqc/s1#t=60')
    expect(mapHubPulseMoment(makeMoment({ login: 'xqc' })).comparison).toBeUndefined()
  })

  it('shows compact measured rates, emotes, and server-owned evidence without score bars', () => {
    const { hub, feed } = networkFeed()
    renderFeed(feed, hub)
    expect(screen.getByTitle(/Earlier baseline 24\/30 min · 80% coverage/i)).toBeTruthy()
    // The magnitude is the headline; the full claim stays reachable on the chip.
    const magnitude = screen.getByTitle(/Emotes 3\.3× this stream's earlier average/i)
    expect(magnitude.textContent).toBe('3.3×')
    expect(magnitude.getAttribute('data-below')).toBeNull()
    expect(screen.getByText('393/m')).toBeTruthy()
    expect(screen.getByText('133/m')).toBeTruthy()
    expect(screen.getByLabelText('Top emotes')).toBeTruthy()
    expect(document.querySelectorAll('.hub-live-wire__bar')).toHaveLength(0)
    expect(screen.queryByText(/score 80/i)).toBeNull()
    expect(screen.getAllByRole('link', { name: /^Stream analytics for / }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^Save / }).length).toBeGreaterThan(0)
    const openMoment = screen.getAllByRole('link', { name: /^Open moment for / })[0]
    const cardFooter = openMoment.closest('.hub-live-wire__rail-footer')
    expect(openMoment.classList.contains('hub-live-wire__action--primary')).toBe(true)
    expect(cardFooter?.getAttribute('role')).toBe('group')
    expect(cardFooter?.getAttribute('aria-label')).toBe('Actions for xQc Twitch emote spike at 1:00')
    const secondaryActions = cardFooter?.querySelector('.hub-live-wire__rail-actions')
    expect(secondaryActions?.contains(screen.getAllByRole('link', { name: /^Stream analytics for / })[0])).toBe(true)
    expect(secondaryActions?.contains(screen.getAllByRole('button', { name: /^Save / })[0])).toBe(true)
    expect(cardFooter?.querySelectorAll('a a, a button, button a, button button')).toHaveLength(0)
    expect(cardFooter?.textContent).toContain('Open moment')
    expect(cardFooter?.textContent).toContain('Analytics')
    expect(cardFooter?.textContent).toContain('Save')
    expect(screen.queryByRole('button', { name: /Expand xQc/i })).toBeNull()
  })

  it('preserves raw measurements and labels unavailable comparison evidence', () => {
    const { hub, feed } = networkFeed()
    renderFeed(feed, hub)
    expect(screen.getByText('280/m')).toBeTruthy()
    expect(screen.getByText('95/m')).toBeTruthy()
    expect(screen.getAllByText(/^Comparison unavailable$/i).length).toBeGreaterThan(0)
  })

  it('does not guess an older detection category from the creator current live category', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', category: undefined })]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getByText('Category unavailable')).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Minecraft' })).toBeNull()
  })

  it('gives repeated row actions an exact creator, reaction, and offset name', () => {
    const { hub, feed } = networkFeed()
    renderFeed(feed, hub, { onSelectMoment: vi.fn(), canSelectMoment: () => true })
    expect(screen.getByRole('article', { name: 'xQc Twitch emote spike at 1:00' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open moment for xQc Twitch emote spike at 1:00' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save xQc Twitch emote spike at 1:00' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Stream analytics for xQc Twitch emote spike at 1:00' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show xQc Twitch emote spike at 1:00 on chart' })).toBeTruthy()
  })

  it('renders measured zero rates as zero rather than missing data', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', chatPerMin: 0, emotesPerMin: 0 })]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getAllByText('0/m')).toHaveLength(2)
    expect(document.querySelectorAll('.hub-live-wire__bar-fill')).toHaveLength(0)
  })

  it('labels partial baseline comparisons unavailable instead of implying a ready comparison', () => {
    const hub = sampleHub()
    const at = Date.now() - 60_000
    const sample = comparison(at)
    hub.livePulseMoments = [makeMoment({ login: 'xqc', at, comparison: {
      ...sample,
      chat: { ...sample.chat, state: 'partial' },
      emotes: { ...sample.emotes, state: 'warming' },
    } })]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getByText('Comparison unavailable')).toBeTruthy()
    expect(screen.queryByText(/× this stream's earlier average/)).toBeNull()
    expect(screen.getByTitle(/Earlier baseline 24\/30 min/)).toBeTruthy()
  })

  it('does not attach a comparison from another event minute to this row', () => {
    const hub = sampleHub()
    const at = Date.now() - 60_000
    hub.livePulseMoments = [makeMoment({
      login: 'xqc',
      at,
      chatPerMin: 355,
      emotesPerMin: 2570,
      comparison: comparison(at + 60_000),
    })]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getByText('Comparison unavailable')).toBeTruthy()
    expect(screen.queryByText(/× this stream's earlier average/)).toBeNull()
    expect(screen.getByText('355/m')).toBeTruthy()
    expect(screen.getByText('2.6K/m')).toBeTruthy()
  })

  it('shows clearly labeled earlier detections without an expanding stack', () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', at: now - 2 * 60_000 }),
      makeMoment({ login: 'sodapoppin', displayName: 'sodapoppin', streamId: 's2', at: now - 45 * 60_000 }),
    ]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getByText('xQc')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Earlier detections' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /recent detections/i })).toBeNull()
    expect(screen.getByText('sodapoppin')).toBeTruthy()
  })

  it('counts the compact preview and reveals every loaded detection across both tiers', () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = Array.from({ length: 10 }, (_, index) => makeMoment({
      login: `creator${index}`,
      displayName: `Creator ${index}`,
      streamId: `stream-${index}`,
      publicMomentId: `moment-${index}`,
      offsetSeconds: 60 + index,
      at: now - (index < 6 ? index + 1 : index + 35) * 60_000,
    }))

    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(screen.getAllByRole('article')).toHaveLength(7)
    expect(screen.getByText('Showing 7 of 10 loaded detections')).toBeTruthy()
    expect(screen.queryByText('Creator 9')).toBeNull()

    const reveal = screen.getByRole('button', { name: 'Show all 10' })
    expect(reveal.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(reveal.getAttribute('aria-controls') ?? '')).toBeTruthy()
    fireEvent.click(reveal)
    expect(screen.getAllByRole('article')).toHaveLength(10)
    expect(screen.getByText('Creator 9')).toBeTruthy()
    expect(screen.getByText('Showing 10 of 10 loaded detections')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show preview' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Show preview' }))
    expect(screen.getAllByRole('article')).toHaveLength(7)
    expect(screen.getByText('Showing 7 of 10 loaded detections')).toBeTruthy()
  })

  it('inspects an older detection only after the parent proves its bucket is loaded', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', streamId: 's1', at: Date.now() - 45 * 60_000 })]
    const onSelectMoment = vi.fn()
    renderFeed(resolveLivePulseMoments(hub), hub, { onSelectMoment, canSelectMoment: () => true })
    fireEvent.click(screen.getByRole('button', { name: /^Show .* on chart$/ }))
    expect(onSelectMoment).toHaveBeenCalledWith(expect.objectContaining({ streamId: 's1' }))
  })

  it('selects the matching chart moment without nesting navigation links', () => {
    const { hub, feed } = networkFeed()
    const onSelectMoment = vi.fn()
    renderFeed(feed, hub, { onSelectMoment, canSelectMoment: () => true })
    const action = screen.getAllByRole('button', { name: /^Show .* on chart$/ })[0]
    fireEvent.click(action)
    expect(onSelectMoment).toHaveBeenCalledWith(expect.objectContaining({ login: 'xqc' }))
    expect(action.querySelector('a')).toBeNull()
  })

  it('preserves the exact analytics login, stream, and offset without a rendered chart bucket', () => {
    const { hub, feed } = networkFeed()
    renderFeed(feed, hub, { onSelectMoment: vi.fn(), canSelectMoment: () => false })
    expect(screen.queryByRole('button', { name: /^Show .* on chart$/ })).toBeNull()
    expect(screen.getAllByRole('link', { name: /^Stream analytics for / })[0].getAttribute('href'))
      .toBe('/analytics/xqc/s1#t=60')
    expect(screen.getAllByRole('link', { name: /^Open moment for / })[0].getAttribute('href'))
      .toBe('/analytics/moments?view=recent&login=xqc&stream=s1&offset=60')
  })

  it('keeps evidence but withholds Open and Save when exact discovery identity is unresolved', () => {
    const unresolvedHub = sampleHub()
    unresolvedHub.livePulseMoments = [makeMoment({ login: '', streamId: undefined, publicMomentId: undefined })]
    renderFeed(resolveLivePulseMoments(unresolvedHub), unresolvedHub)
    expect(screen.getByText('Comparison unavailable')).toBeTruthy()
    expect(screen.getByText('Moment identity unavailable')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Stream analytics for / })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Open moment for / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Save / })).toBeNull()
  })

  it('keeps exact public moment and stream identity on a compact row', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', publicMomentId: 'pm-exact', streamId: 's-exact' })]
    renderFeed(resolveLivePulseMoments(hub), hub)
    const row = document.querySelector('[data-public-moment-id="pm-exact"]')
    expect(row?.getAttribute('data-stream-id')).toBe('s-exact')
  })

  it('only marks the identity-verified row selected', () => {
    const hub = sampleHub()
    hub.livePulseMoments = ['pm-a', 'pm-b'].map((publicMomentId, index) => makeMoment({
      login: 'xqc', streamId: 's1', publicMomentId, offsetSeconds: 60 + index,
    }))
    const feed = resolveLivePulseMoments(hub)
    const selected = feed.moments.find(moment => moment.publicMomentId === 'pm-b')
    const { container } = renderFeed(feed, hub, {
      selectedMomentKey: selected ? momentRowKey(selected) : null,
      onSelectMoment: vi.fn(), canSelectMoment: moment => moment.publicMomentId === 'pm-b',
    })
    expect(container.querySelectorAll('.is-selected')).toHaveLength(1)
    expect(container.querySelector('.is-selected')?.getAttribute('data-public-moment-id')).toBe('pm-b')
  })

  it('dedupes public IDs that resolve to the same exact stream minute identity', () => {
    const hub = sampleHub()
    const at = Date.now() - 60_000
    hub.livePulseMoments = [makeMoment({ login: 'xqc', streamId: 's1', publicMomentId: 'pm-a', offsetSeconds: 60, at })]
    hub.livePulseMoments = [
      ...hub.livePulseMoments,
      makeMoment({ login: 'xqc', streamId: 's1', publicMomentId: 'pm-b', offsetSeconds: 60, at }),
    ]
    renderFeed(resolveLivePulseMoments(hub), hub)
    expect(document.querySelectorAll('[data-public-moment-id="pm-a"], [data-public-moment-id="pm-b"]')).toHaveLength(1)
  })

  it('dedupes the exact moment identity without a second filter surface', () => {
    const hub = sampleHub()
    const exact = makeMoment({ login: 'xqc', streamId: 's1', publicMomentId: 'pm-a', category: 'Minecraft' })
    hub.livePulseMoments = [exact, { ...exact }]
    renderFeed(resolveLivePulseMoments(hub), hub)

    expect(document.querySelectorAll('[data-public-moment-id="pm-a"]')).toHaveLength(1)
    // The rail is an arrivals ticker; the Moments table owns filtering, so a
    // duplicated control set never competes with it here.
    expect(screen.queryByLabelText('Live Wire order')).toBeNull()
    expect(screen.queryByLabelText('Loaded detections category')).toBeNull()
    expect(screen.queryByLabelText('Live Wire event type')).toBeNull()
    expect(document.querySelectorAll('.hub-live-wire select')).toHaveLength(0)
  })

  it('queues arrivals while explicitly paused and resumes on request', async () => {
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1', publicMomentId: 'pm-a' })]
    const rendered = renderFeed(resolveLivePulseMoments(hub), hub, { pollSequence: 0 })
    await vi.waitFor(() => expect(screen.getByText('xQc')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    hub.livePulseMoments = [...hub.livePulseMoments, makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's2', publicMomentId: 'pm-b', at: Date.now() - 10_000 })]
    rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={1} /></AnalyticsThemeProvider></MemoryRouter>)

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Resume live · 1 new' })).toBeTruthy())
    expect(screen.queryByText('Jynxzi')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Resume live · 1 new' }))
    expect(screen.getByText('Jynxzi')).toBeTruthy()
  })

  it.each(['explicit', 'pointer'] as const)('retains displaced arrivals on %s resume and later polls', (mode) => {
    const hub = sampleHub()
    const original = makeMoment({ login: 'xqc', streamId: 's1', publicMomentId: 'pm-a' })
    const arrival = makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's2', publicMomentId: 'pm-b', at: Date.now() - 10_000 })
    hub.livePulseMoments = [original]
    const view = renderFeed(resolveLivePulseMoments(hub), hub)
    const poll = (moments: HubLivePulseMoment[], sequence: number) => {
      hub.livePulseMoments = moments
      view.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={sequence} /></AnalyticsThemeProvider></MemoryRouter>)
    }
    const list = screen.getByRole('list')
    if (mode === 'explicit') fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    else fireEvent.pointerEnter(list)
    poll([original, arrival], 1)
    poll([original, { ...arrival, chatPerMin: 654 }], 2)
    poll([original], 3)
    expect(screen.getByRole('button', { name: 'Resume live · 1 new' })).toBeTruthy()
    if (mode === 'explicit') fireEvent.click(screen.getByRole('button', { name: 'Resume live · 1 new' }))
    else fireEvent.pointerLeave(list)
    expect(screen.getByText('Jynxzi')).toBeTruthy()
    expect(screen.getByText('654/m')).toBeTruthy()
    poll([original], 4)
    expect(screen.getByText('Jynxzi')).toBeTruthy()
    expect(screen.getByText('654/m')).toBeTruthy()
    poll([original, { ...arrival, publicMomentId: 'pm-revised', chatPerMin: 987 }], 5)
    expect(screen.getAllByText('Jynxzi')).toHaveLength(1)
    expect(screen.getByText('987/m')).toBeTruthy()
    poll([original], 6)
    expect(screen.getAllByText('Jynxzi')).toHaveLength(1)
    expect(screen.getByText('987/m')).toBeTruthy()
    expect(document.querySelector('[data-public-moment-id="pm-revised"]')).toBeTruthy()
  })

  it('bounds queued identities and expires displaced arrivals outside the live window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'))
    const hub = sampleHub()
    const original = makeMoment({ login: 'xqc', streamId: 's1' })
    hub.livePulseMoments = [original]
    const view = renderFeed(resolveLivePulseMoments(hub), hub)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    for (let index = 0; index < 25; index++) {
      hub.livePulseMoments = [original, makeMoment({
        login: `creator${index}`, displayName: `Arrival ${index}`, streamId: `stream-${index}`, at: Date.now() - 1000,
      })]
      view.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={index + 1} /></AnalyticsThemeProvider></MemoryRouter>)
    }
    expect(screen.getByRole('button', { name: 'Resume live · 20 new' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(31 * 60_000))
    hub.livePulseMoments = [original]
    view.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={26} /></AnalyticsThemeProvider></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Resume live' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resume live' }))
    expect(screen.queryByText(/^Arrival /)).toBeNull()
    expect(screen.getByText('xQc')).toBeTruthy()
  })

  it('labels an aged item earlier instead of hiding the feed', () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-04T20:00:00Z')
    vi.setSystemTime(now)
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', streamId: 's1', at: now.getTime() - 29 * 60_000 })]
    renderFeed(resolveLivePulseMoments(hub), hub)

    act(() => vi.advanceTimersByTime(2 * 60_000))
    expect(screen.getByText(/No loaded detections in the last 30 minutes/)).toBeTruthy()
    expect(screen.getByText('xQc')).toBeTruthy()
    vi.useRealTimers()
  })

  it('keeps a row visible when it ages out while keyboard focus is inside it', () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-04T20:00:00Z')
    vi.setSystemTime(now)
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', streamId: 's1', at: now.getTime() - 29 * 60_000 })]
    renderFeed(resolveLivePulseMoments(hub), hub)

    const save = screen.getByRole('button', { name: /^Save / })
    act(() => save.focus())
    act(() => vi.advanceTimersByTime(2 * 60_000))
    expect(screen.getByText('xQc')).toBeTruthy()
    expect(document.activeElement).toBe(save)

    fireEvent.blur(save, { relatedTarget: null })
    expect(screen.getByText('xQc')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Earlier detections' })).toBeTruthy()
    vi.useRealTimers()
  })

  it('badges a new healthy-network event and enters it from the chart-reading direction', async () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
    const rendered = renderFeed(resolveLivePulseMoments(hub), hub, { pollSequence: 0 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    hub.livePulseMoments = [...hub.livePulseMoments, makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3', at: now - 30_000 })]
    rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={1} /></AnalyticsThemeProvider></MemoryRouter>)
    await vi.waitFor(() => expect(screen.getByText('NEW')).toBeTruthy())
    expect(gsapFrom).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ x: -24, opacity: 0 }))
  })

  it('clears NEW on the following healthy poll when no newer identity arrived', async () => {
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', streamId: 's1', publicMomentId: 'pm-a' })]
    const rendered = renderFeed(resolveLivePulseMoments(hub), hub, { pollSequence: 0 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    hub.livePulseMoments = [...hub.livePulseMoments, makeMoment({ login: 'jynxzi', streamId: 's2', publicMomentId: 'pm-b', at: Date.now() - 10_000 })]
    rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={1} /></AnalyticsThemeProvider></MemoryRouter>)
    await vi.waitFor(() => expect(screen.getByText('NEW')).toBeTruthy())

    rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={2} /></AnalyticsThemeProvider></MemoryRouter>)
    await vi.waitFor(() => expect(screen.queryByText('NEW')).toBeNull())
  })

  it('does not rebadge an identity that disappears and reappears within the live window', async () => {
    const hub = sampleHub()
    const original = makeMoment({ login: 'xqc', streamId: 's1', publicMomentId: 'pm-a' })
    hub.livePulseMoments = [original]
    const rendered = renderFeed(resolveLivePulseMoments(hub), hub, { pollSequence: 0 })
    await new Promise((resolve) => setTimeout(resolve, 20))

    act(() => {
      hub.livePulseMoments = []
      rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={1} /></AnalyticsThemeProvider></MemoryRouter>)
    })
    act(() => {
      hub.livePulseMoments = [original]
      rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={2} /></AnalyticsThemeProvider></MemoryRouter>)
    })

    await vi.waitFor(() => expect(screen.getByText('xQc')).toBeTruthy())
    expect(screen.queryByText('NEW')).toBeNull()
  })

  it('keeps semantic NEW but suppresses motion for reduced-motion users', async () => {
    const now = Date.now()
    const hub = sampleHub()
    hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
    const rendered = renderFeed(resolveLivePulseMoments(hub), hub, { reducedMotion: true, pollSequence: 0 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    hub.livePulseMoments = [...hub.livePulseMoments, makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3', at: now - 30_000 })]
    rendered.rerender(<MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={1} /></AnalyticsThemeProvider></MemoryRouter>)
    await vi.waitFor(() => expect(screen.getByText('NEW')).toBeTruthy())
    expect(gsapFrom).not.toHaveBeenCalled()
  })

  it('filters lifecycle events and explains degraded source state', () => {
    const hub = sampleHub()
    hub.livePulseMoments = [
      makeMoment({ login: 'jynxzi', displayName: 'Jynxzi', streamId: 's3' }),
      { ...makeMoment({ login: 'pool', displayName: 'pool', streamId: 's9' }), kind: 'stream_opening', label: 'Just went live' },
    ]
    renderFeed(resolveLivePulseMoments(hub), hub, { loadSource: 'stats-fallback', hubEndpointOk: false })
    expect(screen.getByText('Jynxzi')).toBeTruthy()
    expect(screen.queryByText('pool')).toBeNull()
    expect(screen.getByText(/live network feed paused/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Snapshot detections' })).toBeTruthy()
    expect(document.querySelector('.hub-live-wire__rail-tier--live')).toBeNull()
    expect(document.querySelectorAll('.hub-live-wire').length).toBe(1)
  })

  it('does not label cache-hydrated network moments as live cadence', () => {
    const { hub, feed } = networkFeed()
    renderFeed(feed, hub, { loadSource: 'cache', hubEndpointOk: true })

    expect(screen.getByText('snapshot · not live network cadence')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Snapshot detections' })).toBeTruthy()
    expect(screen.queryByText('Last 30 minutes')).toBeNull()
  })
})


it('holds arrivals while reading without claiming the feed is paused', () => {
  const hub = sampleHub()
  hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
  renderFeed(resolveLivePulseMoments(hub), hub)
  expect(screen.getByText('Following newest')).toBeTruthy()
  fireEvent.pointerEnter(screen.getByRole('list'))
  expect(screen.getByText('Holding updates while you read')).toBeTruthy()
  expect(screen.queryByText('Paused')).toBeNull()
  expect(screen.queryByRole('button', { name: /Resume live/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(screen.getByText('Paused')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Resume live' })).toBeTruthy()
})

it('keeps pinned chart review independent and resumes arrivals after pointer leaves', async () => {
  const hub = sampleHub()
  hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
  const view = renderFeed(resolveLivePulseMoments(hub), hub)
  const list = screen.getByRole('list')
  fireEvent.pointerEnter(list)
  hub.livePulseMoments = [...hub.livePulseMoments, makeMoment({ login: 'newcreator', displayName: 'New Creator', streamId: 's2', at: Date.now() - 10_000 })]
  const updated = <MemoryRouter><AnalyticsThemeProvider><HubLiveWireFeed hub={hub} feed={resolveLivePulseMoments(hub)} loadSource="full" hubEndpointOk pollSequence={1} /></AnalyticsThemeProvider></MemoryRouter>
  view.rerender(updated)
  expect(screen.queryByText('New Creator')).toBeNull()
  expect(screen.getByRole('button', { name: 'Resume live · 1 new' })).toBeTruthy()
  fireEvent.pointerLeave(list)
  await vi.waitFor(() => expect(screen.getByText('New Creator')).toBeTruthy())
  expect(screen.queryByRole('button', { name: /Resume live/ })).toBeNull()
})

it('leaves confirmed lifecycle transitions to Pool Wire instead of mirroring them', () => {
  const hub = sampleHub()
  const occurredAt = new Date(Date.now() - 10_000).toISOString()
  hub.liveActivity = { status: 'ready', asOf: new Date().toISOString(), events: [{ id: 'start', kind: 'went_live', channel: { id: 'creator', login: 'lifecycle', displayName: 'Lifecycle Creator' }, streamId: 'stream-1', occurredAt, detectedAt: occurredAt, timestampPrecision: 'twitch_started_at' }] }
  hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc' })]
  renderFeed(resolveLivePulseMoments(hub), hub)
  expect(screen.getByText('xQc')).toBeTruthy()
  expect(screen.queryByText('Lifecycle Creator')).toBeNull()
  // Nothing claims stream events are missing: the rail never promised them.
  expect(screen.queryByText(/Stream events unavailable/i)).toBeNull()
})

it('styles a below-baseline comparison as a dip rather than a spike', () => {
  const hub = sampleHub()
  const at = Date.now() - 60_000
  const sample = comparison(at)
  hub.livePulseMoments = [makeMoment({
    login: 'xqc', displayName: 'xQc', streamId: 's1', kind: 'emote_spike', label: 'Emote spike', at,
    comparison: { ...sample, emotes: { ...sample.emotes, multiplier: 0.1 } },
  })]
  renderFeed(resolveLivePulseMoments(hub), hub)
  const magnitude = screen.getByTitle(/Emotes 0\.1× this stream's earlier average/i)
  expect(magnitude.textContent).toBe('0.1×')
  expect(magnitude.getAttribute('data-below')).toBe('true')
  // The detector's own label is preserved verbatim, not rewritten in the client.
  expect(screen.getByText('Emote spike')).toBeTruthy()
})

it('opens an inspectable row from anywhere that is not another control', () => {
  const hub = sampleHub()
  hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
  const onSelectMoment = vi.fn()
  renderFeed(resolveLivePulseMoments(hub), hub, { onSelectMoment, canSelectMoment: () => true })

  fireEvent.click(screen.getByText('xQc'))
  expect(onSelectMoment).toHaveBeenCalledWith(expect.objectContaining({ login: 'xqc' }))

  // A nested link keeps its own navigation rather than selecting the bucket.
  onSelectMoment.mockClear()
  fireEvent.click(screen.getByRole('link', { name: /^Open moment for / }))
  expect(onSelectMoment).not.toHaveBeenCalled()
})

it('does not make a row clickable when the parent cannot prove its bucket', () => {
  const hub = sampleHub()
  hub.livePulseMoments = [makeMoment({ login: 'xqc', displayName: 'xQc', streamId: 's1' })]
  const onSelectMoment = vi.fn()
  renderFeed(resolveLivePulseMoments(hub), hub, { onSelectMoment, canSelectMoment: () => false })
  fireEvent.click(screen.getByText('xQc'))
  expect(onSelectMoment).not.toHaveBeenCalled()
  expect(document.querySelector('.is-inspectable')).toBeNull()
})
