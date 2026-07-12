import { describe, expect, it } from 'vitest'
import type { HubLiveChannel, HubLivePulseMoment } from '../src/lib/publicHub'
import {
  POOL_WIRE_LEAVE_GRACE_MS,
  POOL_WIRE_MAX_EVENTS,
  channelKeyFromLive,
  createEmptyPoolWireState,
  isLifecycleMomentKind,
  isPeakMomentKind,
  reducePoolWireState,
  type PoolWireSnapshot,
  type PoolWireState,
} from '../src/lib/poolWireReducer'

function ch(
  login: string,
  overrides: Partial<HubLiveChannel> = {},
): HubLiveChannel {
  return {
    login,
    displayName: overrides.displayName ?? login,
    category: overrides.category ?? 'Just Chatting',
    viewers: overrides.viewers ?? 1000,
    chatPerMin: overrides.chatPerMin ?? 10,
    seventvPerMin: overrides.seventvPerMin ?? 0,
    coverageState: overrides.coverageState ?? 'synced',
    trendPct: overrides.trendPct ?? 0,
    streamId: overrides.streamId,
    ...overrides,
  }
}

function opening(
  login: string,
  at: number,
  overrides: Partial<HubLivePulseMoment> = {},
): HubLivePulseMoment {
  return {
    login,
    displayName: login,
    kind: 'stream_opening',
    label: 'Just went live',
    offsetSeconds: 0,
    score: 1,
    at,
    category: 'Just Chatting',
    ...overrides,
  }
}

function snap(
  seq: number,
  receivedAt: number,
  liveChannels: HubLiveChannel[],
  livePulseMoments: HubLivePulseMoment[] = [],
  healthy = true,
): PoolWireSnapshot {
  return {
    pollSequence: seq,
    receivedAt,
    healthy,
    liveChannels,
    livePulseMoments,
  }
}

function reduce(
  state: PoolWireState,
  snapshot: PoolWireSnapshot,
): PoolWireState {
  return reducePoolWireState(state, snapshot)
}

const T0 = 1_700_000_000_000

