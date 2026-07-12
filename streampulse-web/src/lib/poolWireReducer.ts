/**
 * Pool Wire lifecycle reducer — membership enter/leave for the tracked live pool.
 * Pure state machine: consume each successful hub snapshot exactly once via pollSequence.
 */

import type { HubLiveChannel, HubLivePulseMoment } from './publicHub'

export const POOL_WIRE_MAX_EVENTS = 5
export const POOL_WIRE_SEEN_OPENING_CAP = 200
export const POOL_WIRE_SEED_HORIZON_MS = 60 * 60 * 1000
/** Hold unmatched joins this long (or one successful poll) before emitting entered_live_set. */
export const POOL_WIRE_ENTRY_RECONCILE_MS = 45_000
/** Minimum wall time a channel must stay absent before publishing left_live_set. */
export const POOL_WIRE_LEAVE_GRACE_MS = 20_000
/** Two consecutive healthy absences required before leave can publish. */
export const POOL_WIRE_LEAVE_ABSENCE_POLLS = 2
/** Circuit breaker: missing > max(10, 20% of previous membership). */
export const POOL_WIRE_MASS_DROP_ABS = 10
export const POOL_WIRE_MASS_DROP_PCT = 0.2

export type PoolWireEventKind = 'went_live' | 'entered_live_set' | 'left_live_set'

export type ChannelKey = string

export interface PoolChannel {
  key: ChannelKey
  login: string
  displayName?: string
  category?: string
  streamId?: string
  viewers?: number
}

export interface PendingEntry {
  channel: PoolChannel
  firstSeenAt: number
  firstSeenPollSequence: number
}

export interface PendingLeave {
  channel: PoolChannel
  firstAbsentAt: number
  consecutiveAbsences: number
}

export interface PoolWireEvent {
  id: string
  kind: PoolWireEventKind
  channelKey: ChannelKey
  login: string
  displayName?: string
  category?: string
  at: number
  /** Derived from live-pool polling (not authoritative stream_opening). */
  derived: boolean
  openingId?: string
}

export interface PoolWireState {
  initialized: boolean
  channels: Map<ChannelKey, PoolChannel>
  pendingEntries: Map<ChannelKey, PendingEntry>
  pendingLeaves: Map<ChannelKey, PendingLeave>
  seenOpeningIds: Set<string>
  events: PoolWireEvent[]
  circuitOpen: boolean
  lastConsumedPollSequence: number | null
}

export interface PoolWireSnapshot {
  pollSequence: number
  /** Wall time when this successful poll was received. */
  receivedAt: number
  healthy: boolean
  liveChannels: HubLiveChannel[]
  livePulseMoments: HubLivePulseMoment[]
}

export function createEmptyPoolWireState(): PoolWireState {
  return {
    initialized: false,
    channels: new Map(),
    pendingEntries: new Map(),
    pendingLeaves: new Map(),
    seenOpeningIds: new Set(),
    events: [],
    circuitOpen: false,
    lastConsumedPollSequence: null,
  }
}

export function channelKeyFromLive(channel: HubLiveChannel): ChannelKey {
  const streamId = channel.streamId?.trim()
  if (streamId) return `stream:${streamId}`
  return `login:${channel.login.trim().toLowerCase()}`
}

export function channelKeyFromMoment(moment: HubLivePulseMoment): ChannelKey | null {
  const streamId = moment.streamId?.trim()
  if (streamId) return `stream:${streamId}`
  const login = moment.login?.trim().toLowerCase()
  if (login) return `login:${login}`
  return null
}

export function poolChannelFromLive(channel: HubLiveChannel): PoolChannel {
  return {
    key: channelKeyFromLive(channel),
    login: channel.login.trim().toLowerCase(),
    displayName: channel.displayName?.trim() || channel.login,
    category: channel.category?.trim() || undefined,
    streamId: channel.streamId?.trim() || undefined,
    viewers: channel.viewers,
  }
}

