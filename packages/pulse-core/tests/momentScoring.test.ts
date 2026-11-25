import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { performance } from 'node:perf_hooks'

import { parseEmoteKey } from '../src/emoteKey.ts'
import { resolveEmoteImageUrl } from '../src/emoteImageUrl.ts'
import { deriveLiveHeat, type LiveHeatCatalogEmote, type LiveHeatInput, type LiveHeatRollup } from '../src/liveHeat.ts'
import { buildMomentScoreModel, clampMomentScore } from '../src/momentScore.ts'
import {
  buildMomentScoringContext,
  catalogTopEmotes,
  computeMomentScore100,
  computeP95ReactionScore100,
  computeStreamBaselines,
  fallbackMomentScore100,
  topEmotesFromRollup,
  type CatalogTopEmote,
  type MomentReason,
  type MomentScoringRollup,
  type RollupEmoteHit,
  type StreamBaselines,
} from '../src/momentScoring.ts'
import {
  honestMomentReasonLabel,
  normalizeMinuteBucket,
  rollupFallbackMomentCandidates,
  type PortalMomentCandidate,
} from '../src/portalHeatmapMoments.ts'
import type { ReplayHeatmapPoint } from '../src/types/heatmap.ts'

// Oracle: the scoring as it was before the per-list context, which re-sorted the whole
// list and searched it with findIndex for every minute. Frozen here so that the faster
// path has to keep matching it bit for bit.
const oracle = (() => {
  const viewerValue = (point: MomentScoringRollup) =>
    point.viewerLatest || point.viewerAvg || point.viewerMax || 0

  function minuteEmoteTotal(point: MomentScoringRollup) {
    const total = point.totalEmoteCount ?? 0
    if (total > 0) return total
    if (!point.emotes) return 0
    return Object.values(point.emotes).reduce((sum, count) => sum + count, 0)
  }

  function getEmoteImageUrl(emote: { provider?: string; id?: string; imageUrl?: string }) {
    const url = resolveEmoteImageUrl({ provider: emote.provider, id: emote.id, imageUrl: emote.imageUrl, scale: '1x' })
    return url || undefined
  }

  function catalogLookupKey(item: CatalogTopEmote): string {
    const name = item.name.trim().toLowerCase()
    if (!name) return ''
    return `${(item.provider ?? 'unknown').toLowerCase()}:${name}`
  }

  function topEmotes(rollup: MomentScoringRollup, limit = 5, catalog?: CatalogTopEmote[]): RollupEmoteHit[] {
    if (!rollup.emotes) return []
    const byKey = new Map(catalog?.map(item => [item.key, item]) ?? [])
    const byLookup = new Map(
      (catalog ?? [])
        .map((item) => [catalogLookupKey(item), item] as const)
        .filter((entry): entry is readonly [string, CatalogTopEmote] => entry[0] !== ''),
    )
    const byName = new Map(catalog?.map(item => [item.name.toLowerCase(), item]) ?? [])
    return Object.entries(rollup.emotes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => {
        const parsed = parseEmoteKey(key)
        const lookupKey = `${(parsed.provider !== 'unknown' ? parsed.provider : 'unknown').toLowerCase()}:${parsed.name.toLowerCase()}`
        const match = byKey.get(key) ?? byLookup.get(lookupKey) ?? byName.get(parsed.name.toLowerCase())
        return {
          key,
          name: match?.name ?? parsed.name,
          provider: match?.provider ?? (parsed.provider !== 'unknown' ? parsed.provider : undefined),
          count,
          image_url: match
            ? getEmoteImageUrl(match)
            : (parsed.id && parsed.id !== parsed.name
                ? getEmoteImageUrl({ provider: parsed.provider, id: parsed.id })
                : undefined),
        }
      })
  }

  function detectPickReason(rollup: MomentScoringRollup, baselines: StreamBaselines, catalog?: CatalogTopEmote[]): MomentReason {
    const chatMult = (rollup.chatCount ?? 0) / baselines.chat
    const emoteMult = minuteEmoteTotal(rollup) / baselines.emotes
    const viewerMult = viewerValue(rollup) / baselines.viewers
    if (chatMult >= 2 && chatMult >= emoteMult) return 'chat_spike'
    if (emoteMult >= 2) {
      const top = topEmotes(rollup, 1, catalog)[0]
      if (!top) {
        if (chatMult >= 1.5) return 'chat_spike'
        if (viewerMult >= 1.5) return 'viewer_spike'
        return 'manual'
      }
      if (top.provider === 'seventv') return 'seventv_spike'
      if (top.provider === 'twitch') return 'twitch_emote_spike'
      if (top.provider === 'ffz') return 'ffz_spike'
      return 'emote_spike'
    }
    if (viewerMult >= 1.5) return 'viewer_spike'
    return 'manual'
  }

  function percentile(values: number[], p: number): number {
    if (!values.length) return 1
    const sorted = [...values].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
    return sorted[idx] || 1
  }

  function computeMomentScore(rollup: MomentScoringRollup, baselines: StreamBaselines, rollups?: MomentScoringRollup[]) {
    const chatNorm = Math.min(1, (rollup.chatCount ?? 0) / Math.max(baselines.chat * 2, 1))
    const emoteNorm = Math.min(1, minuteEmoteTotal(rollup) / Math.max(baselines.emotes * 2, 1))
    const viewerNorm = Math.min(1, viewerValue(rollup) / Math.max(baselines.viewers * 1.5, 1))
    const top = topEmotes(rollup, 3)
    const emoteTotal = Math.max(1, minuteEmoteTotal(rollup))
    const keywordNorm = top.length > 0 ? Math.min(1, top[0].count / (emoteTotal * 0.4)) : 0
    let noveltyNorm = 0.5
    if (rollups?.length) {
      const idx = rollups.findIndex(point => point.minuteTs === rollup.minuteTs)
      if (idx > 0) {
        const prior = rollups.slice(Math.max(0, idx - 5), idx).filter(point => !point.missing)
        if (prior.length > 0) {
          const priorChat = prior.reduce((sum, point) => sum + (point.chatCount ?? 0), 0) / prior.length
          const delta = (rollup.chatCount ?? 0) - priorChat
          noveltyNorm = Math.min(1, Math.max(0, delta / Math.max(baselines.chat, 1)))
        }
      }
    }
    const weighted =
      chatNorm * 0.35 +
      emoteNorm * 0.25 +
      viewerNorm * 0.15 +
      keywordNorm * 0.15 +
      noveltyNorm * 0.10
    return weighted * 10
  }

  function computeMomentScore100(rollup: MomentScoringRollup, baselines: StreamBaselines, rollups?: MomentScoringRollup[]) {
    return clampMomentScore(computeMomentScore(rollup, baselines, rollups) * 10)
  }

  function computeP95ReactionScore100(rollup: MomentScoringRollup, rollups: MomentScoringRollup[]) {
    const chatP95 = percentile(rollups.map(r => Math.max(0, r.chatCount ?? 0)), 0.95)
    const emoteP95 = percentile(rollups.map(r => minuteEmoteTotal(r)), 0.95)
    const chatNorm = Math.min(1, (rollup.chatCount ?? 0) / Math.max(chatP95, 1))
    const emoteNorm = Math.min(1, minuteEmoteTotal(rollup) / Math.max(emoteP95, 1))
    return Math.round(clampMomentScore((chatNorm * 0.6 + emoteNorm * 0.4) * 100))
  }

  function fallbackMomentScore100(rollup: MomentScoringRollup, baselines: StreamBaselines, rollups: MomentScoringRollup[]) {
    return Math.round(Math.min(
      computeMomentScore100(rollup, baselines, rollups),
      computeP95ReactionScore100(rollup, rollups),
    ))
  }

  function offsetSecondsFromMinuteTs(minuteTs: string, streamStartedAt?: string): number {
    const minuteMs = Date.parse(minuteTs)
    const startMs = streamStartedAt ? Date.parse(streamStartedAt) : Number.NaN
    if (!Number.isFinite(minuteMs) || !Number.isFinite(startMs)) return 0
    return Math.max(0, Math.round((minuteMs - startMs) / 1000))
  }

  const hasReactionData = (rollup: MomentScoringRollup) =>
    (rollup.chatCount ?? 0) > 0 || (rollup.totalEmoteCount ?? 0) > 0

  const hasMinuteData = (rollup: MomentScoringRollup) => !rollup.missing && (
    (rollup.viewerSamples ?? 0) > 0
    || (rollup.viewerLatest ?? 0) > 0
    || (rollup.viewerAvg ?? 0) > 0
    || (rollup.viewerMax ?? 0) > 0
    || (rollup.chatCount ?? 0) > 0
    || (rollup.totalEmoteCount ?? 0) > 0
  )

  function rollupFallbackMomentCandidates(
    rollups: MomentScoringRollup[],
    catalog?: CatalogTopEmote[],
    streamStartedAt?: string,
    maxCandidates = 10,
  ): PortalMomentCandidate[] {
    const dataRollups = rollups.filter(hasMinuteData)
    if (!dataRollups.length) return []
    const baselines = computeStreamBaselines(dataRollups)
    const hasReactionCoverage = dataRollups.some(hasReactionData)
    const rows = dataRollups.map(rollup => {
      const reason = detectPickReason(rollup, baselines, catalog)
      const scoreModel = buildMomentScoreModel({
        fallbackScore100: fallbackMomentScore100(rollup, baselines, dataRollups),
        fallbackReason: reason,
        fallbackTopEmotes: topEmotes(rollup, 3, catalog).map(emote => ({
          id: emote.key,
          name: emote.name,
          imageUrl: emote.image_url ?? '',
          count: emote.count,
          provider: emote.provider ?? 'unknown',
        })),
      })
      const topEmote = topEmotes(rollup, 1, catalog)[0]
      const score = Math.round(scoreModel.score)
      return {
        minuteTs: rollup.minuteTs ?? '',
        minuteBucket: normalizeMinuteBucket(rollup.minuteTs),
        offsetSeconds: offsetSecondsFromMinuteTs(rollup.minuteTs ?? '', streamStartedAt),
        score,
        scoreLabel: scoreModel.label,
        reason: scoreModel.reason,
        reasonLabel: honestMomentReasonLabel(scoreModel.reason, topEmote, rollup),
        topEmote,
        estimated: true,
        reactionRank: hasReactionData(rollup) ? 0 : hasReactionCoverage ? 1 : 0,
      }
    })
    const maxScore = Math.max(...rows.map(row => row.score))
    if (maxScore <= 0) return []
    const cutoff = Math.max(1, Math.round(maxScore * 0.25))
    return rows
      .filter(row => row.score >= cutoff)
      .sort((a, b) => {
        if (a.reactionRank !== b.reactionRank) return a.reactionRank - b.reactionRank
        if (b.score !== a.score) return b.score - a.score
        return a.offsetSeconds - b.offsetSeconds
      })
      .slice(0, maxCandidates)
      .map(({ reactionRank: _reactionRank, ...candidate }) => candidate)
  }

  return {
    topEmotes,
    detectPickReason,
    computeMomentScore100,
    computeP95ReactionScore100,
    fallbackMomentScore100,
    rollupFallbackMomentCandidates,
  }
})()

