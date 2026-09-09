import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fromHubMoment } from '../src/lib/discoveryMoments'
import { parseSavedMoments, savedMomentRecord } from '../src/lib/savedDiscoveryMoments'
const comparison = {
  baselineKind: 'current_stream_measured_average_before_event' as const, eventAt: 1_800_000_000_000,
  baselineWindow: { start: 1_799_999_400_000, end: 1_799_999_999_999, expectedMinutes: 10, measuredMinutes: 9, coveragePct: 90 },
  chat: { state: 'ready' as const, currentPerMin: 220, baselinePerMin: 100, multiplier: 2.2, currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 9, baselineExpectedMinutes: 10, baselineCoveragePct: 90 },
  emotes: { state: 'ready' as const, currentPerMin: 80, baselinePerMin: 20, multiplier: 4, currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 9, baselineExpectedMinutes: 10, baselineCoveragePct: 90 },
  evidence: { ircBound: true, eventRollupAvailable: true, baselineMeasuredMinutes: 9, baselineExpectedMinutes: 10, baselineCoveragePct: 90 },
}
const moment = fromHubMoment({ login: 'creator', streamId: 'stream-a', offsetSeconds: 10, label: 'Moment', vodId: '12345', handoffRef: 'cr_secret', profileImageUrl: 'https://example.com/secret',
  at: 1_800_000_000_000, category: 'Wuthering Waves', categoryId: '213490846', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/213490846-144x192.jpg',
  kind: 'emote_spike', chatPerMin: 220, emotesPerMin: 80, comparison,
  topEmotes: [{ name: 'LOL', provider: 'seventv', count: 70, imageUrl: 'https://cdn.7tv.app/emote/private/4x.webp' }] })!
