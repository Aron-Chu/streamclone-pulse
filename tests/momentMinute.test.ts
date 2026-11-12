import { describe, expect, it, vi } from 'vitest'
import { momentContextFromMinutes, momentMinutesAfterOffset } from '../src/shared/momentMinute.ts'
import { loadMomentMinute } from '../src/background/momentMinute.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { MESSAGE_SENDER_SCOPE, isSenderAuthorizedForMessage } from '../src/background/pulseBroadcastTargets.ts'

// Went live at 21:45:37, so each minute rollup's offset lands 23 s past a whole minute.
const STARTED_AT = '2026-10-18T21:45:37Z'
const STREAM_ID = '321911879770'
/** 01:04:44 falls in the 22:50 minute, whose rollup offset is 3863. */
const OFFSET = 3884
const rowAt = (relative: number, extra: Record<string, unknown> = {}) => ({ offsetSeconds: 3863 + relative * 60, chatCount: 500 + relative, ...extra })
const payload = (minutes: unknown[], extra: Record<string, unknown> = {}) => ({ streamId: STREAM_ID, channel: 'xqc', startedAt: STARTED_AT, minutes, updatedAt: 1, ...extra })
const around = (skip: (relative: number) => boolean = () => false) =>
  Array.from({ length: 21 }, (_, i) => i - 10).filter(relative => !skip(relative)).map(relative => rowAt(relative))
const shape = (data: unknown, offsetSeconds = OFFSET) => momentContextFromMinutes(data, { streamId: STREAM_ID, offsetSeconds }, { capturedAt: 1_000 })

describe('momentContextFromMinutes', () => {
  it('reads the moment’s own minute: chat, emotes, viewers and its emotes, most used first', () => {
    const minutes = around(relative => relative === 0)
    minutes.push(rowAt(0, {
      chatCount: 817, totalEmoteCount: 604, viewerAvg: 29411.6, viewerSamples: 4, viewerLatest: 30100,
      // `/minutes` sends these unsorted.
      topEmotes: [
        { name: 'forsenCD', provider: 'seventv', count: 47, imageUrl: 'https://cdn.7tv.app/emote/a/1x.webp' },
        { name: 'LOL', provider: 'twitch', count: 224 },
        { name: 'ZERO', provider: 'bttv', count: 0 },
        { name: 'LO', provider: 'ffz', count: 113 },
      ],
    }))
    const context = shape(payload(minutes))!
    expect(context).toMatchObject({ provenance: 'snapshot', capturedAt: 1_000, coverage: 'complete', windowLabel: '±10 min',
      selectedMessages: 817, selectedEmotes: 604, selectedViewers: 29412 })
    expect(context.topEmotes).toEqual([
      { name: 'LOL', count: 224, provider: 'Twitch' },
      { name: 'LO', count: 113, provider: 'FFZ' },
      { name: 'forsenCD', count: 47, provider: '7TV' },
    ])
    expect(context.samples).toHaveLength(21)
    expect(context.samples[10]).toEqual({ offsetSeconds: OFFSET, messages: 817 })
    expect(context.samples[0]).toEqual({ offsetSeconds: OFFSET - 600, messages: 490 })
    expect(context.samples[20]).toEqual({ offsetSeconds: OFFSET + 600, messages: 510 })
  })

  it('asks for whole minutes from just before the window', () => {
    expect(momentMinutesAfterOffset(OFFSET)).toBe(3180)
    expect(momentMinutesAfterOffset(120)).toBe(0)
  })

  it('keeps a missing or absent neighbour a gap, never zero, and calls the window partial', () => {
    const minutes = around(relative => relative === -3).map(row => row.offsetSeconds === 3863 + 120 ? { ...row, missing: true } : row)
    minutes.push(rowAt(4, { chatCount: undefined }))
    const context = shape(payload(minutes))!
    expect(context.coverage).toBe('partial')
    expect(context.samples[7].messages).toBeNull() // absent
    expect(context.samples[12].messages).toBeNull() // flagged missing
    expect(context.samples[14].messages).toBeNull() // the API omits a zero count
  })

  it('says nothing when the moment’s own minute is missing, absent or from another broadcast', () => {
    expect(shape(payload(around(relative => relative === 0)))).toBeNull()
    expect(shape(payload(around().map(row => row.offsetSeconds === 3863 ? { ...row, missing: true } : row)))).toBeNull()
    expect(shape(payload(around(), { streamId: '999' }))).toBeNull()
    expect(shape(payload(around(), { startedAt: 'yesterday' }))).toBeNull()
    expect(shape({ minutes: 'none' })).toBeNull()
    expect(shape(null)).toBeNull()
  })

  it('reports a minute without counts as not available rather than zero', () => {
    const context = shape(payload([rowAt(0, { chatCount: undefined })]))!
    expect(context).toMatchObject({ selectedMessages: null, selectedEmotes: null, selectedViewers: null, topEmotes: [] })
  })

  it('starts the strip at go-live and ends it at the newest minute', () => {
    // 00:02:00 is in the 21:47 minute (offset 83); the stream has 4 minutes so far.
    const minutes = [23, 83, 143].map((offsetSeconds, i) => ({ offsetSeconds, chatCount: 10 + i }))
    minutes.unshift({ offsetSeconds: 0, chatCount: 5 })
    const context = momentContextFromMinutes(payload(minutes), { streamId: STREAM_ID, offsetSeconds: 120 }, { capturedAt: 1 })!
    expect(context.selectedMessages).toBe(11)
    expect(context.samples.map(sample => sample.messages)).toEqual([5, 10, 11, 12])
    expect(context.coverage).toBe('complete')
  })

  it('maps offsets from a start with a fractional second onto their own minutes', () => {
    // From 21:45:00.5 the 21:46 rollup's truncated offset is 59, and a moment saved there has offset 59 too.
    const data = { streamId: STREAM_ID, startedAt: '2026-10-18T21:45:00.500Z', minutes: [{ offsetSeconds: 0, chatCount: 1 }, { offsetSeconds: 59, chatCount: 2 }, { offsetSeconds: 119, chatCount: 3 }] }
    expect(momentContextFromMinutes(data, { streamId: STREAM_ID, offsetSeconds: 59 }, { capturedAt: 1 })?.selectedMessages).toBe(2)
  })
})

