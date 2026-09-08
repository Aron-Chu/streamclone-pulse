import { useSyncExternalStore } from 'react'
import { fromHubMoment, type DiscoveryMoment } from './discoveryMoments'
import type { LiveWireMetricComparison, LiveWireMomentComparison } from './liveWire'

export const SAVED_MOMENTS_KEY = 'streampulse.saved-moments.v2'
export const LEGACY_SAVED_MOMENTS_KEY = 'streampulse.saved-moments.v1'
export const SAVED_MOMENTS_LIMIT = 200
export interface SavedMoment extends DiscoveryMoment { savedAt: number }
interface Snapshot { items: SavedMoment[]; warning: string }
let snapshot: Snapshot = { items: [], warning: '' }
let initialized = false
let sessionOnly = false
const listeners = new Set<() => void>()
const publish = () => listeners.forEach(listener => listener())
const cleanText = (value: unknown, limit: number): string | undefined => typeof value === 'string' && value.length <= limit && !/[\u0000-\u001f]/.test(value) ? value : undefined
const finite = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined => {
  const parsed = finite(value, min, max)
  return parsed != null && Number.isSafeInteger(parsed) ? parsed : undefined
}
function cleanComparisonMetric(value: unknown): LiveWireMetricComparison | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const states = ['ready', 'new_activity', 'warming', 'partial', 'unavailable'] as const
  if (!states.includes(row.state as typeof states[number])) return undefined
  const currentMeasuredMinutes = integer(row.currentMeasuredMinutes, 0, 100_000)
  const currentExpectedMinutes = integer(row.currentExpectedMinutes, 0, 100_000)
  const baselineMeasuredMinutes = integer(row.baselineMeasuredMinutes, 0, 100_000)
  const baselineExpectedMinutes = integer(row.baselineExpectedMinutes, 0, 100_000)
  const baselineCoveragePct = finite(row.baselineCoveragePct, 0, 100)
  if ([currentMeasuredMinutes, currentExpectedMinutes, baselineMeasuredMinutes, baselineExpectedMinutes, baselineCoveragePct].some(item => item == null)) return undefined
  const optional = (field: string, min: number, max: number) => row[field] == null ? undefined : finite(row[field], min, max)
  const currentPerMin = optional('currentPerMin', 0, 1_000_000_000)
  const baselinePerMin = optional('baselinePerMin', 0, 1_000_000_000)
  const absoluteDeltaPerMin = optional('absoluteDeltaPerMin', -1_000_000_000, 1_000_000_000)
  const changePct = optional('changePct', -1_000_000, 1_000_000)
  const multiplier = optional('multiplier', 0, 1_000_000)
  if ((row.currentPerMin != null && currentPerMin == null) || (row.baselinePerMin != null && baselinePerMin == null)
    || (row.absoluteDeltaPerMin != null && absoluteDeltaPerMin == null) || (row.changePct != null && changePct == null)
    || (row.multiplier != null && multiplier == null)) return undefined
  const reason = row.reason == null ? undefined : cleanText(row.reason, 300)
  if (row.reason != null && reason == null) return undefined
  return { state: row.state as LiveWireMetricComparison['state'], reason, currentPerMin, baselinePerMin, absoluteDeltaPerMin,
    changePct, multiplier, currentMeasuredMinutes: currentMeasuredMinutes!, currentExpectedMinutes: currentExpectedMinutes!,
    baselineMeasuredMinutes: baselineMeasuredMinutes!, baselineExpectedMinutes: baselineExpectedMinutes!, baselineCoveragePct: baselineCoveragePct! }
}
function cleanComparison(value: unknown): LiveWireMomentComparison | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const window = row.baselineWindow && typeof row.baselineWindow === 'object' && !Array.isArray(row.baselineWindow) ? row.baselineWindow as Record<string, unknown> : null
  const evidence = row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence) ? row.evidence as Record<string, unknown> : null
  const eventAt = finite(row.eventAt, 1, 4_102_444_800_000)
  const start = window && finite(window.start, 1, 4_102_444_800_000)
  const end = window && finite(window.end, 1, 4_102_444_800_000)
  const expectedMinutes = window && integer(window.expectedMinutes, 0, 100_000)
  const measuredMinutes = window && integer(window.measuredMinutes, 0, 100_000)
  const coveragePct = window && finite(window.coveragePct, 0, 100)
  const chat = cleanComparisonMetric(row.chat)
  const emotes = cleanComparisonMetric(row.emotes)
  if (row.baselineKind !== 'current_stream_measured_average_before_event' || !eventAt || !start || !end
    || expectedMinutes == null || measuredMinutes == null || coveragePct == null || !chat || !emotes || !evidence
    || typeof evidence.ircBound !== 'boolean' || typeof evidence.eventRollupAvailable !== 'boolean') return undefined
  const evidenceMeasured = integer(evidence.baselineMeasuredMinutes, 0, 100_000)
  const evidenceExpected = integer(evidence.baselineExpectedMinutes, 0, 100_000)
  const evidenceCoverage = finite(evidence.baselineCoveragePct, 0, 100)
  if (evidenceMeasured == null || evidenceExpected == null || evidenceCoverage == null) return undefined
  return { baselineKind: row.baselineKind, eventAt, baselineWindow: { start, end, expectedMinutes, measuredMinutes, coveragePct }, chat, emotes,
    evidence: { ircBound: evidence.ircBound, eventRollupAvailable: evidence.eventRollupAvailable,
      baselineMeasuredMinutes: evidenceMeasured, baselineExpectedMinutes: evidenceExpected, baselineCoveragePct: evidenceCoverage } }
}
function cleanTopEmotes(value: unknown): NonNullable<DiscoveryMoment['topEmotes']> | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.slice(0, 5).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const name = cleanText(row.name, 100)
    if (!name) return []
    const provider = row.provider == null ? undefined : cleanText(row.provider, 40)
    const count = row.count == null ? undefined : finite(row.count, 0, 1_000_000_000)
    const id = row.id == null ? undefined : cleanText(row.id, 100)
    if ((row.provider != null && provider == null) || (row.count != null && count == null) || (row.id != null && id == null)) return []
    return [{ name, provider, count, ...(id ? { id } : {}) }]
  })
  return items.length ? items : undefined
}