describe('device shortlist', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('retains the measurement scope and publication time through a saved reload', () => {
    const saved = savedMomentRecord({ ...moment, evidenceAsOf: '2026-09-08T17:01:00Z' })
    const parsed = parseSavedMoments(JSON.stringify({ version: 2, items: [saved] }))[0]!
    expect(parsed).toMatchObject({ measurementScope: 'verified_minute', evidenceAsOf: '2026-09-08T17:01:00.000Z', chatPerMin: 220, emotesPerMin: 80 })
  })
  it('does not silently replace saved detector rates with comparison rates on reload', () => {
    const saved = savedMomentRecord({ ...moment, chatPerMin: 355, emotesPerMin: 2570, measurementScope: 'detector_snapshot' })
    const parsed = parseSavedMoments(JSON.stringify({ version: 2, items: [saved] }))[0]!
    expect(parsed).toMatchObject({ chatPerMin: 355, emotesPerMin: 2570, measurementScope: 'detector_snapshot' })
  })
  it('does not infer missing scope or retain unsupported verification and snapshot claims', () => {
    const saved = savedMomentRecord(moment)
    for (const measurementScope of [undefined, 'unknown', 'verified_minute']) {
      const parsed = parseSavedMoments(JSON.stringify({ version: 2, items: [{ ...saved, chatPerMin: 355,
        measurementScope, evidenceAsOf: 'invalid-date' }] }))[0]!
      expect(parsed.chatPerMin).toBe(355)
      expect(parsed).not.toHaveProperty('measurementScope')
      expect(parsed).not.toHaveProperty('evidenceAsOf')
    }
  })
  it('persists bounded public evidence and strips source, media and authorization data on read', () => {
    const saved = savedMomentRecord(moment)
    expect(saved).not.toHaveProperty('vodId'); expect(saved).not.toHaveProperty('handoffRef'); expect(saved).not.toHaveProperty('profileImageUrl')
    expect(saved).not.toHaveProperty('categoryId'); expect(saved).not.toHaveProperty('boxArtUrl')
    expect(saved).toMatchObject({ chatPerMin: 220, emotesPerMin: 80, reactionSignal: 'emotes', comparison })
    expect(saved.topEmotes).toEqual([{ name: 'LOL', provider: 'seventv', count: 70 }])
    const parsed = parseSavedMoments(JSON.stringify({ version: 2, items: [{ ...saved, vodId: '111', handoffRef: 'cr_bad', profileImageUrl: 'https://example.com/leak',
      categoryId: '213490846', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/213490846-144x192.jpg', topEmotes: [{ ...saved.topEmotes![0], imageUrl: 'https://example.com/leak' }] }] }))
    expect(parsed[0]).not.toHaveProperty('vodId'); expect(parsed[0]).not.toHaveProperty('handoffRef')
    expect(parsed[0]).not.toHaveProperty('categoryId'); expect(parsed[0]).not.toHaveProperty('boxArtUrl')
    expect(parsed[0]).not.toHaveProperty('profileImageUrl'); expect(parsed[0]?.topEmotes?.[0]).not.toHaveProperty('imageUrl')
    expect(parsed[0]).toMatchObject({ chatPerMin: 220, emotesPerMin: 80, reactionSignal: 'emotes' })
  })
  it('migrates a v1 identity snapshot without inventing missing evidence', () => {
    const legacy = { ...savedMomentRecord(moment) } as Record<string, unknown>
    delete legacy.chatPerMin; delete legacy.emotesPerMin; delete legacy.comparison; delete legacy.reactionSignal; delete legacy.topEmotes
    expect(parseSavedMoments(JSON.stringify({ version: 1, items: [legacy] }))[0]).toMatchObject({ login: 'creator', streamId: 'stream-a', offsetSeconds: 10 })
    expect(parseSavedMoments(JSON.stringify({ version: 1, items: [legacy] }))[0]).not.toHaveProperty('chatPerMin')
  })
  it('moves the legacy key to a v2 envelope on the next store initialization', async () => {
    const legacy = { ...savedMomentRecord(moment) } as Record<string, unknown>
    delete legacy.chatPerMin; delete legacy.emotesPerMin; delete legacy.comparison; delete legacy.reactionSignal; delete legacy.topEmotes
    localStorage.setItem('streampulse.saved-moments.v1', JSON.stringify({ version: 1, items: [legacy] }))
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    store.toggleSavedMoment(fromHubMoment({ ...moment, offsetSeconds: 20 })!)
    const envelope = JSON.parse(localStorage.getItem(store.SAVED_MOMENTS_KEY)!)
    expect(envelope.version).toBe(2)
    expect(envelope.items).toHaveLength(2)
    expect(localStorage.getItem(store.LEGACY_SAVED_MOMENTS_KEY)).not.toBeNull()
  })
  it('keeps readable legacy saves in session when the v2 migration write is denied', async () => {
    const legacy = { ...savedMomentRecord(moment) } as Record<string, unknown>
    delete legacy.chatPerMin; delete legacy.emotesPerMin; delete legacy.comparison; delete legacy.reactionSignal; delete legacy.topEmotes
    localStorage.setItem('streampulse.saved-moments.v1', JSON.stringify({ version: 1, items: [legacy] }))
    vi.resetModules()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'QuotaExceededError') })
    const store = await import('../src/lib/savedDiscoveryMoments')

    expect(store.toggleSavedMoment(moment)).toContain('Removed')
    expect(localStorage.getItem(store.LEGACY_SAVED_MOMENTS_KEY)).not.toBeNull()
    expect(localStorage.getItem(store.SAVED_MOMENTS_KEY)).toBeNull()
  })
  it('refreshes a sparse saved row without persisting source capabilities', async () => {
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    const sparse = fromHubMoment({ login: moment.login, streamId: moment.streamId, offsetSeconds: moment.offsetSeconds, label: moment.label })!
    store.toggleSavedMoment(sparse)
    expect(store.refreshSavedMoment(moment)).toBe(true)
    const refreshed = store.parseSavedMoments(localStorage.getItem(store.SAVED_MOMENTS_KEY))[0]!
    expect(refreshed).toMatchObject({ chatPerMin: 220, emotesPerMin: 80, at: 1_800_000_000_000 })
    expect(refreshed).not.toHaveProperty('vodId')
    expect(refreshed).not.toHaveProperty('handoffRef')
  })
  it('rejects malformed and oversized persisted data', () => {
    expect(() => parseSavedMoments('{')).toThrow()
    expect(() => parseSavedMoments(JSON.stringify({ version: 3, items: [] }))).toThrow()
    expect(() => parseSavedMoments(JSON.stringify({ version: 1, items: [{ ...savedMomentRecord(moment), offsetSeconds: -1 }] }))).toThrow()
  })
  it('caps at 200 without eviction and allows removal then adding', async () => {
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    const at = (offsetSeconds: number) => fromHubMoment({ ...moment, offsetSeconds })!
    for (let i = 0; i < 200; i++) store.toggleSavedMoment(at(i))
    expect(store.toggleSavedMoment(at(201))).toContain('200 saved moments reached')
    expect(JSON.parse(localStorage.getItem(store.SAVED_MOMENTS_KEY)!).items).toHaveLength(200)
    expect(store.toggleSavedMoment(at(0))).toContain('Removed')
    expect(store.toggleSavedMoment(at(201))).toContain('Saved on this device')
  })
  it('falls back to session saves without overwriting unreadable stored data', async () => {
    localStorage.setItem('streampulse.saved-moments.v2', 'broken')
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    expect(store.toggleSavedMoment(moment)).toContain('session only')
    expect(localStorage.getItem(store.SAVED_MOMENTS_KEY)).toBe('broken')
    expect(store.toggleSavedMoment(moment)).toContain('Removed')
  })
  it('handles quota denial as a session-only save', async () => {
    vi.resetModules()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'QuotaExceededError') })
    const store = await import('../src/lib/savedDiscoveryMoments')
    expect(store.toggleSavedMoment(moment)).toContain('session only')
    expect(store.toggleSavedMoment(moment)).toContain('Removed')
  })
  it('reconciles another tab before saving and preserves newly corrupt data', async () => {
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    store.toggleSavedMoment(moment)
    const second = fromHubMoment({ ...moment, offsetSeconds: 20 })!
    localStorage.setItem(store.SAVED_MOMENTS_KEY, JSON.stringify({ version: 1, items: [savedMomentRecord(moment), savedMomentRecord(second)] }))
    const third = fromHubMoment({ ...moment, offsetSeconds: 30 })!
    store.toggleSavedMoment(third)
    expect(parseSavedMoments(localStorage.getItem(store.SAVED_MOMENTS_KEY))).toHaveLength(3)
    localStorage.setItem(store.SAVED_MOMENTS_KEY, 'new corruption')
    expect(store.toggleSavedMoment(fromHubMoment({ ...moment, offsetSeconds: 40 })!)).toContain('session only')
    expect(localStorage.getItem(store.SAVED_MOMENTS_KEY)).toBe('new corruption')
  })
})