const LIVE_HEAT_REASONS = new Set([
  'chat_spike', 'emote_spike', 'seventv_spike', 'twitch_emote_spike', 'ffz_spike', 'viewer_spike', 'manual',
])

/** What the old live heat ranking showed for each point: score, reason and rank order. */
function oracleLiveHeat(input: LiveHeatInput) {
  const parse = (ts?: string) => (ts ? Date.parse(ts) : Number.NaN)
  const isData = (r: LiveHeatRollup) =>
    !r.missing && ((r.viewerSamples ?? 0) > 0 || (r.chatCount ?? 0) > 0 || (r.totalEmoteCount ?? 0) > 0)
  const dataRollups = input.rollups.filter(isData).slice().sort((a, b) => parse(a.minuteTs) - parse(b.minuteTs))
  const isLive = input.state === 'live' || input.state === 'syncing'
  let completed = dataRollups
  let collecting: LiveHeatRollup | null = null
  if (isLive && dataRollups.length > 0) {
    collecting = dataRollups[dataRollups.length - 1]
    completed = dataRollups.slice(0, -1)
  }
  const baselines = computeStreamBaselines(completed.length ? completed : dataRollups)
  const heatmap = input.heatmapPoints?.length ? new Map(input.heatmapPoints.map(p => [p.minuteTs, p])) : null
  const catalog = (input.topEmotes ?? [])
    .filter((emote): emote is LiveHeatCatalogEmote & { key: string } => Boolean(emote.key))
    .map(emote => ({ ...emote }))
  const firstMs = parse(dataRollups[0]?.minuteTs)
  const startMs = parse(input.streamStartedAt)
  const project = (r: LiveHeatRollup) => {
    const fallbackReason = oracle.detectPickReason(r, baselines, catalog)
    const model = buildMomentScoreModel({
      heatmapPoint: r.minuteTs ? heatmap?.get(r.minuteTs) : undefined,
      fallbackScore100: oracle.fallbackMomentScore100(r, baselines, completed),
      fallbackReason,
    })
    const minuteMs = parse(r.minuteTs)
    const anchorMs = Number.isFinite(startMs) ? startMs : firstMs
    return {
      minuteTs: r.minuteTs ?? '',
      offsetSeconds: Number.isFinite(minuteMs) && Number.isFinite(anchorMs)
        ? Math.max(0, Math.round((minuteMs - anchorMs) / 1000))
        : 0,
      score: Math.round(model.score),
      estimated: model.estimated,
      reason: LIVE_HEAT_REASONS.has(model.reason) ? model.reason : fallbackReason,
      reasonLabel: model.reasonLabel,
      chatCount: Math.max(0, Math.round(r.chatCount ?? 0)),
    }
  }
  const all = completed.length >= 5 ? completed.map(project) : []
  const maxScore = all.length ? Math.max(...all.map(point => point.score)) : 0
  const cutoff = Math.max(1, Math.round(maxScore * 0.25))
  return {
    points: maxScore > 0
      ? all
          .filter(point => point.score >= cutoff)
          .sort((a, b) => b.score - a.score || a.offsetSeconds - b.offsetSeconds)
          .slice(0, 10)
      : [],
    collectingPoint: collecting ? project(collecting) : null,
  }
}