export function openingDedupeId(moment: HubLivePulseMoment): string | null {
  const kind = (moment.kind ?? '').trim().toLowerCase()
  if (kind !== 'stream_opening') return null
  const key = channelKeyFromMoment(moment)
  if (!key) return null
  const at = momentAtMs(moment)
  if (moment.streamId?.trim()) {
    return `open:stream:${moment.streamId.trim()}:${at}`
  }
  return `open:${key}:${at}`
}

function momentAtMs(moment: HubLivePulseMoment): number {
  const raw = moment.at ?? moment.streamStartedAt
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0
  return raw > 1e12 ? raw : raw * 1000
}

export function isLifecycleMomentKind(kind: string | undefined): boolean {
  const normalized = (kind ?? '').trim().toLowerCase()
  return (
    normalized === 'stream_opening' ||
    normalized === 'live_attach' ||
    normalized === 'went_live' ||
    normalized === 'entered_live_set' ||
    normalized === 'left_live_set'
  )
}

export function isPeakMomentKind(kind: string | undefined): boolean {
  return !isLifecycleMomentKind(kind)
}

function cloneState(state: PoolWireState): PoolWireState {
  return {
    initialized: state.initialized,
    channels: new Map(state.channels),
    pendingEntries: new Map(state.pendingEntries),
    pendingLeaves: new Map(state.pendingLeaves),
    seenOpeningIds: new Set(state.seenOpeningIds),
    events: [...state.events],
    circuitOpen: state.circuitOpen,
    lastConsumedPollSequence: state.lastConsumedPollSequence,
  }
}

function pushEvent(state: PoolWireState, event: PoolWireEvent): void {
  state.events = [event, ...state.events.filter((e) => e.id !== event.id)].slice(
    0,
    POOL_WIRE_MAX_EVENTS,
  )
}

function rememberOpeningId(state: PoolWireState, id: string): void {
  state.seenOpeningIds.add(id)
  if (state.seenOpeningIds.size <= POOL_WIRE_SEEN_OPENING_CAP) return
  const excess = state.seenOpeningIds.size - POOL_WIRE_SEEN_OPENING_CAP
  let removed = 0
  for (const existing of state.seenOpeningIds) {
    state.seenOpeningIds.delete(existing)
    removed += 1
    if (removed >= excess) break
  }
}

function buildMembership(channels: HubLiveChannel[]): Map<ChannelKey, PoolChannel> {
  const map = new Map<ChannelKey, PoolChannel>()
  for (const ch of channels) {
    if (!ch.login?.trim()) continue
    const pool = poolChannelFromLive(ch)
    map.set(pool.key, pool)
  }
  return map
}

function seedOpenings(
  state: PoolWireState,
  moments: HubLivePulseMoment[],
  receivedAt: number,
  membership: Map<ChannelKey, PoolChannel>,
): void {
  const horizonStart = receivedAt - POOL_WIRE_SEED_HORIZON_MS
  const openings = moments
    .filter((m) => (m.kind ?? '').trim().toLowerCase() === 'stream_opening')
    .map((m) => ({ moment: m, at: momentAtMs(m), id: openingDedupeId(m) }))
    .filter((row): row is { moment: HubLivePulseMoment; at: number; id: string } =>
      Boolean(row.id && row.at >= horizonStart),
    )
    .sort((a, b) => b.at - a.at)

  const seeded: PoolWireEvent[] = []
  for (const row of openings) {
    if (state.seenOpeningIds.has(row.id)) continue
    const key = channelKeyFromMoment(row.moment)
    if (!key) continue
    rememberOpeningId(state, row.id)
    const live = membership.get(key)
    seeded.push({
      id: `evt:${row.id}`,
      kind: 'went_live',
      channelKey: key,
      login: (row.moment.login ?? live?.login ?? '').trim().toLowerCase() || key,
      displayName: row.moment.displayName?.trim() || live?.displayName,
      category: row.moment.category?.trim() || live?.category,
      at: row.at || receivedAt,
      derived: false,
      openingId: row.id,
    })
    if (seeded.length >= POOL_WIRE_MAX_EVENTS) break
  }
  state.events = seeded
}

