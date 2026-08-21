import type {
  AnalyticsMinuteRollup,
  AnalyticsStreamDetail,
  PulseStreamRecap,
} from '../apiTypes'
import { getVerifiedTransition } from './motionEligibility'
import { finiteCoveragePct, parseTimestamp, watermarkState } from './signalFreshness'
import {
  normalizedDetector,
  type CoverageSignal,
  type EventSessionSignal,
  type SessionMetric,
  type SessionSignal,
  type SignalObservation,
  type SignalValue,
} from './signalTypes'

const MINUTE_CONTIGUOUS_TOLERANCE_MS = 90_000
const PEAK_SEEK_MAX_DISTANCE_MS = 60_000
const TAPE_ITEM_LIMIT = 36
const MATERIAL_DELTA_MIN_ABS = { chat: 5, emotes: 5, viewers: 25 } as const
const DELTA_METRICS = ['chat', 'emotes', 'viewers'] as const

type DeltaMetric = (typeof DELTA_METRICS)[number]

export type BuildSessionSignalsInput = {
  detail: AnalyticsStreamDetail
  recap?: PulseStreamRecap | null
  rollups: AnalyticsMinuteRollup[]
  startedAt?: string
  streamId: string
  activeMinutesUnavailable?: boolean
}

function isObservation(value: unknown): value is SignalObservation {
  if (!value || typeof value !== 'object') return false
  const observation = value as Record<string, unknown>
  if (
    observation.state !== 'measured'
    && observation.state !== 'missing'
    && observation.state !== 'partial'
    && observation.state !== 'unknown'
  ) {
    return false
  }
  if (observation.observedAt !== null && typeof observation.observedAt !== 'string') return false
  if ('value' in observation) return false
  return true
}