function heatProjection(point: { minuteTs: string; offsetSeconds: number; score: number; estimated: boolean; reason: string; reasonLabel: string; chatCount: number } | null) {
  if (!point) return null
  const { minuteTs, offsetSeconds, score, estimated, reason, reasonLabel, chatCount } = point
  return { minuteTs, offsetSeconds, score, estimated, reason, reasonLabel, chatCount }
}

const STARTED_AT = '2026-06-11T12:00:00.000Z'
const START_MS = Date.parse(STARTED_AT)
const EMOTE_KEYS = [
  'seventv:01HQ:PogU',
  'seventv:01HR:pogu',
  'twitch:25:Kappa',
  'ffz:128054:LULW',
  'bttv:5e9c:KEKW',
  'KEKW',
  'unknown:OMEGALUL:OMEGALUL',
  'bttv:5f1b:catJAM',
]

const CATALOG: CatalogTopEmote[] = [
  { key: 'seventv:01HQ:PogU', name: 'PogU', provider: 'seventv', id: '01HQ', count: 900 },
  { key: 'twitch:25:Kappa', name: 'Kappa', provider: 'twitch', id: '25', imageUrl: 'https://cdn.example.test/kappa.png', count: 700 },
  { key: 'other-key', name: 'KEKW', provider: 'bttv', id: '5e9c', count: 400 },
  { key: 'by-lookup', name: 'LULW', provider: 'ffz', id: '128054', count: 300 },
  { key: 'blank-name', name: '  ', provider: 'ffz', count: 1 },
]

