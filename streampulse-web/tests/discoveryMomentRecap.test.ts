import { beforeEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: request }))
import { exactMomentRecapFrom, loadExactMomentRecap, momentRecapLists } from '../src/lib/discoveryMomentRecap'
import { fromHubMoment } from '../src/lib/discoveryMoments'
import { forgetFailedMomentReads, resetMomentReads } from '../src/lib/momentReads'

const moment = fromHubMoment({ login: 'supertf', streamId: 's1', offsetSeconds: 17058, label: 'Selected reaction' })!
const selected = { offsetSeconds: 17058, reasons: ['twitch_emote_spike'], chatCount: 215,
  topEmotes: [{ code: 'GTAB', count: 32, provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/example/4x.webp' }] }
describe('selected recap hydration', () => {
  beforeEach(() => { request.mockReset(); resetMomentReads() })
  it('loads the exact third detection, preserves imagery and never converts recap counts into minute rates', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ offsetSeconds: 1 }, { offsetSeconds: 17000 }, selected] } })
    const signal = new AbortController().signal
    const result = await loadExactMomentRecap(moment, signal)
    expect(result).toEqual({ label: 'Emote spike', topEmotes: [{ name: 'GTAB', count: 32, provider: 'seventv', imageUrl: selected.topEmotes[0].imageUrl }] })
    // One shared read per stream: the caller's signal stops its own wait, not the read (see below).
    expect(request).toHaveBeenCalledWith('/v1/portal/analytics/streams/s1/recap', { timeoutMs: 8000, maxResponseBytes: 524288 })
    expect(result).not.toHaveProperty('chatPerMin')
  })
  it.each([
    { login: 'other', streamId: 's1', topMoments: [selected] },
    { login: 'supertf', streamId: 'other', topMoments: [selected] },
    { login: 'supertf', streamId: 's1', topMoments: [{ ...selected, offsetSeconds: 17057 }] },
    { login: 'supertf', streamId: 's1', topMoments: [selected, selected] },
    { login: 'supertf', streamId: 's1', topMoments: null },
  ])('rejects mismatched, ambiguous or missing evidence', async data => {
    request.mockResolvedValue({ data })
    expect(await loadExactMomentRecap(moment, new AbortController().signal)).toBeNull()
  })
  it('does not claim a public ID match when recap omits that ID', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [selected] } })
    expect(await loadExactMomentRecap({ ...moment, publicMomentId: 'expected' }, new AbortController().signal)).toBeNull()
  })
  it('recognizes the backend 7TV reaction reason in an exact selected recap', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ ...selected, reasons: ['seventv_spike'] }] } })
    expect(await loadExactMomentRecap(moment, new AbortController().signal)).toMatchObject({ label: 'Emote spike' })
  })
  describe('whether the recap lists the Moment', () => {
    const signal = new AbortController().signal
    it('is true for the one matching row and false for a well-formed recap without it', async () => {
      request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [selected] } })
      expect(await momentRecapLists(moment, signal)).toBe(true)
      resetMomentReads()
      request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [] } })
      expect(await momentRecapLists(moment, signal)).toBe(false)
      resetMomentReads()
      request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ ...selected, offsetSeconds: 1 }] } })
      expect(await momentRecapLists(moment, signal)).toBe(false)
    })
    it.each([
      { login: 'other', streamId: 's1', topMoments: [] },
      { login: 'supertf', streamId: 'other', topMoments: [] },
      { login: 'supertf', streamId: 's1', topMoments: [selected, selected] },
      { login: 'supertf', streamId: 's1', topMoments: null },
      { login: 'supertf', streamId: 's1' },
    ])('says it cannot tell (throws) for a mismatched, malformed or ambiguous recap', async data => {
      request.mockResolvedValue({ data })
      await expect(momentRecapLists(moment, signal)).rejects.toThrow()
    })
  })
  describe('one recap read per stream', () => {
    it('shares one read between the list, the page and Up next', async () => {
      request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [selected] } })
      const [listed, details] = await Promise.all([
        momentRecapLists(moment, new AbortController().signal),
        loadExactMomentRecap(moment, new AbortController().signal),
      ])
      expect(listed).toBe(true)
      expect(details).toMatchObject({ label: 'Emote spike' })
      expect(await momentRecapLists(moment, new AbortController().signal)).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
    })
    it('keeps a failed read a few seconds; Retry reaction details forgets it and reads again', async () => {
      request.mockRejectedValueOnce(new Error('offline'))
      await expect(loadExactMomentRecap(moment, new AbortController().signal)).rejects.toThrow('offline')
      request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [selected] } })
      // Asked again at once (another row of the same stream): the kept failure, no second read.
      await expect(loadExactMomentRecap(moment, new AbortController().signal)).rejects.toThrow('offline')
      expect(request).toHaveBeenCalledTimes(1)
      // The retry button forgets it first (AnalyticsMomentsPage), so the retry reads again.
      forgetFailedMomentReads(moment.streamId)
      expect(await loadExactMomentRecap(moment, new AbortController().signal)).toMatchObject({ label: 'Emote spike' })
      expect(request).toHaveBeenCalledTimes(2)
    })
    it('says nothing (rejects) for an answer that is not a recap, rather than "not listed"', async () => {
      request.mockResolvedValue({ data: null })
      await expect(loadExactMomentRecap(moment, new AbortController().signal)).rejects.toThrow()
      await expect(momentRecapLists(moment, new AbortController().signal)).rejects.toThrow()
    })
    it('stops one caller’s wait on its signal without stopping the read for the others', async () => {
      let answer!: (value: unknown) => void
      request.mockReturnValue(new Promise(resolve => { answer = resolve }))
      const stopped = new AbortController()
      const leaving = loadExactMomentRecap(moment, stopped.signal)
      const staying = loadExactMomentRecap(moment, new AbortController().signal)
      stopped.abort()
      await expect(leaving).rejects.toMatchObject({ name: 'AbortError' })
      answer({ data: { login: 'supertf', streamId: 's1', topMoments: [selected] } })
      expect(await staying).toMatchObject({ label: 'Emote spike' })
      expect(request).toHaveBeenCalledTimes(1)
    })
    it('does not read for a caller that has already stopped', async () => {
      const stopped = new AbortController()
      stopped.abort()
      await expect(momentRecapLists(moment, stopped.signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(request).not.toHaveBeenCalled()
    })
  })
  describe('the exact row on an answer already read', () => {
    it('gives the label and top emotes of the one matching row', () => {
      expect(exactMomentRecapFrom(moment, { login: 'SuperTF', streamId: 's1', topMoments: [{ offsetSeconds: 1 }, selected] }))
        .toEqual({ label: 'Emote spike', topEmotes: [{ name: 'GTAB', count: 32, provider: 'seventv', imageUrl: selected.topEmotes[0].imageUrl }] })
      expect(exactMomentRecapFrom(moment, { login: 'supertf', streamId: 's1', topMoments: [{ offsetSeconds: 17058, reasons: ['chat_spike'] }] }))
        .toEqual({ label: 'Chat spike', topEmotes: [] })
    })
    it.each([
      [{ login: 'other', streamId: 's1', topMoments: [selected] }],
      [{ login: 'supertf', streamId: 'other', topMoments: [selected] }],
      [{ login: 'supertf', streamId: 's1', topMoments: [selected, selected] }],
      [{ login: 'supertf', streamId: 's1', topMoments: [] }],
      [{ login: 'supertf', streamId: 's1' }],
      [null],
      [undefined],
    ])('is null when the answer does not list exactly this moment once', data => {
      expect(exactMomentRecapFrom(moment, data)).toBeNull()
    })
    it('needs the public ID to match when the moment has one', () => {
      expect(exactMomentRecapFrom({ ...moment, publicMomentId: 'expected' }, { login: 'supertf', streamId: 's1', topMoments: [selected] })).toBeNull()
      expect(exactMomentRecapFrom({ ...moment, publicMomentId: 'expected' }, { login: 'supertf', streamId: 's1', topMoments: [{ ...selected, publicMomentId: 'expected' }] }))
        .toMatchObject({ label: 'Emote spike' })
    })
  })
})