function metricValue(metric: DeltaMetric, rollup: AnalyticsMinuteRollup): number | null {
  const value = metric === 'chat'
    ? rollup.chatCount
    : metric === 'emotes'
      ? rollup.totalEmoteCount
      : rollup.viewerAvg
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function valueFor(
  metric: DeltaMetric,
  rollup: AnalyticsMinuteRollup,
  detail: AnalyticsStreamDetail,
): SignalValue {
  const unknown: SignalValue = { metric, value: null, state: 'unknown', observedAt: null }
  if (rollup.missing === true) return { ...unknown, state: 'missing' }

  const candidate = rollup.signalObservations?.[metric]
  if (!isObservation(candidate)) return unknown
  if (candidate.state === 'missing' || candidate.state === 'unknown') {
    return { ...unknown, state: candidate.state, observedAt: candidate.observedAt }
  }

  const value = metricValue(metric, rollup)
  if (value === null) return unknown
  const coveragePct = finiteCoveragePct(candidate.coveragePct)
  const common = {
    metric,
    value,
    observedAt: candidate.observedAt,
    ...(coveragePct === undefined ? {} : { coveragePct }),
    ...(typeof candidate.source === 'string' && candidate.source.length > 0 ? { source: candidate.source } : {}),
  } satisfies Omit<SignalValue, 'state'>

  if (candidate.state === 'partial') return { ...common, state: 'partial' }

  const watermark = detail.signalWatermarks?.[metric]
  const finalWatermarkState = watermarkState(watermark, candidate.observedAt)
  if (finalWatermarkState === 'unknown') return unknown
  if (finalWatermarkState === 'stale') return { ...common, state: 'stale' }
  if (finalWatermarkState === 'partial') return { ...common, state: 'partial' }
  return { ...common, state: value === 0 ? 'measured_zero' : 'measured' }
}

function comparable(
  previous: SignalValue,
  current: SignalValue,
): { delta: number } | null {
  const transition = getVerifiedTransition(previous, current)
  if (!transition) return null
  if (!previous.source || previous.source !== current.source) return null
  if (previous.coveragePct !== current.coveragePct) return null
  return { delta: transition.delta }
}

function buildCoverage(input: BuildSessionSignalsInput): CoverageSignal | null {
  const watermark = input.detail.signalWatermarks?.chat
  if (
    watermark
    && (watermark.state === 'partial' || watermark.state === 'stale' || watermark.state === 'unknown')
  ) {
    const coveragePct = finiteCoveragePct(watermark.coveragePct)
    return {
      id: 'coverage:chat',
      kind: 'coverage',
      state: watermark.state,
      observedThrough: watermark.observedThrough,
      ...(coveragePct === undefined ? {} : { coveragePct }),
      label: 'Chat coverage',
      detail: watermark.state === 'partial'
        ? 'Partial coverage'
        : watermark.state === 'stale'
          ? 'Stale coverage'
          : 'Coverage unknown',
      seekable: false,
    }
  }

  const coveragePct = finiteCoveragePct(input.detail.chatCoveragePct)
  if (
    input.detail.stream?.streamId === input.streamId
    && coveragePct !== undefined
    && (input.detail.chatCoverage?.partial === true || coveragePct < 95)
  ) {
    return {
      id: 'coverage:chat',
      kind: 'coverage',
      state: 'partial',
      observedThrough: null,
      coveragePct,
      label: 'Chat coverage',
      detail: 'Partial coverage (legacy)',
      seekable: false,
    }
  }
  return null
}

function buildPeaks(
  input: BuildSessionSignalsInput,
  rollups: AnalyticsMinuteRollup[],
): EventSessionSignal[] {
  if (!input.recap || input.recap.streamId !== input.streamId) return []
  const startedAtMs = parseTimestamp(input.startedAt ?? input.detail.stream?.startedAt)
  if (startedAtMs === null) return []

  return (input.recap.topMoments ?? []).flatMap((moment) => {
    const observation = moment.peakObservation
    if (
      !observation
      || observation.confirmed !== true
      || observation.state !== 'measured'
      || typeof observation.detector !== 'string'
      || observation.detector.trim().length === 0
      || typeof observation.value !== 'number'
      || !Number.isFinite(observation.value)
      || !Number.isFinite(moment.offsetSeconds)
    ) {
      return []
    }

    const target = startedAtMs + moment.offsetSeconds * 1_000
    const resolved = rollups
      .filter((rollup) => rollup.missing !== true)
      .map((rollup) => ({ rollup, timestamp: parseTimestamp(rollup.minuteTs) }))
      .filter((entry): entry is { rollup: AnalyticsMinuteRollup; timestamp: number } => entry.timestamp !== null)
      .sort((a, b) => Math.abs(a.timestamp - target) - Math.abs(b.timestamp - target))[0]
    if (!resolved || Math.abs(resolved.timestamp - target) > PEAK_SEEK_MAX_DISTANCE_MS) return []

    return [{
      id: `peak:${input.streamId}:${moment.offsetSeconds}:${normalizedDetector(observation.detector)}`,
      kind: 'peak' as const,
      metric: 'peaks' as const,
      minuteTs: resolved.rollup.minuteTs,
      current: {
        metric: 'peaks',
        value: observation.value,
        state: 'measured' as const,
        observedAt: observation.observedAt,
        ...(finiteCoveragePct(observation.coveragePct) === undefined
          ? {}
          : { coveragePct: finiteCoveragePct(observation.coveragePct) }),
        ...(observation.source ? { source: observation.source } : {}),
      },
      label: 'Confirmed peak',
      seekable: true as const,
    }]
  })
}

export function buildSessionSignals(input: BuildSessionSignalsInput): SessionSignal[] {
  const timeline = (input.detail.momentRollups?.length ? input.detail.momentRollups : input.rollups)
    .slice()
    .sort((left, right) => (parseTimestamp(left.minuteTs) ?? 0) - (parseTimestamp(right.minuteTs) ?? 0))
  const coverage = buildCoverage(input)
  const events: EventSessionSignal[] = buildPeaks(input, timeline)

  if (!input.activeMinutesUnavailable) {
    for (const metric of DELTA_METRICS) {
      for (let index = 1; index < timeline.length; index += 1) {
        const prior = timeline[index - 1]
        const current = timeline[index]
        const priorTimestamp = parseTimestamp(prior.minuteTs)
        const currentTimestamp = parseTimestamp(current.minuteTs)
        if (
          priorTimestamp === null
          || currentTimestamp === null
          || currentTimestamp - priorTimestamp > MINUTE_CONTIGUOUS_TOLERANCE_MS
        ) {
          continue
        }

        const previousValue = valueFor(metric, prior, input.detail)
        const currentValue = valueFor(metric, current, input.detail)
        const transition = comparable(previousValue, currentValue)
        if (!transition || Math.abs(transition.delta) < MATERIAL_DELTA_MIN_ABS[metric]) continue

        events.push({
          id: `delta:${metric}:${current.minuteTs}`,
          kind: 'delta',
          metric,
          minuteTs: current.minuteTs,
          current: currentValue,
          previous: previousValue,
          label: `${metric[0].toUpperCase()}${metric.slice(1)} change`,
          seekable: true,
        })
      }
    }
  }

  const deduped = [...new Map(events.map((event) => [event.id, event])).values()]
  const selected = deduped
    .sort((left, right) => {
      const priority = (signal: EventSessionSignal) => signal.kind === 'peak' ? 0 : 1
      return priority(left) - priority(right)
        || (parseTimestamp(right.minuteTs) ?? 0) - (parseTimestamp(left.minuteTs) ?? 0)
        || left.id.localeCompare(right.id)
    })
    .slice(0, TAPE_ITEM_LIMIT)
    .sort((left, right) =>
      (parseTimestamp(left.minuteTs) ?? 0) - (parseTimestamp(right.minuteTs) ?? 0)
      || left.id.localeCompare(right.id))

  return coverage ? [coverage, ...selected] : selected
}