const LIVE_CATALOG: LiveHeatCatalogEmote[] = [
  ...CATALOG.map(emote => ({ ...emote, providerEmoteId: emote.id })),
  { name: 'catJAM', provider: 'bttv', id: '5f1b', count: 50 },
]

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A long stream with what real rollups carry: equal minutes (ties), skipped minutes
 * (time gaps), missing and empty minutes, zero-chat minutes, a repeated minuteTs and
 * a few minutes with no minuteTs at all.
 */
function generateStream(minutes: number, seed: number): MomentScoringRollup[] {
  const random = mulberry32(seed)
  const int = (max: number) => Math.floor(random() * max)
  const rollups: MomentScoringRollup[] = []
  let minute = 0
  for (let i = 0; i < minutes; i++) {
    minute += random() < 0.04 ? 2 + int(6) : 1
    const roll = random()
    const minuteTs = roll < 0.005
      ? undefined
      : roll < 0.03 && i > 0
        ? rollups[int(i)].minuteTs
        : new Date(START_MS + minute * 60_000).toISOString()
    const kind = random()
    if (kind < 0.03) {
      rollups.push({ minuteTs, missing: true, chatCount: int(50) })
      continue
    }
    if (kind < 0.05) {
      rollups.push({ minuteTs, chatCount: 0, viewerSamples: 0 })
      continue
    }
    const plateau = kind < 0.2
    const chatCount = plateau ? 40 : random() < 0.08 ? 0 : int(random() < 0.05 ? 600 : 120)
    const emotes: Record<string, number> = {}
    if (random() < 0.85) {
      for (const key of EMOTE_KEYS) {
        if (random() < 0.5) emotes[key] = plateau ? 12 : int(random() < 0.05 ? 300 : 40)
      }
    }
    const emoteSum = Object.values(emotes).reduce((sum, count) => sum + count, 0)
    const viewers = random() < 0.2 ? 0 : 1000 + int(random() < 0.05 ? 20_000 : 5000)
    rollups.push({
      minuteTs,
      viewerSamples: random() < 0.1 ? 0 : 1 + int(3),
      viewerLatest: plateau ? 3000 : viewers,
      viewerAvg: random() < 0.5 ? viewers : undefined,
      viewerMax: random() < 0.3 ? viewers + int(500) : undefined,
      chatCount,
      totalEmoteCount: random() < 0.3 ? 0 : emoteSum,
      emotes: random() < 0.1 ? undefined : emotes,
    })
  }
  return rollups
}

