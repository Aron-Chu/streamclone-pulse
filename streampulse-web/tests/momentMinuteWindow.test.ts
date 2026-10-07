import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/lib/apiClient'
import { PORTAL_MINUTES_TIMEOUT_MS } from '../src/lib/timelineDownsample'
import {
  clearMomentMinuteWindowCacheForTests,
  loadMomentMinuteWindow,
  MOMENT_MINUTES_SETTLE_MS,
  momentMinutesAfterOffset,
  momentMinuteWindowFromMinutes,
  peekMomentMinuteWindow,
} from '../src/lib/momentMinuteWindow'

const NOW = Date.parse('2026-10-06T20:00:00Z')
// The broadcast starts 17s past a minute, as real ones do.
const START = Date.parse('2026-10-06T18:00:17Z')
const moment = { login: 'xqc', streamId: 's1', offsetSeconds: 5400 }
const momentMinute = Math.floor((START + moment.offsetSeconds * 1000) / 60_000)
/** The row the API returns for the minute `relative` minutes from the moment. */
function row(relative: number, fields: Record<string, unknown> = {}) {
  const minuteMs = (momentMinute + relative) * 60_000
  return { offsetSeconds: Math.max(0, Math.round((minuteMs - START) / 1000)), viewerAvg: 100, ...fields }
}
const payload = (minutes: unknown[], extra: Record<string, unknown> = {}) =>
  ({ streamId: 's1', channel: 'xqc', startedAt: new Date(START).toISOString(), minutes, updatedAt: NOW, ...extra })
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
/** A read with no settle time: the moment is taken as kept open. */
const readNow = (target: Parameters<typeof loadMomentMinuteWindow>[0] = moment, signal = new AbortController().signal) => loadMomentMinuteWindow(target, signal, 0)

/** The backend's offset for a minute: int(MinuteTS - StartedAt) in seconds, clamped at 0. */
const goOffset = (minuteMs: number, startMicros: number) => Math.max(0, Math.trunc((minuteMs * 1000 - startMicros) / 1_000_000))
/** Rows 12:00 … 12:20 against a start given in microseconds; each minute's count names it (100 + minutes past 12:00). */
function broadcastRows(startMicros: number) {
  const noon = Date.parse('2026-10-06T12:00:00Z')
  return Array.from({ length: 21 }, (_, index) => ({ offsetSeconds: goOffset(noon + index * 60_000, startMicros), viewerAvg: 100, chatCount: 100 + index }))
}
const atMinute = (time: string) => Date.parse(`2026-10-06T${time}Z`)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearMomentMinuteWindowCacheForTests()
})