describe('poolWireReducer', () => {
  it('baseline emits no derived events and seeds recent openings', () => {
    const channels = [ch('xqc', { streamId: 's1' }), ch('kai', { streamId: 's2' })]
    const moments = [
      opening('xqc', T0 - 5 * 60_000, { streamId: 's1' }),
      opening('old', T0 - 2 * 60 * 60_000, { streamId: 's99' }),
    ]
    const state = reduce(createEmptyPoolWireState(), snap(1, T0, channels, moments))
    expect(state.initialized).toBe(true)
    expect(state.channels.size).toBe(2)
    expect(state.events.every((e) => e.kind === 'went_live')).toBe(true)
    expect(state.events.some((e) => e.login === 'xqc')).toBe(true)
    expect(state.events.some((e) => e.login === 'old')).toBe(false)
    expect(state.events.every((e) => !e.derived)).toBe(true)
  })

  it('duplicate pollSequence is a no-op', () => {
    let state = reduce(createEmptyPoolWireState(), snap(1, T0, [ch('xqc')]))
    const mid = state
    state = reduce(state, snap(1, T0 + 1000, [ch('xqc'), ch('kai')]))
    expect(state).toBe(mid)
  })

  it('reordered liveChannels emits nothing', () => {
    const a = [ch('xqc', { streamId: '1' }), ch('kai', { streamId: '2' })]
    const b = [ch('kai', { streamId: '2' }), ch('xqc', { streamId: '1' })]
    let state = reduce(createEmptyPoolWireState(), snap(1, T0, a))
    state = reduce(state, snap(2, T0 + 45_000, b))
    expect(state.events.filter((e) => e.derived)).toHaveLength(0)
    expect(state.events.filter((e) => e.kind !== 'went_live' || e.at < T0 - POOL_WIRE_MAX_EVENTS)).toBeDefined()
    expect(state.events.every((e) => e.kind === 'went_live')).toBe(true)
  })

  it('viewer/category/display-name changes emit nothing', () => {
    let state = reduce(
      createEmptyPoolWireState(),
      snap(1, T0, [ch('xqc', { streamId: '1', viewers: 100, category: 'A', displayName: 'xQc' })]),
    )
    const eventCount = state.events.length
    state = reduce(
      state,
      snap(2, T0 + 45_000, [
        ch('xqc', { streamId: '1', viewers: 9999, category: 'VALORANT', displayName: 'xQcOW' }),
      ]),
    )
    expect(state.events).toHaveLength(eventCount)
  })

  it('login capitalization changes emit nothing', () => {
    let state = reduce(createEmptyPoolWireState(), snap(1, T0, [ch('XQC', { streamId: '1' })]))
    const eventCount = state.events.length
    state = reduce(state, snap(2, T0 + 45_000, [ch('xqc', { streamId: '1' })]))
    expect(state.events).toHaveLength(eventCount)
    expect(channelKeyFromLive(ch('XQC', { streamId: '1' }))).toBe(
      channelKeyFromLive(ch('xqc', { streamId: '1' })),
    )
  })

  it('repeated opening moment across polls emits once', () => {
    const moment = opening('tarik', T0 - 10_000, { streamId: 'st' })
    let state = reduce(createEmptyPoolWireState(), snap(1, T0, [ch('tarik', { streamId: 'st' })], [moment]))
    expect(state.events.filter((e) => e.kind === 'went_live')).toHaveLength(1)
    state = reduce(
      state,
      snap(2, T0 + 45_000, [ch('tarik', { streamId: 'st' })], [moment]),
    )
    expect(state.events.filter((e) => e.kind === 'went_live' && e.login === 'tarik')).toHaveLength(1)
  })

  it('late opening upgrades pending entry instead of duplicating', () => {
    let state = reduce(createEmptyPoolWireState(), snap(1, T0, [ch('base', { streamId: 'b' })]))
    // New channel without opening
    state = reduce(state, snap(2, T0 + 10_000, [ch('base', { streamId: 'b' }), ch('new', { streamId: 'n' })]))
    expect(state.pendingEntries.has('stream:n')).toBe(true)
    expect(state.events.some((e) => e.login === 'new')).toBe(false)
    // Opening arrives during reconcile window
    state = reduce(
      state,
      snap(
        3,
        T0 + 20_000,
        [ch('base', { streamId: 'b' }), ch('new', { streamId: 'n' })],
        [opening('new', T0 + 19_000, { streamId: 'n' })],
      ),
    )
    const newEvents = state.events.filter((e) => e.login === 'new')
    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]?.kind).toBe('went_live')
    expect(newEvents[0]?.derived).toBe(false)
    expect(state.pendingEntries.has('stream:n')).toBe(false)
  })

  it('emits entered_live_set after reconcile when no opening arrives', () => {
    let state = reduce(createEmptyPoolWireState(), snap(1, T0, [ch('base', { streamId: 'b' })]))
    state = reduce(state, snap(2, T0 + 5_000, [ch('base', { streamId: 'b' }), ch('join', { streamId: 'j' })]))
    expect(state.events.some((e) => e.kind === 'entered_live_set')).toBe(false)
    state = reduce(state, snap(3, T0 + 50_000, [ch('base', { streamId: 'b' }), ch('join', { streamId: 'j' })]))
    const entered = state.events.filter((e) => e.kind === 'entered_live_set')
    expect(entered).toHaveLength(1)
    expect(entered[0]?.derived).toBe(true)
    expect(entered[0]?.login).toBe('join')
  })

  it('unhealthy snapshots freeze counters and emit nothing', () => {
    let state = reduce(
      createEmptyPoolWireState(),
      snap(1, T0, [ch('a', { streamId: '1' }), ch('b', { streamId: '2' })]),
    )
    const before = state.events.length
    state = reduce(
      state,
      snap(2, T0 + 45_000, [], [], false),
    )
    expect(state.events).toHaveLength(before)
    expect(state.channels.size).toBe(2)
    expect(state.pendingLeaves.size).toBe(0)
  })

  it('two rapid absences do not bypass leave grace time', () => {
    let state = reduce(
      createEmptyPoolWireState(),
      snap(1, T0, [ch('a', { streamId: '1' }), ch('b', { streamId: '2' })]),
    )
    state = reduce(state, snap(2, T0 + 1_000, [ch('a', { streamId: '1' })]))
    expect(state.pendingLeaves.size).toBe(1)
    state = reduce(state, snap(3, T0 + 2_000, [ch('a', { streamId: '1' })]))
    expect(state.events.some((e) => e.kind === 'left_live_set')).toBe(false)
    expect(state.channels.has('stream:2')).toBe(true)
  })

  it('publishes leave after two absences and grace, using previous metadata', () => {
    let state = reduce(
      createEmptyPoolWireState(),
      snap(1, T0, [
        ch('a', { streamId: '1' }),
        ch('kai', { streamId: '2', displayName: 'KaiCenat', category: 'Just Chatting' }),
      ]),
    )
    state = reduce(state, snap(2, T0 + 30_000, [ch('a', { streamId: '1' })]))
    state = reduce(state, snap(3, T0 + 30_000 + POOL_WIRE_LEAVE_GRACE_MS, [ch('a', { streamId: '1' })]))
    const left = state.events.find((e) => e.kind === 'left_live_set')
    expect(left).toBeTruthy()
    expect(left?.displayName).toBe('KaiCenat')
    expect(left?.category).toBe('Just Chatting')
    expect(left?.derived).toBe(true)
    expect(state.channels.has('stream:2')).toBe(false)
  })

  it('cancels pending leave if channel returns before publish', () => {
    let state = reduce(
      createEmptyPoolWireState(),
      snap(1, T0, [ch('a', { streamId: '1' }), ch('b', { streamId: '2' })]),
    )
    state = reduce(state, snap(2, T0 + 30_000, [ch('a', { streamId: '1' })]))
    expect(state.pendingLeaves.size).toBe(1)
    state = reduce(
      state,
      snap(3, T0 + 30_000 + POOL_WIRE_LEAVE_GRACE_MS, [
        ch('a', { streamId: '1' }),
        ch('b', { streamId: '2' }),
      ]),
    )
    expect(state.pendingLeaves.size).toBe(0)
    expect(state.events.some((e) => e.kind === 'left_live_set')).toBe(false)
  })

  it('mass pool drop opens circuit breaker and emits no leaves', () => {
    const many = Array.from({ length: 20 }, (_, i) => ch(`c${i}`, { streamId: `s${i}` }))
    let state = reduce(createEmptyPoolWireState(), snap(1, T0, many))
    // Drop 15 (> max(10, 20%*20=4))
    state = reduce(state, snap(2, T0 + 45_000, many.slice(0, 5)))
    expect(state.circuitOpen).toBe(true)
    expect(state.events.some((e) => e.kind === 'left_live_set')).toBe(false)
    expect(state.channels.size).toBe(20)
  })

  it('caps events at five newest-first', () => {
    let state = reduce(createEmptyPoolWireState(), snap(1, T0, [ch('base', { streamId: 'b' })]))
    for (let i = 0; i < 8; i++) {
      const channels = [
        ch('base', { streamId: 'b' }),
        ...Array.from({ length: i + 1 }, (_, j) => ch(`n${j}`, { streamId: `n${j}` })),
      ]
      state = reduce(state, snap(2 + i * 2, T0 + i * 90_000, channels))
      state = reduce(state, snap(3 + i * 2, T0 + i * 90_000 + 50_000, channels))
    }
    expect(state.events.length).toBeLessThanOrEqual(POOL_WIRE_MAX_EVENTS)
    for (let i = 1; i < state.events.length; i++) {
      expect(state.events[i - 1]!.at).toBeGreaterThanOrEqual(state.events[i]!.at)
    }
  })

  it('classifies lifecycle vs peak kinds for Live Wire filtering', () => {
    expect(isLifecycleMomentKind('stream_opening')).toBe(true)
    expect(isLifecycleMomentKind('live_attach')).toBe(true)
    expect(isPeakMomentKind('chat_spike')).toBe(true)
    expect(isPeakMomentKind('emote_spike')).toBe(true)
    expect(isPeakMomentKind('stream_opening')).toBe(false)
  })
})
