import { beforeEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/momentsApiClient', () => ({ apiClient: request, getBackendUrl: () => 'https://api.streampulse.stream' }))
import { loadExactMomentRecap, mergeMomentTopEmotes, momentNeedsExactRecap } from '../src/lib/discoveryMomentRecap'
import { fromHubMoment } from '../src/lib/discoveryMoments'

const moment = fromHubMoment({ login: 'supertf', streamId: 's1', offsetSeconds: 17058, label: 'Selected reaction' })!
const selected = { offsetSeconds: 17058, reasons: ['twitch_emote_spike'], chatCount: 999, emoteCount: 998, chatPerMin: 215, emotesPerMin: 412,
  topEmotes: [{ code: 'GTAB', count: 32, provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/example/4x.webp' }] }
describe('selected recap hydration', () => {
  it('uses only matched safe enrichment without changing supplied counts or fetch eligibility', () => {
    const supplied = [{ name: 'Wide', count: 8, imageUrl: '/emotes/uuid/1x.webp' }, { name: 'Unmatched', count: 3 }]
    const url = 'https://cdn.7tv.app/emote/example/4x.webp'
    expect(mergeMomentTopEmotes(supplied, [{ name: 'Wide', count: 99, imageUrl: url }, { name: 'Other', imageUrl: url }])).toEqual([
      { ...supplied[0], imageUrl: url }, supplied[1],
    ])
    expect(momentNeedsExactRecap({ ...moment, chatPerMin: 1, emotesPerMin: 1, topEmotes: [supplied[0]] })).toBe(false)
  })
  it('replaces recap proxy URLs with an existing provider-derived URL', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ ...selected, topEmotes: [{ code: 'Kappa', id: '25', provider: 'twitch', imageUrl: '/emotes/25/1x.webp' }] }] } })
    expect((await loadExactMomentRecap(moment, new AbortController().signal))?.topEmotes?.[0].imageUrl).toBe('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0')
  })
  beforeEach(() => request.mockReset())
  it('loads the exact third detection, preserves imagery and consumes only explicitly named minute rates', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ offsetSeconds: 1 }, { offsetSeconds: 17000 }, selected] } })
    const signal = new AbortController().signal
    const result = await loadExactMomentRecap(moment, signal)
    expect(result).toEqual({ label: 'Emote spike', chatPerMin: 215, emotesPerMin: 412,
      topEmotes: [{ name: 'GTAB', count: 32, provider: 'seventv', imageUrl: selected.topEmotes[0].imageUrl }] })
    expect(request).toHaveBeenCalledWith('/v1/portal/analytics/streams/s1/recap', expect.objectContaining({ signal, maxResponseBytes: 524288 }))
  })
  it('does not relabel legacy count fields as rates', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ ...selected, chatPerMin: undefined, emotesPerMin: undefined }] } })
    const result = await loadExactMomentRecap(moment, new AbortController().signal)
    expect(result).not.toHaveProperty('chatPerMin')
    expect(result).not.toHaveProperty('emotesPerMin')
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
  it('uses one exact stream offset when the older recap projection omits a public ID', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [selected] } })
    expect(await loadExactMomentRecap({ ...moment, publicMomentId: 'expected' }, new AbortController().signal)).toMatchObject({ label: 'Emote spike' })
  })
  it('rejects a conflicting supplied public ID and ambiguous ID-less offsets', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ ...selected, publicMomentId: 'different' }] } })
    expect(await loadExactMomentRecap({ ...moment, publicMomentId: 'expected' }, new AbortController().signal)).toBeNull()
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [selected, { ...selected }] } })
    expect(await loadExactMomentRecap({ ...moment, publicMomentId: 'expected' }, new AbortController().signal)).toBeNull()
  })
  it('recognizes the backend 7TV reaction reason in an exact selected recap', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ ...selected, reasons: ['seventv_spike'] }] } })
    expect(await loadExactMomentRecap(moment, new AbortController().signal)).toMatchObject({ label: 'Emote spike' })
  })
})