describe('loadMomentMinute', () => {
  const minutesBody = () => JSON.stringify(payload([rowAt(0, { chatCount: 42, topEmotes: [{ name: 'KEKW', provider: '7tv', count: 3, imageUrl: 'https://cdn.7tv.app/emote/k/1x.webp' }] })]))

  it('reads the public minutes route by stream id and offset, with no credential', async () => {
    const fetchImpl = vi.fn(async () => new Response(minutesBody(), { status: 200, headers: { 'content-type': 'application/json' } }))
    const context = await loadMomentMinute(STREAM_ID, OFFSET, { root: async () => 'https://api.streampulse.stream', fetchImpl, now: () => 7 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.streampulse.stream/v1/portal/analytics/streams/${STREAM_ID}/minutes?afterOffset=3180`)
    expect(init.credentials).toBe('omit')
    expect(new Headers(init.headers).has('authorization')).toBe(false)
    expect(context).toMatchObject({ capturedAt: 7, selectedMessages: 42, topEmotes: [{ name: 'KEKW', provider: '7TV', staticImageUrl: 'https://cdn.7tv.app/emote/k/1x.webp' }] })
  })

  it('has no minute where the server has no route, and fails loudly on a server error', async () => {
    const answer = (status: number) => ({ root: async () => 'http://localhost:8081', fetchImpl: vi.fn(async () => new Response('{}', { status })), now: () => 1 })
    await expect(loadMomentMinute(STREAM_ID, OFFSET, answer(404))).resolves.toBeNull()
    await expect(loadMomentMinute(STREAM_ID, OFFSET, answer(503))).rejects.toThrow('minutes 503')
  })
})

describe('MOMENT_MINUTE request', () => {
  it('passes a numeric stream id and a whole-second offset, and nothing else', () => {
    expect(parseBackgroundRequest({ type: 'MOMENT_MINUTE', streamId: STREAM_ID, offsetSeconds: OFFSET, url: 'https://evil.test' }))
      .toEqual({ type: 'MOMENT_MINUTE', streamId: STREAM_ID, offsetSeconds: OFFSET })
    for (const bad of [{ streamId: '../hub', offsetSeconds: 1 }, { streamId: 123, offsetSeconds: 1 }, { streamId: STREAM_ID, offsetSeconds: -1 },
      { streamId: STREAM_ID, offsetSeconds: 1.5 }, { streamId: STREAM_ID, offsetSeconds: 8 * 86_400 }, { streamId: STREAM_ID }]) {
      expect(parseBackgroundRequest({ type: 'MOMENT_MINUTE', ...bad })).toBeNull()
    }
  })

  it('is for extension pages only, never a Twitch content script', () => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
    expect(MESSAGE_SENDER_SCOPE.MOMENT_MINUTE).toBe('extension-page')
    expect(isSenderAuthorizedForMessage('MOMENT_MINUTE', undefined, { id: extensionId, url: `chrome-extension://${extensionId}/options/index.html` }, extensionId)).toBe(true)
    expect(isSenderAuthorizedForMessage('MOMENT_MINUTE', 'xqc', { id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
  })
})
