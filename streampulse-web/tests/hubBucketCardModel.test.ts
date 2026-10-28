import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildHubBucketCardModel,
  formatHubCardInt,
  formatHubCardRate,
  hubCardClockRange,
  hubCardMoments,
  hubMomentStrength,
  HUB_MOMENTS_TEXT,
  sortHubMomentsByChat,
  type HubCardFormatOptions,
} from '../src/lib/hubBucketCardModel'
import { loadHubIntervalMoments, resetHubIntervalMomentsForTests } from '../src/lib/hubIntervalMoments'
import { clearBucketMomentsCache } from '../src/lib/bucketMomentsCache'
import type { HubActivityPoint, HubLivePulseMoment, PublicHubMomentsResponse } from '../src/lib/publicHub'

const requestHubBucketMoments = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/prefetchHubBucketMoments', () => ({ requestHubBucketMoments }))

/** The mockup's own test pins America/Phoenix (UTC-7, no DST); so does this one. */
const PHX: HubCardFormatOptions = { locale: 'en-US', timeZone: 'America/Phoenix' }
const MIN = 60_000

/* ---------- synthetic points (run everywhere) ---------- */

function point(t: number, overrides: Partial<HubActivityPoint> = {}): HubActivityPoint {
  return {
    t,
    chat: 600,
    emotes: 300,
    seventv: 120,
    twitch: 170,
    bttv: 6,
    ffz: 12,
    viewers: 280_000,
    viewerContributors: 45,
    viewerExpectedContributors: 500,
    viewerCoverage: 'complete',
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
    topEmotes: [
      { name: 'LUL', provider: 'twitch', imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/3.0', count: 60 },
      { name: 'om', provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/a/4x.webp', count: 2 },
    ],
    ...overrides,
  }
}

// 2026-10-11 12:00 PM MST
const NOON = Date.UTC(2026, 9, 11, 19, 0)

describe('hub bucket card model: formatting', () => {
  it('formats rates like the mockup: whole from 10, one decimal under, "<0.1" for traces', () => {
    expect(formatHubCardRate(12.6)).toBe('13')
    expect(formatHubCardRate(1234.4)).toBe('1,234')
    expect(formatHubCardRate(0.33)).toBe('0.3')
    expect(formatHubCardRate(0.04)).toBe('<0.1')
    expect(formatHubCardRate(0)).toBe('0')
    expect(formatHubCardRate(null)).toBe('—')
    expect(formatHubCardInt(28_418)).toBe('28,418')
    expect(formatHubCardInt(Number.NaN)).toBe('—')
  })

  it('shares the day period in a clock range, and spells both when it changes', () => {
    expect(hubCardClockRange(NOON, NOON + 6 * MIN, PHX)).toBe('12:00–12:06 PM')
    expect(hubCardClockRange(NOON - 6 * MIN, NOON, PHX)).toBe('11:54 AM–12:00 PM')
  })
})

describe('hub bucket card model: synthetic buckets', () => {
  const points = [0, 1, 2, 3].map(i => point(NOON + i * 6 * MIN, {
    chat: 600 + i * 60,
    emotes: 300 + i * 30,
    viewers: 280_000 + i * 1_000,
    viewerContributors: 44 + i,
  }))

  it('returns null outside the points', () => {
    expect(buildHubBucketCardModel({ points, bucketMinutes: 6, t: NOON - 1, format: PHX })).toBeNull()
    expect(buildHubBucketCardModel({ points, bucketMinutes: 6, t: NOON + 24 * MIN, format: PHX })).toBeNull()
  })

  it('builds the F4 anatomy for one server bucket', () => {
    const model = buildHubBucketCardModel({ points, bucketMinutes: 6, t: NOON + 3 * MIN, format: PHX })!
    expect(model.stateLabel).toBe('Bucket selected · 6 min')
    expect(model.title).toBe('12:00–12:06 PM')
    expect(model.clockLine).toBe('Oct 11 MST')
    expect(model.category).toBeNull()
    expect(model.tiles.map(tile => tile.label)).toEqual(['chat/min', 'emotes/min', 'viewers (sample)'])
    expect(model.tiles.map(tile => tile.value)).toEqual([100, 50, 280_000])
    // One bucket has no "busiest bucket inside the bar".
    expect(model.tiles[0].peak).toBeNull()
    expect(model.tiles[0].secondLine).toBeNull()
    expect(model.tiles[2].secondLine).toBe('44 of 500 live')
    expect(model.coverage).toEqual({ label: 'Full 6 min', partial: false, minutesMeasured: 6, minutesTotal: 6 })
    expect(model.topEmotesExact).toBe(true)
    expect(model.topEmotes.map(emote => [emote.name, emote.rateText])).toEqual([['LUL', '10'], ['om', '0.3']])
    expect(model.vod).toBeNull()
    expect(model.moments.state).toBe('idle')
    expect(model.summary).toBe('Bucket selected, 12:00 to 12:06 PM. Chat 100 per minute. Emotes 50 per minute. Viewers 280,000.')
  })

  it('peaks a multi-bucket bar at its busiest bucket and marks summed emotes "≥"', () => {
    const model = buildHubBucketCardModel({ points, bucketMinutes: 6, t: NOON, endT: NOON + 12 * MIN, format: PHX })!
    expect(model.stateLabel).toBe('Bucket selected · 12 min')
    expect(model.tiles[0].value).toBe(Math.round((600 + 660) / 12))
    expect(model.tiles[0].peak).toMatchObject({ value: 110, t: NOON + 6 * MIN, clockLabel: '12:06 PM' })
    expect(model.tiles[0].secondLine).toBe('peak 110 at 12:06 PM')
    expect(model.tiles[2].secondLine).toBe('≈45 of 500 live')
    expect(model.tiles[2].peak?.value).toBe(281_000)
    expect(model.topEmotesExact).toBe(false)
    expect(model.topEmotes[0]).toMatchObject({ name: 'LUL', count: 120, perMin: 10, rateText: '≥10' })
  })

  it('splits providers as 7TV and other = emotes − 7TV, with "≥" from the lower-bound flag', () => {
    const exact = buildHubBucketCardModel({ points, bucketMinutes: 6, t: NOON, format: PHX })!
    expect(exact.providers.map(p => [p.label, p.value, p.lowerBound, p.valueText])).toEqual([['7TV', 20, false, '20'], ['other', 30, false, '30']])
    expect(exact.providers[0].value! + exact.providers[1].value!).toBe(exact.tiles[1].value)
    expect(exact.providerDetail.every(p => !p.lowerBound)).toBe(true)

    const flagged = [point(NOON, { providerCountsLowerBound: true })]
    const lower = buildHubBucketCardModel({ points: flagged, bucketMinutes: 6, t: NOON, format: PHX })!
    expect(lower.providers[1]).toMatchObject({ value: 30, lowerBound: true, valueText: '≥30' })
    expect(lower.providers[0].lowerBound).toBe(false)
    expect(lower.providerDetail.map(p => [p.label, p.lowerBound])).toEqual([['7TV', false], ['Twitch', true], ['BTTV', true], ['FFZ', true]])
    expect(lower.providerNote).toBe('Separate tallies per provider, per min: 7TV 20 · Twitch ≥28 · BTTV ≥1 · FFZ ≥2. They can count one use twice, so the card shows 7TV and the rest of the total.')
  })

  it('takes viewers only from qualified buckets (viewerCoverage != null)', () => {
    const mixed = [point(NOON), point(NOON + 6 * MIN, { viewerCoverage: undefined, viewers: 1_097_952 })]
    const model = buildHubBucketCardModel({ points: mixed, bucketMinutes: 6, t: NOON, endT: NOON + 12 * MIN, format: PHX })!
    expect(model.tiles[2].value).toBe(280_000)
    expect(model.tiles[2].sub).toBe('45 of 500 live · 1 of 2 intervals not a full sample')
    expect(model.tiles[2].secondLine).toBe('45 of 500 live')
    const unqualified = buildHubBucketCardModel({ points: [point(NOON, { viewerCoverage: undefined })], bucketMinutes: 6, t: NOON, format: PHX })!
    expect(unqualified.tiles[2].value).toBeNull()
    expect(unqualified.tiles[2].secondLine).toBe('Not a full sample')
  })

  it('says "Not measured" for gaps instead of zeros, and flags an open bucket', () => {
    const gap = buildHubBucketCardModel({ points: [point(NOON, { gapKind: 'attested', hasChatRollup: false, chat: 0, emotes: 0 })], bucketMinutes: 6, t: NOON, format: PHX })!
    expect(gap.gap).toBe(true)
    expect(gap.stateLabel).toBe('Bucket selected')
    expect(gap.tiles.map(tile => tile.valueText)).toEqual(['—', '—', '—'])
    expect(gap.coverage.label).toBe('0 of 6 min measured')
    expect(gap.summary).toBe('Bucket selected, 12:00 to 12:06 PM. Not measured.')

    const open = buildHubBucketCardModel({ points: [point(NOON, { bucketComplete: false })], bucketMinutes: 6, t: NOON, format: PHX })!
    expect(open.inProgress).toBe(true)
    // A legacy point without the flag is not "in progress" (the old bucket inspector's rule).
    expect(buildHubBucketCardModel({ points: [point(NOON, { bucketComplete: undefined })], bucketMinutes: 6, t: NOON, format: PHX })!.inProgress).toBe(false)
  })

  it('reports top emotes as unavailable after a cache hydrate dropped them', () => {
    const model = buildHubBucketCardModel({ points: [point(NOON, { topEmotes: undefined })], bucketMinutes: 6, t: NOON, format: PHX })!
    expect(model.topEmotesAvailable).toBe(false)
    expect(model.topEmotes).toEqual([])
  })

  it('never merges two emotes that share a name but not an image', () => {
    const model = buildHubBucketCardModel({
      points: [point(NOON, {
        topEmotes: [
          { name: 'om', provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/a/4x.webp', count: 30 },
          { name: 'om', provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/b/4x.webp', count: 18 },
        ],
      })],
      bucketMinutes: 6,
      t: NOON,
      format: PHX,
    })!
    expect(model.topEmotes.map(emote => [emote.name, emote.count])).toEqual([['om', 30], ['om', 18]])
  })
})

describe('hub bucket card model: moments', () => {
  const comparison = (minutes: number, chat: number, emotes: number, emotesState = 'ready') => ({
    baselineKind: 'current_stream_measured_average_before_event' as const,
    eventAt: NOON,
    baselineWindow: { start: NOON - minutes * MIN, end: NOON, expectedMinutes: minutes, measuredMinutes: minutes, coveragePct: 100 },
    chat: { state: 'ready' as const, multiplier: chat, currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: minutes, baselineExpectedMinutes: minutes, baselineCoveragePct: 100 },
    emotes: { state: emotesState as 'ready', multiplier: emotes, currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: minutes, baselineExpectedMinutes: minutes, baselineCoveragePct: 100 },
    evidence: { ircBound: true, eventRollupAvailable: true, baselineMeasuredMinutes: minutes, baselineExpectedMinutes: minutes, baselineCoveragePct: 100 },
  })
  const moment = (login: string, chatPerMin: number, extra: Partial<HubLivePulseMoment> = {}): HubLivePulseMoment => ({
    offsetSeconds: 60, score: 1, label: 'Chat spike', login, displayName: login, at: NOON + MIN, chatPerMin, emotesPerMin: 4, ...extra,
  })

  it('uses a backend multiplier as strength only with ≥10 measured baseline minutes, never a score', () => {
    expect(hubMomentStrength(moment('a', 1, { comparison: comparison(9, 3, 2) }))).toBeNull()
    expect(hubMomentStrength(moment('a', 1, { comparison: comparison(12, 3, 2) }))).toBe(3)
    expect(hubMomentStrength(moment('a', 1, { comparison: comparison(12, 3, 5, 'warming') }))).toBe(3)
    expect(hubMomentStrength(moment('a', 1))).toBeNull()
  })

  it('sorts by chat/min and labels the plan §1.8 states', () => {
    expect(sortHubMomentsByChat([moment('a', 5), moment('b', 50), moment('c', 20)]).map(row => row.login)).toEqual(['b', 'c', 'a'])
    const ready = hubCardMoments({ status: 'ready', rows: [moment('a', 5), moment('b', 50)], total: 2, atLimit: false, totalLabel: '2', bucketsTotal: 1 }, PHX)
    expect(ready.items.map(item => item.channel)).toEqual(['b', 'a'])
    expect(ready.items[0]).toMatchObject({ id: `b:${NOON + MIN}`, clockLabel: '12:01 PM', label: '50 chat/min · 4 emotes/min', strength: null })
    expect(ready.showLabel).toBe('Show 2 moments')
    expect(hubCardMoments({ status: 'ready', rows: [moment('a', 5)], total: 1, atLimit: false, totalLabel: '1', bucketsTotal: 1 }).showLabel).toBe('Show 1 moment')
    expect(hubCardMoments({ status: 'loading', bucketsRead: 0, bucketsTotal: 1 }).stateText).toBe('Loading moments…')
    expect(hubCardMoments({ status: 'error', error: new Error('x'), retryAfterMs: null, bucketsRead: 0, bucketsTotal: 1 }).stateText).toBe("Moments didn't load · Retry")
    expect(hubCardMoments({ status: 'empty', bucketsTotal: 1 }).stateText).toBe('No moments in this bucket')
    expect(hubCardMoments({ status: 'zoom-in' }).stateText).toBe('Zoom in to list moments')
    expect(HUB_MOMENTS_TEXT.zoomIn).toBe('Zoom in to list moments')
  })
})

/* ---------- parity with the pinned mockup fixture (card-model.test.mjs, minus "usual") ---------- */

/**
 * Opt-in: set SP_D3_FIXTURE_PATH to the pinned mockup fixture (fixture.js).
 * The fixture is local evidence and is not committed; without it this block skips.
 */
const FIXTURE = process.env.SP_D3_FIXTURE_PATH?.trim() ?? ''

type FixtureTop = [string, number, number?]
interface FixturePoint extends Omit<HubActivityPoint, 'topEmotes' | 'other' | 'viewerCoverage'> {
  top?: FixtureTop[]
  other?: number | null
  viewerCoverage?: string | null
}
interface Fixture {
  hub: {
    activity: {
      bucketMinutes: number
      points: FixturePoint[]
      pointFlags: { allBucketComplete: boolean }
      derived: { peakChatPerMin: { value: number } }
    }
    bucketMoments: { bucketT: number; status: string; moments: Array<Record<string, unknown> & { topEmotes?: Array<{ code: string; provider?: string; count: number }> }> }
  }
}

/** The fixture as the app sees it: `top` tuples become `topEmotes`, nulls become absent. */
function loadFixture() {
  const ctx: Record<string, unknown> = {}
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(readFileSync(FIXTURE, 'utf8'), ctx, { filename: 'fixture.js' })
  const emoteUrl = ctx.SP_EMOTE as (tuple: FixtureTop) => string | null
  const raw = ctx.SP_DATA as Fixture
  const A = raw.hub.activity
  const points: HubActivityPoint[] = A.points.map((p) => {
    const { top, other, viewerCoverage, ...rest } = p
    return {
      ...rest,
      ...(other != null ? { other } : {}),
      ...(viewerCoverage != null ? { viewerCoverage } : {}),
      // The fixture drops per-point bucketComplete; pointFlags records that every raw point said true.
      bucketComplete: A.pointFlags.allBucketComplete,
      topEmotes: (top ?? []).map(tuple => ({ name: tuple[0], count: tuple[1], imageUrl: emoteUrl(tuple) ?? undefined })),
    }
  })
  const BMo = raw.hub.bucketMoments
  const response: PublicHubMomentsResponse = {
    bucketT: BMo.bucketT,
    bucketStart: '',
    bucketEnd: '',
    hubGeneratedAt: '',
    source: 'corpus_historical',
    status: BMo.status,
    activityWindowMinutes: 1440,
    moments: BMo.moments.map(({ comparison, topEmotes, ...m }) => ({
      ...(m as unknown as HubLivePulseMoment),
      ...(comparison != null ? { comparison: comparison as HubLivePulseMoment['comparison'] } : {}),
      topEmotes: (topEmotes ?? []).map(e => ({ name: e.code, provider: e.provider, count: e.count, sharePct: 0 })),
    })),
  }
  return { points, bucketMinutes: A.bucketMinutes, derived: A.derived, response }
}

describe.skipIf(!FIXTURE || !existsSync(FIXTURE))('hub bucket card model: pinned d3-v2 fixture parity', () => {
  const F = FIXTURE && existsSync(FIXTURE) ? loadFixture() : null!
  const bucketT = F?.response.bucketT

  beforeEach(() => {
    clearBucketMomentsCache()
    resetHubIntervalMomentsForTests()
    requestHubBucketMoments.mockReset()
    // The fixture holds hub/moments for ONE bucket. Any other bucket answers empty here: a stand-in for the code path, not data.
    requestHubBucketMoments.mockImplementation(async ({ bucketT: t }: { bucketT: number }) => (t === F.response.bucketT
      ? F.response
      : { ...F.response, bucketT: t, status: 'empty', moments: [] }))
  })

  const cardFor = async (t: number, endT?: number) => {
    const moments = await loadHubIntervalMoments({ t, endT, activityWindow: '24h', bucketMinutes: F.bucketMinutes })
    return buildHubBucketCardModel({ points: F.points, bucketMinutes: F.bucketMinutes, t, endT, moments, format: PHX })!
  }

  // SP_U03_EVIDENCE_DIR: write the card text the parity cases saw (no channel names, no moment rows).
  const evidence: Record<string, unknown> = {}
  const record = (name: string, model: ReturnType<typeof buildHubBucketCardModel>) => {
    if (!model) return
    evidence[name] = {
      stateLabel: model.stateLabel,
      title: model.title,
      clockLine: model.clockLine,
      coverage: model.coverage.label,
      inProgress: model.inProgress,
      tiles: model.tiles.map(tile => ({ label: tile.label, valueText: tile.valueText, secondLine: tile.secondLine, sub: tile.sub })),
      providers: model.providers.map(provider => `${provider.label} ${provider.valueText}`),
      topEmotesExact: model.topEmotesExact,
      topEmoteRates: model.topEmotes.map(emote => emote.rateText),
      moments: { state: model.moments.state, totalLabel: model.moments.totalLabel, showLabel: model.moments.showLabel, rows: model.moments.items.length },
    }
  }
  afterAll(() => {
    const dir = process.env.SP_U03_EVIDENCE_DIR
    if (!dir || Object.keys(evidence).length === 0) return
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'card-model-parity.json'), `${JSON.stringify({
      fixture: FIXTURE.replace(/\\/g, '/'),
      zone: PHX.timeZone,
      note: 'Fixture moments exist for one bucket; other buckets answered empty as a code-path stand-in.',
      cases: evidence,
    }, null, 2)}\n`)
  })

  it('1. the peak-chat bucket matches the mockup', async () => {
    const h1 = await cardFor(bucketT)
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(1)
    expect(h1.tiles[0].value).toBe(F.derived.peakChatPerMin.value)
    expect(h1.moments.total).toBe(10)
    expect(h1.moments.totalIsMinimum).toBe(true)
    expect(h1.moments.totalLabel).toBe('10+')
    expect(h1.moments.showLabel).toBe('Show 10+ moments')
    expect(h1.moments.items[0].channel).toBe('SondergaardLol')
    expect(h1.moments.items.every(item => item.strength === null)).toBe(true)
    expect(h1.providerDetail.slice(1).every(provider => provider.lowerBound)).toBe(true)
    expect(h1.providers).toHaveLength(2)
    expect(h1.providers[0].value! + h1.providers[1].value!).toBe(h1.tiles[1].value)
    expect(h1.topEmotes[0].perMin).toBe(h1.topEmotes[0].count / 6)
    expect(h1.inProgress).toBe(false)
    expect(h1.vod).toBeNull()
    expect(h1.range.clockLabel).toBe('12:00–12:06 PM')
    // F4 fields
    expect(h1.stateLabel).toBe('Bucket selected · 6 min')
    expect(h1.title).toBe('12:00–12:06 PM')
    expect(h1.clockLine).toBe('Oct 11 MST')
    expect(h1.category).toBeNull()
    expect(h1.tiles.map(tile => tile.label)).toEqual(['chat/min', 'emotes/min', 'viewers (sample)'])
    expect(h1.topEmotesExact).toBe(true)
    expect(h1.topEmotes[0].rateText.startsWith('≥')).toBe(false)
    // "other" carries "≥" because this bucket's provider counts are a lower bound (plan §1.5).
    expect(h1.providers[1].lowerBound).toBe(true)
    expect(h1.providers[1].valueText.startsWith('≥')).toBe(true)
    // No client usual and no fixture-only strings.
    const text = JSON.stringify(h1)
    expect(text).not.toMatch(/usual|mockup/i)
    record('1-peak-bucket', h1)
  })

  it('1b. the 12-min bar holding the peak', async () => {
    const g12 = Math.floor(bucketT / (12 * MIN)) * 12 * MIN
    const h1b = await cardFor(g12, g12 + 12 * MIN)
    expect(requestHubBucketMoments).toHaveBeenCalledTimes(2)
    expect(h1b.bucketMinutes).toBe(12)
    expect(h1b.moments.items).toHaveLength(10)
    expect(h1b.moments.totalLabel).toBe('10+')
    expect(h1b.stateLabel).toBe('Bucket selected · 12 min')
    expect(h1b.tiles[0].peak).toMatchObject({ value: F.derived.peakChatPerMin.value, clockLabel: '12:00 PM' })
    expect(h1b.tiles[0].secondLine).toBe(`peak ${formatHubCardInt(F.derived.peakChatPerMin.value)} at 12:00 PM`)
    expect(h1b.topEmotesExact).toBe(false)
    expect(h1b.topEmotes.every(emote => emote.rateText.startsWith('≥'))).toBe(true)
    expect(h1b.providers[0].value! + h1b.providers[1].value!).toBe(h1b.tiles[1].value)
    record('1b-12min-bar', h1b)
  })

  it('2. a quiet qualified bucket: no moments read yet, complete provider counts', () => {
    const qualified = F.points.filter(p => p.viewerCoverage === 'complete')
    const quiet = qualified.reduce((a, b) => (b.chat < a.chat ? b : a))
    const h2 = buildHubBucketCardModel({ points: F.points, bucketMinutes: F.bucketMinutes, t: quiet.t, format: PHX })!
    expect(h2.moments.items).toHaveLength(0)
    expect(h2.moments.total).toBeNull()
    expect(h2.providerDetail.every(provider => !provider.lowerBound)).toBe(true)
    record('2-quiet-qualified', h2)
  })

  it('2b. the lowest chat bucket overall is an unqualified viewer pass', () => {
    const low = F.points.reduce((a, b) => (b.chat < a.chat ? b : a))
    const h2b = buildHubBucketCardModel({ points: F.points, bucketMinutes: F.bucketMinutes, t: low.t, format: PHX })!
    expect(h2b.tiles[2].value).toBeNull()
    expect(h2b.tiles[2].sub).toBe('Not a full sample')
    record('2b-unqualified-viewers', h2b)
  })

  it('models every point with three tiles and a zone, and 7TV + other = emotes', () => {
    for (const p of F.points) {
      const model = buildHubBucketCardModel({ points: F.points, bucketMinutes: F.bucketMinutes, t: p.t, format: PHX })!
      expect(model.tiles).toHaveLength(3)
      expect(model.range.zone).toBe('MST')
      if (model.providers[0].value != null && model.providers[1].value != null && model.providers[1].value > 0) {
        expect(model.providers[0].value + model.providers[1].value).toBe(model.tiles[1].value)
      }
    }
    expect(buildHubBucketCardModel({ points: F.points, bucketMinutes: F.bucketMinutes, t: F.points[0].t - 1, format: PHX })).toBeNull()
  })
})
