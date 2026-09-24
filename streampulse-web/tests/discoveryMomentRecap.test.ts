import { beforeEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: request }))
import { loadExactMomentRecap } from '../src/lib/discoveryMomentRecap'
import { fromHubMoment } from '../src/lib/discoveryMoments'

const moment = fromHubMoment({ login: 'supertf', streamId: 's1', offsetSeconds: 17058, label: 'Selected reaction' })!
const selected = { offsetSeconds: 17058, reasons: ['twitch_emote_spike'], chatCount: 215,
  topEmotes: [{ code: 'GTAB', count: 32, provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/example/4x.webp' }] }
describe('selected recap hydration', () => {
  beforeEach(() => request.mockReset())
  it('loads the exact third detection, preserves imagery and never converts recap counts into minute rates', async () => {
    request.mockResolvedValue({ data: { login: 'supertf', streamId: 's1', topMoments: [{ offsetSeconds: 1 }, { offsetSeconds: 17000 }, selected] } })
    const signal = new AbortController().signal
    const result = await loadExactMomentRecap(moment, signal)
    expect(result).toEqual({ label: 'Emote spike', topEmotes: [{ name: 'GTAB', count: 32, provider: 'seventv', imageUrl: selected.topEmotes[0].imageUrl }] })
    expect(request).toHaveBeenCalledWith('/v1/portal/analytics/streams/s1/recap', expect.objectContaining({ signal, maxResponseBytes: 524288 }))
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
})
