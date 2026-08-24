export type SessionMetric = 'chat' | 'emotes' | 'viewers' | 'peaks'

export type SignalState =
  | 'measured'
  | 'measured_zero'
  | 'missing'
  | 'partial'
  | 'stale'
  | 'unknown'

export type SignalObservationState = 'measured' | 'missing' | 'partial' | 'unknown'

export interface SignalObservation {
  state: SignalObservationState
  observedAt: string | null
  coveragePct?: number
  source?: string
}

export interface SignalWatermark {
  state: 'current' | 'partial' | 'stale' | 'unknown'
  observedThrough: string | null
  coveragePct?: number
  source?: string
}

export interface SignalValue {
  metric: SessionMetric
  value: number | null
  state: SignalState
  observedAt: string | null
  coveragePct?: number
  source?: string
}

export type DeltaSessionSignal = {
  id: string
  kind: 'delta'
  metric: Exclude<SessionMetric, 'peaks'>
  minuteTs: string
  current: SignalValue
  previous: SignalValue
  label: string
  detail?: string
  seekable: boolean
}

export type PeakSessionSignal = {
  id: string
  kind: 'peak'
  metric: 'peaks'
  minuteTs: string
  current: SignalValue
  label: string
  detail?: string
  seekable: true
}

export type EventSessionSignal = DeltaSessionSignal | PeakSessionSignal

export type CoverageSignal = {
  id: 'coverage:chat'
  kind: 'coverage'
  state: 'partial' | 'stale' | 'unknown'
  observedThrough: string | null
  coveragePct?: number
  label: string
  detail?: string
  seekable: false
}

export type SessionSignal = EventSessionSignal | CoverageSignal

export function normalizedDetector(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
  return normalized.length > 0 ? normalized : 'undet'
}