/** Allowlist bounded public evidence: never persist media URLs, source IDs, credentials, or handoff grants. */
export function savedMomentRecord(moment: DiscoveryMoment, savedAt = Date.now()): SavedMoment {
  const chatPerMin = finite(moment.chatPerMin)
  const emotesPerMin = finite(moment.emotesPerMin)
  const comparison = cleanComparison(moment.comparison)
  const topEmotes = cleanTopEmotes(moment.topEmotes)
  const revision = integer(moment.revision, 1)
  return { key: moment.key, login: moment.login, streamId: moment.streamId, offsetSeconds: moment.offsetSeconds,
    label: moment.label.slice(0, 300), provenance: 'saved', savedAt,
    ...(moment.publicMomentId ? { publicMomentId: moment.publicMomentId } : {}), ...(moment.at == null ? {} : { at: moment.at }),
    ...(moment.displayName ? { displayName: moment.displayName.slice(0, 100) } : {}), ...(moment.category ? { category: moment.category.slice(0, 150) } : {}),
    ...(chatPerMin == null ? {} : { chatPerMin }), ...(emotesPerMin == null ? {} : { emotesPerMin }),
    ...(comparison ? { comparison } : {}), ...(moment.reactionSignal === 'chat' || moment.reactionSignal === 'emotes' ? { reactionSignal: moment.reactionSignal } : {}),
    ...(topEmotes ? { topEmotes } : {}), ...(revision == null ? {} : { revision }), ...(moment.storyId ? { storyId: moment.storyId } : {}) }
}
export function parseSavedMoments(raw: string | null): SavedMoment[] {
  if (!raw) return []
  if (raw.length > 500_000) throw new Error('Saved data is too large')
  const envelope = JSON.parse(raw)
  if (![1, 2].includes(envelope?.version) || !Array.isArray(envelope.items) || envelope.items.length > SAVED_MOMENTS_LIMIT) throw new Error('Unsupported saved data')
  const unique = new Map<string, SavedMoment>()
  for (const row of envelope.items) {
    if (!row || typeof row.label !== 'string' || row.label.length > 300 || !Number.isFinite(row.savedAt) || row.savedAt <= 0) throw new Error('Invalid saved moment')
    const moment = fromHubMoment({ publicMomentId: row.publicMomentId, login: row.login, streamId: row.streamId,
      offsetSeconds: row.offsetSeconds, at: row.at, label: row.label, displayName: row.displayName, category: row.category,
      chatPerMin: envelope.version === 2 ? finite(row.chatPerMin) : undefined,
      emotesPerMin: envelope.version === 2 ? finite(row.emotesPerMin) : undefined,
      comparison: envelope.version === 2 ? cleanComparison(row.comparison) : undefined,
      kind: envelope.version === 2 ? row.reactionSignal : undefined,
      topEmotes: envelope.version === 2 ? cleanTopEmotes(row.topEmotes) : undefined })
    if (!moment) throw new Error('Invalid saved identity')
    moment.revision = envelope.version === 2 ? integer(row.revision, 1) : undefined
    moment.storyId = typeof row.storyId === 'string' && row.storyId.length <= 220 ? row.storyId : undefined
    unique.set(moment.key, savedMomentRecord(moment, row.savedAt))
  }
  return [...unique.values()]
}
function readStored(): { items: SavedMoment[]; migrated: boolean } {
  const current = window.localStorage.getItem(SAVED_MOMENTS_KEY)
  if (current != null) return { items: parseSavedMoments(current), migrated: false }
  const legacy = window.localStorage.getItem(LEGACY_SAVED_MOMENTS_KEY)
  return { items: parseSavedMoments(legacy), migrated: legacy != null }
}
function initialize() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try {
    const stored = readStored()
    snapshot = { items: stored.items, warning: '' }
    if (stored.migrated) {
      try { window.localStorage.setItem(SAVED_MOMENTS_KEY, JSON.stringify({ version: 2, items: stored.items })) }
      catch {
        // A readable v1 shortlist remains useful even if quota or browser
        // policy prevents the v2 migration write. Keep it for this session;
        // never turn a failed migration into an apparently empty shortlist.
        sessionOnly = true
        snapshot = { items: stored.items, warning: 'Saved data was loaded, but could not be upgraded. Changes are available for this session only; existing stored data was not overwritten.' }
      }
    }
  }
  catch { sessionOnly = true; snapshot = { items: [], warning: 'Saved data could not be read. Saves are available for this session only; existing stored data was not overwritten.' } }
}
function refreshStored() {
  if (sessionOnly) return
  try {
    const items = readStored().items
    // Keep getSnapshot referentially stable when localStorage still contains
    // the same bounded records. useSyncExternalStore treats every new object
    // as a store change; replacing this snapshot during saved-detail hydration
    // could otherwise create a render/refresh loop even when nothing changed.
    if (JSON.stringify(items) !== JSON.stringify(snapshot.items) || snapshot.warning) {
      snapshot = { items, warning: '' }
    }
  }
  catch { sessionOnly = true; snapshot = { ...snapshot, warning: 'Saved data could not be read. Saves are available for this session only; existing stored data was not overwritten.' } }
}
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== SAVED_MOMENTS_KEY && event.key !== LEGACY_SAVED_MOMENTS_KEY) return
  refreshStored(); publish()
}
function persist(items: SavedMoment[]) {
  let warning = snapshot.warning
  if (!sessionOnly) {
    try { window.localStorage.setItem(SAVED_MOMENTS_KEY, JSON.stringify({ version: 2, items })) }
    catch { sessionOnly = true; warning = 'Storage unavailable. Saves are available for this session only.' }
  }
  snapshot = { items, warning }; publish()
}
export function refreshSavedMoment(moment: DiscoveryMoment): boolean {
  initialize()
  refreshStored()
  const index = snapshot.items.findIndex(item => item.key === moment.key)
  if (index < 0) return false
  const previous = snapshot.items[index]!
  const enriched = { ...previous } as DiscoveryMoment
  for (const [key, value] of Object.entries(moment)) if (value !== undefined) Object.assign(enriched, { [key]: value })
  const next = savedMomentRecord({ ...enriched, provenance: 'saved' }, previous.savedAt)
  if (JSON.stringify(previous) === JSON.stringify(next)) return false
  const items = [...snapshot.items]
  items[index] = next
  persist(items)
  return true
}
export function toggleSavedMoment(moment: DiscoveryMoment): string {
  initialize()
  refreshStored()
  const existing = snapshot.items.some(item => item.key === moment.key)
  if (existing) { persist(snapshot.items.filter(item => item.key !== moment.key)); return 'Removed from saved moments.' }
  if (snapshot.items.length >= SAVED_MOMENTS_LIMIT) return '200 saved moments reached. Remove a saved moment before adding another.'
  persist([savedMomentRecord(moment), ...snapshot.items]); return sessionOnly ? 'Saved for this session only.' : 'Saved on this device.'
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage) }
}
const serverSnapshot: Snapshot = { items: [], warning: '' }
export function useSavedMoments() {
  initialize()
  return useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot)
}