function upgradeOrInsertWentLive(
  state: PoolWireState,
  channel: PoolChannel,
  at: number,
  openingId: string,
): void {
  const existingIdx = state.events.findIndex(
    (e) =>
      e.channelKey === channel.key &&
      (e.kind === 'entered_live_set' || e.kind === 'went_live'),
  )
  const event: PoolWireEvent = {
    id: `evt:${openingId}`,
    kind: 'went_live',
    channelKey: channel.key,
    login: channel.login,
    displayName: channel.displayName,
    category: channel.category,
    at,
    derived: false,
    openingId,
  }
  if (existingIdx >= 0) {
    const next = [...state.events]
    next[existingIdx] = event
    // Move upgraded row to front
    const [upgraded] = next.splice(existingIdx, 1)
    state.events = [upgraded, ...next].slice(0, POOL_WIRE_MAX_EVENTS)
    return
  }
  pushEvent(state, event)
}

/**
 * Reduce Pool Wire state with one successful (or invalid) hub snapshot.
 * Invalid/unhealthy snapshots freeze membership and do not advance leave counters.
 * Duplicate pollSequence is a no-op.
 */
export function reducePoolWireState(
  previous: PoolWireState,
  snapshot: PoolWireSnapshot,
): PoolWireState {
  if (
    previous.lastConsumedPollSequence != null &&
    snapshot.pollSequence <= previous.lastConsumedPollSequence
  ) {
    return previous
  }

  const next = cloneState(previous)
  next.lastConsumedPollSequence = snapshot.pollSequence

  if (!snapshot.healthy) {
    // Freeze: do not mutate membership, pending leaves, or emit events.
    return next
  }

  const membership = buildMembership(snapshot.liveChannels)

  // Baseline: first healthy snapshot
  if (!next.initialized) {
    next.initialized = true
    next.channels = membership
    next.circuitOpen = false
    next.pendingEntries.clear()
    next.pendingLeaves.clear()
    seedOpenings(next, snapshot.livePulseMoments, snapshot.receivedAt, membership)
    return next
  }

  const prevSize = next.channels.size
  const missingKeys: ChannelKey[] = []
  for (const key of next.channels.keys()) {
    if (!membership.has(key)) missingKeys.push(key)
  }

  const massDropThreshold = Math.max(
    POOL_WIRE_MASS_DROP_ABS,
    Math.ceil(prevSize * POOL_WIRE_MASS_DROP_PCT),
  )
  if (prevSize > 0 && missingKeys.length > massDropThreshold) {
    next.circuitOpen = true
    if (import.meta.env?.DEV) {
      console.debug(
        '[pool-wire] circuit open: mass drop',
        missingKeys.length,
        'of',
        prevSize,
        '(threshold',
        massDropThreshold,
        ')',
      )
    }
    // Preserve previous healthy baseline; do not emit leaves or update membership.
    return next
  }

  if (next.circuitOpen) {
    // Resume only when drop is no longer implausible relative to frozen baseline.
    if (missingKeys.length > massDropThreshold) {
      return next
    }
    next.circuitOpen = false
  }

  // Index openings in this snapshot
  const openingsByKey = new Map<ChannelKey, { moment: HubLivePulseMoment; id: string; at: number }>()
  for (const moment of snapshot.livePulseMoments) {
    const id = openingDedupeId(moment)
    if (!id || next.seenOpeningIds.has(id)) continue
    const key = channelKeyFromMoment(moment)
    if (!key) continue
    const at = momentAtMs(moment) || snapshot.receivedAt
    // Prefer newest opening per key in this snapshot
    const existing = openingsByKey.get(key)
    if (!existing || at >= existing.at) {
      openingsByKey.set(key, { moment, id, at })
    }
  }

  // Process openings first (authoritative)
  for (const [key, opening] of openingsByKey) {
    rememberOpeningId(next, opening.id)
    next.pendingEntries.delete(key)
    next.pendingLeaves.delete(key)
    const live = membership.get(key)
    const channel: PoolChannel = live ?? {
      key,
      login: (opening.moment.login ?? '').trim().toLowerCase() || key,
      displayName: opening.moment.displayName?.trim(),
      category: opening.moment.category?.trim(),
      streamId: opening.moment.streamId?.trim(),
    }
    upgradeOrInsertWentLive(next, channel, opening.at, opening.id)
  }

  // Present channels: metadata refresh + cancel pending leave
  for (const [key, channel] of membership) {
    if (next.channels.has(key)) {
      next.channels.set(key, channel)
      next.pendingLeaves.delete(key)
    }
  }

  // Additions → pending entries (reconcile with openings)
  for (const [key, channel] of membership) {
    if (next.channels.has(key)) continue
    if (openingsByKey.has(key)) {
      // Already emitted went_live above — commit membership
      next.channels.set(key, channel)
      next.pendingEntries.delete(key)
      continue
    }
    const pending = next.pendingEntries.get(key)
    if (!pending) {
      next.pendingEntries.set(key, {
        channel,
        firstSeenAt: snapshot.receivedAt,
        firstSeenPollSequence: snapshot.pollSequence,
      })
      continue
    }
    pending.channel = channel
    const waitedPolls = snapshot.pollSequence - pending.firstSeenPollSequence
    const waitedMs = snapshot.receivedAt - pending.firstSeenAt
    if (waitedPolls >= 1 || waitedMs >= POOL_WIRE_ENTRY_RECONCILE_MS) {
      next.pendingEntries.delete(key)
      pushEvent(next, {
        id: `evt:enter:${key}:${snapshot.pollSequence}`,
        kind: 'entered_live_set',
        channelKey: key,
        login: channel.login,
        displayName: channel.displayName,
        category: channel.category,
        at: snapshot.receivedAt,
        derived: true,
      })
      next.channels.set(key, channel)
    }
  }

  // Drop pending entries that vanished before publish
  for (const key of [...next.pendingEntries.keys()]) {
    if (!membership.has(key)) {
      next.pendingEntries.delete(key)
    }
  }

  // Removals → pending leaves (keep in channels until published)
  for (const [key, prevChannel] of next.channels) {
    if (membership.has(key)) continue
    const pending = next.pendingLeaves.get(key)
    if (!pending) {
      next.pendingLeaves.set(key, {
        channel: prevChannel,
        firstAbsentAt: snapshot.receivedAt,
        consecutiveAbsences: 1,
      })
      continue
    }
    pending.consecutiveAbsences += 1
    const waitedMs = snapshot.receivedAt - pending.firstAbsentAt
    if (
      pending.consecutiveAbsences >= POOL_WIRE_LEAVE_ABSENCE_POLLS &&
      waitedMs >= POOL_WIRE_LEAVE_GRACE_MS
    ) {
      next.pendingLeaves.delete(key)
      next.channels.delete(key)
      pushEvent(next, {
        id: `evt:leave:${key}:${snapshot.pollSequence}`,
        kind: 'left_live_set',
        channelKey: key,
        login: pending.channel.login,
        displayName: pending.channel.displayName,
        category: pending.channel.category,
        at: snapshot.receivedAt,
        derived: true,
      })
    }
  }

  return next
}

export function poolWireEventLabel(kind: PoolWireEventKind): string {
  switch (kind) {
    case 'went_live':
      return 'Went live'
    case 'entered_live_set':
      return 'Entered live set'
    case 'left_live_set':
      return 'Left live set'
  }
}
