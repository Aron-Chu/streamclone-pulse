import { beforeEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/momentsApiClient', () => ({ apiClient: request, getBackendUrl: () => 'https://api.streampulse.stream' }))
import { checkMomentSource, discoveryMomentHref, fromHubMoment, fromNewsroomUpdate, uniqueDiscoveryMoments } from '../src/lib/discoveryMoments'
import type { NewsroomStory, NewsroomUpdate } from '../src/lib/newsroom'
import portalTimingFixture from './fixtures/portal_vod_timing_v1.json'

const row = { login: 'creator', streamId: 'stream-a', publicMomentId: 'moment-a', offsetSeconds: 120, label: 'Chat spike', at: 1788000000000, vodId: '12345' }
describe('discovery identity and source actions', () => {
  it('preserves approved CDN imagery and retains UUID proxy fallback without inventing a provider ID', () => {
    const id = '12345678-1234-1234-1234-123456789abc'
    const imageUrl = 'https://cdn.7tv.app/emote/actual-provider-id/4x.webp'
    const topEmotes = [{ name: 'Known', id, provider: 'seventv', imageUrl }, { name: 'Local', id, provider: 'seventv' }]
    expect(fromHubMoment({ ...row, topEmotes })?.topEmotes).toEqual([
      topEmotes[0], { ...topEmotes[1], imageUrl: `https://api.streampulse.stream/emotes/${id}/1x.webp` },
    ])
  })
  it.each(['/emotes/25/1x.webp', 'https://evil.example/emote.webp'])('replaces rejected/proxy imagery with provider fallback: %s', imageUrl => {
    expect(fromHubMoment({ ...row, topEmotes: [{ name: 'Kappa', id: '25', provider: 'twitch', count: 7, imageUrl }] })?.topEmotes?.[0]).toMatchObject({
      name: 'Kappa', count: 7, imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
    })
  })
  beforeEach(() => request.mockReset())
  it('retains explicit archive offset zero for preview consumers', async () => {
    request.mockResolvedValue({ data: { channel: 'creator', stream: { streamId: 'stream-a', vodId: '77777' }, vodTiming: { state: 'verified' }, vodAlignSeconds: -120, vodDurationSeconds: 1000 } })
    const result = await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)
    expect(result.vodOffsetSeconds).toBe(0)
    expect(result.vodHref).toBe('https://www.twitch.tv/videos/77777?t=0s')
  })
  it('exposes archive artwork only after exact source and timing verification', async () => {
    const artwork = { vodId: '123456', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/archive/thumb/test.jpg' }
    const data = { channel: 'creator', stream: { streamId: 'stream-a' }, vodId: '123456', vodAlignSeconds: 0, vodDurationSeconds: 1000, vodTiming: { state: 'verified' }, vodArtwork: artwork }
    request.mockResolvedValue({ data })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).archiveArtwork).toEqual(artwork)
    request.mockResolvedValue({ data: { ...data, vodTiming: { state: 'unavailable' } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).archiveArtwork).toBeUndefined()
    request.mockResolvedValue({ data: { ...data, stream: { streamId: 'wrong' } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).archiveArtwork).toBeUndefined()
  })
  it('rejects missing immutable identity and invalid offsets', () => {
    expect(fromHubMoment({ ...row, streamId: undefined })).toBeNull()
    expect(fromHubMoment({ ...row, offsetSeconds: -1 })).toBeNull()
    expect(fromHubMoment({ ...row, login: 'javascript:alert(1)' })).toBeNull()
  })
  it('carries only verified hub archive artwork as display metadata', () => {
    const artwork = { vodId: '123456', kind: 'archive_thumbnail' as const, url: 'https://static-cdn.jtvnw.net/cf_vods/archive/thumb/test.jpg' }
    expect(fromHubMoment({ ...row, vodId: undefined, archiveArtwork: artwork })?.archiveArtwork).toEqual(artwork)
    expect(fromHubMoment({ ...row, vodId: '', archiveArtwork: artwork })?.archiveArtwork).toEqual(artwork)
    expect(fromHubMoment({ ...row, vodId: '123456', archiveArtwork: artwork })?.archiveArtwork).toEqual(artwork)
    expect(fromHubMoment({ ...row, archiveArtwork: { ...artwork, vodId: 'short' } })?.archiveArtwork).toBeUndefined()
    for (const vodId of ['654321', '12345', 'malformed']) {
      expect(fromHubMoment({ ...row, vodId, archiveArtwork: artwork })?.archiveArtwork).toBeUndefined()
    }
  })
  it('propagates already-normalized category display metadata without changing identity', () => {
    const boxArtUrl = 'https://static-cdn.jtvnw.net/ttv-boxart/213490846-210x280.jpg'
    const moment = fromHubMoment({ ...row, category: 'Wuthering Waves', categoryId: '213490846', boxArtUrl })
    expect(moment).toMatchObject({
      key: JSON.stringify(['creator', 'stream-a', 120]),
      category: 'Wuthering Waves',
      categoryId: '213490846',
      boxArtUrl,
    })
  })
  it('keeps distinct nearby events and replaces only exact identities', () => {
    const a = fromHubMoment(row)!, b = fromHubMoment({ ...row, offsetSeconds: 180, publicMomentId: 'moment-b' })!
    expect(uniqueDiscoveryMoments([a, b, { ...a, label: 'Corrected' }])).toHaveLength(2)
    expect(uniqueDiscoveryMoments([a, { ...a, label: 'Corrected' }])[0].label).toBe('Corrected')
    expect(discoveryMomentHref(b)).toContain('offset=180')
  })
  it('preserves the selected update candidate for verification, never the story lead VOD', () => {
    const update = { headline: 'Second', momentRef: { publicMomentId: 'second', streamId: 'stream-a', occurrenceAt: row.at, offsetSeconds: 360 }, comparison: { chat: {}, emotes: {} }, topEmotes: [], vodId: '67890' } as unknown as NewsroomUpdate
    const story = { id: 'story-a', login: 'creator', streamId: 'stream-a', leadUpdate: { ...update, vodId: '11111' } } as NewsroomStory
    const selected = fromNewsroomUpdate(story, update)!
    expect(selected.vodId).toBe('67890')
    expect(discoveryMomentHref(selected)).toContain('offset=360')
    expect(fromNewsroomUpdate(story, { ...update, momentRef: { ...update.momentRef, streamId: 'other' } })).toBeNull()
    expect(fromHubMoment({ ...row, vodId: 'evil/path' })!.vodId).toBeUndefined()
  })
  it('never borrows a story-level category for an occurrence', () => {
    const update = { headline: 'Second', momentRef: { publicMomentId: 'second', streamId: 'stream-a', occurrenceAt: row.at, offsetSeconds: 360 },
      comparison: { chat: {}, emotes: {} }, topEmotes: [] } as unknown as NewsroomUpdate
    const story = { id: 'story-a', login: 'creator', streamId: 'stream-a', category: 'Current story category' } as NewsroomStory
    expect(fromNewsroomUpdate(story, update)?.category).toBeUndefined()
    const exact = { ...update, category: 'VALORANT', categoryId: '516575',
      boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/516575-144x192.jpg', categorySource: 'measured_segment' as const }
    expect(fromNewsroomUpdate(story, exact)).toMatchObject({ category: 'VALORANT', categoryId: '516575',
      boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/516575-144x192.jpg' })
  })
  it('fails closed on stale stream aliases, independent of an old saved VOD', async () => {
    request.mockResolvedValue({ data: { channel: 'creator', stream: { streamId: 'other', vodId: '22222' } } })
    const result = await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)
    expect(result.vodHref).toBeNull(); expect(result.liveHref).toBeNull()
  })
  it('checks exact source mapping and only freshly confirmed live presence', async () => {
    request.mockResolvedValue({ data: { channel: 'creator', vodTiming: { state: 'verified' }, vodDurationSeconds: 600, vodAlignSeconds: 0, stream: { streamId: 'stream-a', vodId: '77777', lifecycleState: 'confirmed_live', lifecycleObservedAt: new Date().toISOString() } } })
    const result = await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)
    expect(result.vodHref).toBe('https://www.twitch.tv/videos/77777?t=120s')
    expect(result.liveHref).toBe('https://www.twitch.tv/creator')
    request.mockResolvedValue({ data: { channel: 'creator', vodTiming: { state: 'verified' }, vodDurationSeconds: 600, vodAlignSeconds: 13, stream: { streamId: 'stream-a', vodId: '77777', lifecycleState: 'confirmed_live', lifecycleObservedAt: '2020-01-01' } } })
    const unavailable = await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)
    expect(unavailable.vodHref).toBe('https://www.twitch.tv/videos/77777?t=133s'); expect(unavailable.liveHref).toBeNull()
  })
  it('requests and accepts handoff eligibility only for an explicit exact-moment refresh', async () => {
    request.mockResolvedValue({ data: { channel: 'creator', handoffRef: 'cr_Y2NfYWJj', vodTiming: { state: 'verified' }, vodDurationSeconds: 600, vodAlignSeconds: 0,
      stream: { streamId: 'stream-a', vodId: '77777' } } })
    const moment = fromHubMoment(row)!
    const ordinary = await checkMomentSource(moment, new AbortController().signal)
    expect(request).toHaveBeenLastCalledWith('/v1/portal/analytics/streams/stream-a', expect.anything())
    expect(ordinary.handoffRef).toBeUndefined()
    const refreshed = await checkMomentSource(moment, new AbortController().signal, true)
    expect(request).toHaveBeenLastCalledWith('/v1/portal/analytics/streams/stream-a?momentOffsetSeconds=120', expect.objectContaining({ cache: 'no-store' }))
    expect(refreshed.handoffRef).toBe('cr_Y2NfYWJj')
    request.mockResolvedValue({ data: { channel: 'creator', handoffRef: 'cr_Y2NfYWJj', stream: { streamId: 'stream-a', vodId: '77777' } } })
    expect((await checkMomentSource(moment, new AbortController().signal, true)).handoffRef).toBeUndefined()
  })
  it.each([undefined, null, NaN, Infinity])('does not guess absent or invalid alignment %s', async alignment => {
    request.mockResolvedValue({ data: { channel: 'creator', vodAlignSeconds: alignment, stream: { streamId: 'stream-a', vodId: '77777' } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).vodHref).toBeNull()
  })
  it('accepts an availability-owned archive only with verified alignment', async () => {
    request.mockResolvedValue({ data: { channel: 'creator', vodTiming: { state: 'verified' }, vodDurationSeconds: 600, vodAlignSeconds: 5, stream: { streamId: 'stream-a' }, availability: { vodId: '77777', vodState: 'linked' } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).vodHref).toBe('https://www.twitch.tv/videos/77777?t=125s')
  })
  it.each([360, 5183, 17058])('maps each selected offset %s with signed, sub-minute archive alignment', async offsetSeconds => {
    request.mockResolvedValue({ data: { channel: 'creator', vodAlignSeconds: -75.5, vodDurationSeconds: 18000,
      vodTiming: { state: 'verified', source: 'helix_archive_origin' }, stream: { streamId: 'stream-a', vodId: '77777' } } })
    const result = await checkMomentSource(fromHubMoment({ ...row, offsetSeconds })!, new AbortController().signal)
    expect(result.vodHref).toBe(`https://www.twitch.tv/videos/77777?t=${Math.floor(offsetSeconds - 75.5)}s`)
  })
  it('consumes the same serialized timing contract verified by the Go backend', async () => {
    request.mockResolvedValue({ data: portalTimingFixture })
    for (const offsetSeconds of [360, 5183, 17058]) {
      const moment = fromHubMoment({ ...row, login: portalTimingFixture.channel, streamId: portalTimingFixture.stream.streamId, offsetSeconds })!
      const result = await checkMomentSource(moment, new AbortController().signal)
      expect(result.vodHref).toBe(`https://www.twitch.tv/videos/2864434763?t=${Math.floor(offsetSeconds - 75.5)}s`)
    }
  })
  it.each([[-121, 600], [0, 120], [0, 119]])('does not substitute an archive boundary for an out-of-range moment (%s, %s)', async (alignment, duration) => {
    request.mockResolvedValue({ data: { channel: 'creator', vodTiming: { state: 'verified' }, vodAlignSeconds: alignment, vodDurationSeconds: duration,
      stream: { streamId: 'stream-a', vodId: '77777' } } })
    const result = await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)
    expect(result.vodHref).toBeNull()
    expect(result.vodOffsetSeconds).toBeUndefined()
    expect(result.reason).toContain('outside the archive')
  })
  it.each([undefined, 0, -1, NaN, Infinity, null])('rejects missing or invalid archive duration %s', async duration => {
    request.mockResolvedValue({ data: { channel: 'creator', vodAlignSeconds: 0, vodDurationSeconds: duration,
      stream: { streamId: 'stream-a', vodId: '77777' } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).vodHref).toBeNull()
  })
  it.each([{ vodAlignSeconds: 21601 }, { vodAlignSeconds: 0, vodTiming: { state: 'unavailable' } }])('fails closed on contradictory or implausible timing %s', async timing => {
    request.mockResolvedValue({ data: { channel: 'creator', ...timing, stream: { streamId: 'stream-a', vodId: '77777' } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).vodHref).toBeNull()
  })
  it('requires explicit verification, even with a plausible archive clock', async () => {
    request.mockResolvedValue({ data: { channel: 'creator', vodAlignSeconds: 0, vodDurationSeconds: 600,
      stream: { streamId: 'stream-a', vodId: '77777' } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).vodHref).toBeNull()
  })
  it('rejects disagreement between channel and stream login', async () => {
    request.mockResolvedValue({ data: { channel: 'creator', vodTiming: { state: 'verified' },
      vodAlignSeconds: 0, vodDurationSeconds: 600,
      stream: { streamId: 'stream-a', login: 'other', vodId: '77777' } } })
    const result = await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)
    expect(result.vodHref).toBeNull()
    expect(result.liveHref).toBeNull()
    expect(result.reason).toContain('identity could not be confirmed')
  })
  it.each(['88888', 'invalid/id'])('rejects contradictory archive IDs: %s', async conflictingId => {
    request.mockResolvedValue({ data: { channel: 'creator', vodTiming: { state: 'verified' },
      vodAlignSeconds: 0, vodDurationSeconds: 600, vodId: conflictingId,
      stream: { streamId: 'stream-a', vodId: '77777' } } })
    const result = await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)
    expect(result.vodHref).toBeNull()
    expect(result.reason).toContain('conflicting archive identities')
  })
  it('explains archive publication separately from unknown source identity', async () => {
    request.mockResolvedValue({ data: { channel: 'creator', stream: { streamId: 'stream-a' }, availability: { vodState: 'pending_live' } } })
    const result = await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)
    expect(result.vodHref).toBeNull()
    expect(result.reason).toContain('waiting for this broadcast’s archive')
    expect(result.liveHref).toBeNull()
  })
  it.each(['1970-01-01T00:00:00Z', '2100-01-01T00:00:00Z', 'invalid'])('rejects implausible occurrence base %s', async startedAt => {
    request.mockResolvedValue({ data: { channel: 'creator', stream: { streamId: 'stream-a', startedAt } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).occurrenceAt).toBeUndefined()
  })
  it('derives occurrence only from the exact confirmed stream start and offset', async () => {
    const startedAt = new Date(Date.now() - 300_000).toISOString()
    request.mockResolvedValue({ data: { channel: 'creator', stream: { streamId: 'stream-a', startedAt } } })
    expect((await checkMomentSource(fromHubMoment(row)!, new AbortController().signal)).occurrenceAt).toBe(Date.parse(startedAt) + 120_000)
  })
})