const STREAMS = [
  { name: '900-minute stream', rollups: generateStream(900, 9001) },
  { name: '1080-minute stream', rollups: generateStream(1080, 1080) },
]

describe('moment scoring with a per-list context', () => {
  it('builds streams that have ties, gaps, zero-chat minutes and repeated minuteTs', () => {
    for (const { rollups } of STREAMS) {
      const stamps = rollups.map(r => r.minuteTs).filter((ts): ts is string => Boolean(ts))
      assert.ok(new Set(stamps).size < stamps.length, 'a minuteTs repeats')
      assert.ok(rollups.some(r => r.minuteTs === undefined), 'a minute has no minuteTs')
      assert.ok(rollups.some(r => r.missing), 'a minute is missing')
      assert.ok(rollups.some(r => !r.missing && r.chatCount === 0 && (r.viewerLatest ?? 0) > 0), 'a zero-chat minute')
      const ms = stamps.map(ts => Date.parse(ts))
      assert.ok(ms.some((value, i) => i > 0 && value - ms[i - 1] > 60_000), 'a time gap')
      const counts = new Map<number, number>()
      for (const r of rollups) counts.set(r.chatCount ?? 0, (counts.get(r.chatCount ?? 0) ?? 0) + 1)
      assert.ok((counts.get(40) ?? 0) > 50, 'many tied minutes')
    }
  })

  for (const { name, rollups } of STREAMS) {
    it(`scores every minute of a ${name} exactly as before, with and without the context`, () => {
      const lists = [rollups, rollups.filter(r => !r.missing && (r.chatCount ?? 0) > 0)]
      for (const list of lists) {
        const baselines = computeStreamBaselines(list)
        const context = buildMomentScoringContext(list)
        const foreign: MomentScoringRollup[] = [
          { ...list[7], chatCount: 999 },
          { minuteTs: '2030-01-01T00:00:00.000Z', chatCount: 5, totalEmoteCount: 2 },
          { chatCount: 3 },
        ]
        for (const rollup of [...list, ...foreign]) {
          const expected = oracle.fallbackMomentScore100(rollup, baselines, list)
          assert.equal(fallbackMomentScore100(rollup, baselines, list, context), expected)
          assert.equal(fallbackMomentScore100(rollup, baselines, list), expected)
          const expectedMulti = oracle.computeMomentScore100(rollup, baselines, list)
          assert.equal(computeMomentScore100(rollup, baselines, list, context), expectedMulti)
          assert.equal(computeMomentScore100(rollup, baselines, list), expectedMulti)
          const expectedP95 = oracle.computeP95ReactionScore100(rollup, list)
          assert.equal(computeP95ReactionScore100(rollup, list, context), expectedP95)
          assert.equal(computeP95ReactionScore100(rollup, list), expectedP95)
        }
      }
    })

    it(`ranks the same fallback candidates for a ${name}`, () => {
      for (const catalog of [undefined, CATALOG]) {
        for (const startedAt of [STARTED_AT, undefined]) {
          const expected = oracle.rollupFallbackMomentCandidates(rollups, catalog, startedAt, 1e9)
          assert.ok(expected.length > 10)
          assert.deepEqual(rollupFallbackMomentCandidates(rollups, catalog, startedAt, 1e9), expected)
          assert.deepEqual(rollupFallbackMomentCandidates(rollups, catalog, startedAt), expected.slice(0, 10))
        }
      }
    })

    it(`finds the same top emotes for every minute of a ${name}`, () => {
      for (const catalog of [undefined, CATALOG]) {
        const topEmotesOf = catalogTopEmotes(catalog)
        for (const rollup of rollups) {
          for (const limit of [1, 3, 5]) {
            const expected = oracle.topEmotes(rollup, limit, catalog)
            assert.deepEqual(topEmotesOf(rollup, limit), expected)
            assert.deepEqual(topEmotesFromRollup(rollup, limit, catalog), expected)
          }
          assert.deepEqual(topEmotesOf(rollup), oracle.topEmotes(rollup, undefined, catalog))
        }
      }
    })

    it(`derives the same live heat points for a ${name}`, () => {
      const liveRollups = rollups as LiveHeatRollup[]
      const stamped = rollups.filter((r): r is MomentScoringRollup & { minuteTs: string } => Boolean(r.minuteTs))
      const heatmapPoints = [stamped[40], stamped[300], stamped[301]].map((r, i) => ({
        minuteTs: r.minuteTs,
        offsetSeconds: 0,
        score: 70 + i,
        reason: i === 0 ? 'reaction_burst' : 'chat_spike',
        confidence: 0.8,
        topEmotes: [],
      }) as unknown as ReplayHeatmapPoint)
      for (const state of ['historical', 'live'] as const) {
        for (const extra of [{}, { heatmapPoints }, { streamStartedAt: STARTED_AT }]) {
          const input: LiveHeatInput = { state, rollups: liveRollups, topEmotes: LIVE_CATALOG, ...extra }
          const actual = deriveLiveHeat(input)
          const expected = oracleLiveHeat(input)
          assert.deepEqual(actual.points.map(heatProjection), expected.points)
          assert.deepEqual(heatProjection(actual.collectingPoint), expected.collectingPoint)
        }
      }
    })
  }

  it('matches the old scoring on an empty and a one-minute list', () => {
    const one: MomentScoringRollup[] = [{ minuteTs: STARTED_AT, chatCount: 12, totalEmoteCount: 4 }]
    for (const list of [[], one]) {
      const baselines = computeStreamBaselines(list)
      const context = buildMomentScoringContext(list)
      for (const rollup of [...one, { chatCount: 0 }]) {
        assert.equal(
          fallbackMomentScore100(rollup, baselines, list, context),
          oracle.fallbackMomentScore100(rollup, baselines, list),
        )
      }
    }
    assert.deepEqual(rollupFallbackMomentCandidates([], CATALOG, STARTED_AT), [])
    assert.deepEqual(rollupFallbackMomentCandidates(one, CATALOG, STARTED_AT), oracle.rollupFallbackMomentCandidates(one, CATALOG, STARTED_AT))
  })

  it('keeps the first index of a repeated minuteTs, as findIndex does', () => {
    const list: MomentScoringRollup[] = [
      { minuteTs: 'a', chatCount: 1 },
      { minuteTs: 'b', chatCount: 2 },
      { minuteTs: 'a', chatCount: 3 },
      { chatCount: 4 },
      { chatCount: 5 },
    ]
    const context = buildMomentScoringContext(list)
    assert.equal(context.minuteIndex.get('a'), 0)
    assert.equal(context.minuteIndex.get('b'), 1)
    assert.equal(context.minuteIndex.get(undefined), 3)
    assert.equal(context.minuteIndex.get('c'), undefined)
  })

  it('ranks a 1080-minute stream in well under 200 ms', () => {
    const rollups = STREAMS[1].rollups
    const best = (fn: () => unknown) => {
      let fastest = Number.POSITIVE_INFINITY
      for (let run = 0; run < 3; run++) {
        const started = performance.now()
        fn()
        fastest = Math.min(fastest, performance.now() - started)
      }
      return fastest
    }
    const fallbackMs = best(() => rollupFallbackMomentCandidates(rollups, CATALOG, STARTED_AT))
    const liveHeatMs = best(() => deriveLiveHeat({ state: 'live', rollups: rollups as LiveHeatRollup[], topEmotes: LIVE_CATALOG }))
    assert.ok(fallbackMs < 200, `rollupFallbackMomentCandidates took ${fallbackMs.toFixed(1)} ms`)
    assert.ok(liveHeatMs < 200, `deriveLiveHeat took ${liveHeatMs.toFixed(1)} ms`)
  })
})