describe('moment minute window', () => {
  it('asks for whole minutes from just before the window', () => {
    expect(momentMinutesAfterOffset(5400)).toBe(5400 - 31 * 60)
    expect(momentMinutesAfterOffset(5430)).toBe(3540)
    expect(momentMinutesAfterOffset(120)).toBe(0)
  })

  it('places measured minutes 30 before to 10 after, with the moment at index 30', () => {
    const minutes = Array.from({ length: 50 }, (_, index) => row(index - 35, { chatCount: 100 + index }))
    const window = momentMinuteWindowFromMinutes(moment, payload(minutes), NOW)!
    expect(window.slots).toHaveLength(41)
    expect(window.slots[0]).toEqual({ relative: -30, state: 'measured', chatPerMin: 105 })
    expect(window.slots[30]).toEqual({ relative: 0, state: 'measured', chatPerMin: 135 })
    expect(window.slots[40]).toEqual({ relative: 10, state: 'measured', chatPerMin: 145 })
    expect(window.measuredMinutes).toBe(41)
    expect(window.unrecordedMinutes).toBe(0)
    expect(window.complete).toBe(true)
  })

  it('keeps a flagged-missing or absent minute empty, and a row with no chat count is no chat recorded, not a measured zero', () => {
    const minutes = [row(-4, { chatCount: 0 }), row(-3, { chatCount: 50 }), row(-2, { missing: true }), row(-1), row(0, { chatCount: 393 }), row(2, { chatCount: 80 })]
    const window = momentMinuteWindowFromMinutes(moment, payload(minutes), NOW)!
    const at = (relative: number) => window.slots[relative + 30]
    expect(at(-2)).toEqual({ relative: -2, state: 'unmeasured', chatPerMin: null })
    // A viewer-only rollup (chat not captured) and a quiet minute look the same here.
    expect(at(-1)).toEqual({ relative: -1, state: 'unrecorded', chatPerMin: null })
    // An explicit count of zero is a measurement.
    expect(at(-4)).toEqual({ relative: -4, state: 'measured', chatPerMin: 0 })
    expect(at(1)).toEqual({ relative: 1, state: 'unmeasured', chatPerMin: null })
    // Nothing returned after +2 yet: those minutes are outside the data, not gaps.
    expect(at(3).state).toBe('outside')
    expect(window.complete).toBe(false)
    expect(window.measuredMinutes).toBe(4)
    expect(window.unrecordedMinutes).toBe(1)
  })

  it('is complete only once a minute past the window has arrived', () => {
    // The +10 minute itself may still be accumulating on a live broadcast.
    const through = (last: number) => Array.from({ length: last + 31 }, (_, index) => row(index - 30, { chatCount: 100 }))
    const atEdge = momentMinuteWindowFromMinutes(moment, payload(through(10)), NOW)!
    expect(atEdge.slots[40]).toEqual({ relative: 10, state: 'measured', chatPerMin: 100 })
    expect(atEdge.complete).toBe(false)
    expect(momentMinuteWindowFromMinutes(moment, payload(through(11)), NOW)!.complete).toBe(true)
  })

  it('does not draw a window whose rows carry no chat count at all', () => {
    // Viewer rollups only, as before a channel's chat is bound: nothing was measured.
    const minutes = Array.from({ length: 41 }, (_, index) => row(index - 30))
    expect(momentMinuteWindowFromMinutes(moment, payload(minutes), NOW)).toBeNull()
  })

  it('marks minutes before the broadcast started as outside it', () => {
    const early = { ...moment, offsetSeconds: 240 }
    const earlyMinute = Math.floor((START + 240 * 1000) / 60_000)
    const minutes = Array.from({ length: 12 }, (_, index) => {
      const minuteMs = (earlyMinute - 4 + index) * 60_000
      return { offsetSeconds: Math.max(0, Math.round((minuteMs - START) / 1000)), chatCount: 10 + index }
    })
    const window = momentMinuteWindowFromMinutes(early, payload(minutes), NOW)!
    expect(window.slots.slice(0, 26).every(slot => slot.state === 'outside')).toBe(true)
    expect(window.slots[26]).toMatchObject({ relative: -4, state: 'measured' })
    expect(window.slots[30]).toEqual({ relative: 0, state: 'measured', chatPerMin: 14 })
  })

  it('keeps the last row for a repeated minute, as the timeline does', () => {
    const window = momentMinuteWindowFromMinutes(moment, payload([row(0, { chatCount: 1 }), row(0, { chatCount: 393 })]), NOW)!
    expect(window.slots[30].chatPerMin).toBe(393)
  })

  it('maps rows the way the backend truncated them against a start with a fractional second', () => {
    // 12:00:23.500: every offset is a whole second short of the start plus the minute.
    const startMicros = atMinute('12:00:23.500') * 1000
    const at = { login: 'xqc', streamId: 's1', offsetSeconds: goOffset(atMinute('12:05:00'), startMicros) }
    expect(at.offsetSeconds).toBe(276)
    const window = momentMinuteWindowFromMinutes(at, payload(broadcastRows(startMicros), { startedAt: '2026-10-06T12:00:23.500Z' }), NOW)!
    const slot = (relative: number) => window.slots[relative + 30]
    // The broadcast's first, partial minute (offset clamped to 0) keeps its own bar.
    expect(slot(-5)).toEqual({ relative: -5, state: 'measured', chatPerMin: 100 })
    expect(slot(-6).state).toBe('outside')
    for (let relative = -5; relative <= 10; relative += 1) expect(slot(relative).chatPerMin).toBe(105 + relative)
  })

  it('reads a start’s sub-millisecond remainder from its text', () => {
    // Date.parse keeps 12:00:23.000; the backend counted from 12:00:23.000412.
    const startMicros = atMinute('12:00:23') * 1000 + 412
    const at = { login: 'xqc', streamId: 's1', offsetSeconds: goOffset(atMinute('12:05:00'), startMicros) }
    const window = momentMinuteWindowFromMinutes(at, payload(broadcastRows(startMicros), { startedAt: '2026-10-06T12:00:23.000412Z' }), NOW)!
    for (let relative = -5; relative <= 10; relative += 1) expect(window.slots[relative + 30].chatPerMin).toBe(105 + relative)
  })

  it('places the window by the moment’s own minute when the start was revised after it was published', () => {
    // First seen at 12:03:23.4, so the moment at 12:20 was published with that offset;
    // the start was later backfilled to 12:00:23 and the rows count from it.
    const firstSeen = atMinute('12:03:23.400') * 1000
    const backfilled = atMinute('12:00:23') * 1000
    const published = { login: 'xqc', streamId: 's1', offsetSeconds: goOffset(atMinute('12:20:00'), firstSeen) }
    const minutes = payload(broadcastRows(backfilled), { startedAt: '2026-10-06T12:00:23Z' })
    // A stored detection carries its minute; a live or ranked row the start plus the offset.
    for (const momentAt of [atMinute('12:20:00'), firstSeen / 1000 + published.offsetSeconds * 1000]) {
      const window = momentMinuteWindowFromMinutes({ ...published, at: momentAt }, minutes, NOW)!
      expect(window.slots[30]).toEqual({ relative: 0, state: 'measured', chatPerMin: 120 })
      expect(window.slots[10]).toEqual({ relative: -20, state: 'measured', chatPerMin: 100 })
      expect(window.slots[9].state).toBe('outside')
    }
    // From the offset alone, the same moment lands three minutes early.
    expect(momentMinuteWindowFromMinutes(published, minutes, NOW)!.slots[30].chatPerMin).toBe(116)
  })

  it('agrees with the offset when the moment’s time and the start match, even a second before the minute', () => {
    const startMicros = atMinute('12:00:23.500') * 1000
    const offsetSeconds = goOffset(atMinute('12:05:00'), startMicros)
    // The backend's live rows: start + offset, half a second before 12:05.
    const live = { login: 'xqc', streamId: 's1', offsetSeconds, at: startMicros / 1000 + offsetSeconds * 1000 }
    const minutes = payload(broadcastRows(startMicros), { startedAt: '2026-10-06T12:00:23.500Z' })
    expect(momentMinuteWindowFromMinutes(live, minutes, NOW)).toEqual(momentMinuteWindowFromMinutes({ ...live, at: undefined }, minutes, NOW))
    expect(momentMinuteWindowFromMinutes(live, minutes, NOW)!.slots[30].chatPerMin).toBe(105)
  })

  it('refuses another broadcast, another channel, a bad start, or a window with nothing measured', () => {
    const minutes = [row(0, { chatCount: 393 })]
    expect(momentMinuteWindowFromMinutes(moment, payload(minutes, { streamId: 'other' }), NOW)).toBeNull()
    expect(momentMinuteWindowFromMinutes(moment, payload(minutes, { channel: 'forsen' }), NOW)).toBeNull()
    expect(momentMinuteWindowFromMinutes(moment, payload(minutes, { startedAt: '0001-01-01T00:00:00Z' }), NOW)).toBeNull()
    expect(momentMinuteWindowFromMinutes(moment, payload([row(0, { missing: true }), row(-40, { chatCount: 9 })]), NOW)).toBeNull()
    expect(momentMinuteWindowFromMinutes(moment, payload(minutes, { minutes: 'nope' }), NOW)).toBeNull()
    expect(momentMinuteWindowFromMinutes(moment, null, NOW)).toBeNull()
  })

  it('reads the bounded tail once, caches it, and never caches a failure', async () => {
    const minutes = Array.from({ length: 50 }, (_, index) => row(index - 35, { chatCount: 100 }))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(payload(minutes, { startedAt: new Date(START).toISOString() })), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const first = await readNow()
    expect(first?.measuredMinutes).toBe(41)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/v1/portal/analytics/streams/s1/minutes')
    expect(url.searchParams.get('afterOffset')).toBe(String(5400 - 31 * 60))
    expect(peekMomentMinuteWindow(moment)?.value).toEqual(first)
    await readNow()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const other = { ...moment, offsetSeconds: 9000 }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
    await expect(readNow(other)).rejects.toMatchObject({ status: 503 })
    expect(peekMomentMinuteWindow(other)).toBeNull()
  })

  it('keeps a still-filling window for a minute and a finished one for ten', async () => {
    const respond = (last: number) => async () => new Response(JSON.stringify(payload(
      Array.from({ length: last + 36 }, (_, index) => row(index - 35, { chatCount: 100 })))), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const read = () => readNow()

    // Live: nothing past +10 yet, so later minutes may still arrive.
    const fetchLive = vi.fn(respond(10))
    vi.stubGlobal('fetch', fetchLive)
    expect((await read())?.complete).toBe(false)
    clock.mockReturnValue(NOW + 59_000)
    expect(peekMomentMinuteWindow(moment)).not.toBeNull()
    await read()
    expect(fetchLive).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(NOW + 61_000)
    expect(peekMomentMinuteWindow(moment)).toBeNull()
    await read()
    expect(fetchLive).toHaveBeenCalledTimes(2)

    // Finished: a minute past the window arrived, so it cannot change for ten minutes.
    clearMomentMinuteWindowCacheForTests()
    clock.mockReturnValue(NOW)
    const fetchDone = vi.fn(respond(14))
    vi.stubGlobal('fetch', fetchDone)
    expect((await read())?.complete).toBe(true)
    clock.mockReturnValue(NOW + 61_000)
    await read()
    clock.mockReturnValue(NOW + 9 * 60_000 + 59_000)
    expect(peekMomentMinuteWindow(moment)).not.toBeNull()
    await read()
    expect(fetchDone).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(NOW + 10 * 60_000 + 1_000)
    expect(peekMomentMinuteWindow(moment)).toBeNull()
    await read()
    expect(fetchDone).toHaveBeenCalledTimes(2)
  })

  it('gives the read the stream timeline’s minutes budget', async () => {
    const spy = vi.spyOn(api, 'apiClient').mockResolvedValue({ data: payload([row(0, { chatCount: 393 })]), status: 200 })
    await readNow()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('/v1/portal/analytics/streams/s1/minutes?afterOffset='), expect.objectContaining({ timeoutMs: PORTAL_MINUTES_TIMEOUT_MS }))
    expect(PORTAL_MINUTES_TIMEOUT_MS).toBe(15_000)
  })

  it('sends nothing for a moment left before it settles, and reads one kept open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const minutes = Array.from({ length: 50 }, (_, index) => row(index - 35, { chatCount: 100 }))
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(payload(minutes)))
      vi.stubGlobal('fetch', fetchMock)
      // Previous/Next held down: each step's chart leaves well inside the settle time.
      for (const offsetSeconds of [5400, 5460, 5520]) {
        const step = new AbortController()
        const passed = loadMomentMinuteWindow({ ...moment, offsetSeconds }, step.signal)
        await vi.advanceTimersByTimeAsync(40)
        step.abort()
        await expect(passed).rejects.toMatchObject({ kind: 'aborted' })
      }
      await vi.advanceTimersByTimeAsync(MOMENT_MINUTES_SETTLE_MS * 2)
      expect(fetchMock).not.toHaveBeenCalled()
      const kept = loadMomentMinuteWindow(moment, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(MOMENT_MINUTES_SETTLE_MS - 1)
      expect(fetchMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect((await kept)?.measuredMinutes).toBe(41)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares one read between waits for the same moment, and a wait that ends never cancels it', async () => {
    const minutes = Array.from({ length: 50 }, (_, index) => row(index - 35, { chatCount: 100 }))
    const answers: Array<() => void> = []
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(resolve => { answers.push(() => resolve(json(payload(minutes)))) }))
    vi.stubGlobal('fetch', fetchMock)
    // A chart remounts for the same moment while its read is in flight.
    const first = new AbortController()
    const firstWait = readNow(moment, first.signal)
    const secondWait = readNow(moment)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    first.abort()
    await expect(firstWait).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
    answers[0]!()
    expect((await secondWait)?.measuredMinutes).toBe(41)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Closed while its read was in flight, then reopened: the answer is already kept.
    const other = { ...moment, offsetSeconds: 9000 }
    const closed = new AbortController()
    const closedWait = readNow(other, closed.signal)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    closed.abort()
    await expect(closedWait).rejects.toMatchObject({ kind: 'aborted' })
    answers[1]!()
    await vi.waitFor(() => expect(peekMomentMinuteWindow(other)).not.toBeNull())
    await readNow(other)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('makes no portal read against the local analytics stack, which has no such route', async () => {
    vi.spyOn(api, 'getBackendUrl').mockReturnValue('http://localhost:8081')
    const spy = vi.spyOn(api, 'apiClient')
    await expect(loadMomentMinuteWindow(moment, new AbortController().signal)).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
