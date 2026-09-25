import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fromHubMoment } from '../src/lib/discoveryMoments'
import { parseSavedMoments, savedMomentRecord } from '../src/lib/savedDiscoveryMoments'
const moment = fromHubMoment({ login: 'creator', streamId: 'stream-a', offsetSeconds: 10, label: 'Moment', vodId: '12345', handoffRef: 'cr_secret', profileImageUrl: 'https://example.com/secret',
  category: 'Wuthering Waves', categoryId: '213490846', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/213490846-144x192.jpg' })!
const comparison = {
  baselineKind: 'current_stream_measured_average_before_event' as const, eventAt: 1_800_000_000_000,
  baselineWindow: { start: 1_799_999_400_000, end: 1_799_999_999_999, expectedMinutes: 10, measuredMinutes: 9, coveragePct: 90 },
  chat: { state: 'ready' as const, currentPerMin: 220, baselinePerMin: 100, multiplier: 2.2,
    currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 9, baselineExpectedMinutes: 10, baselineCoveragePct: 90 },
  emotes: { state: 'ready' as const, currentPerMin: 80, baselinePerMin: 20, multiplier: 4,
    currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 9, baselineExpectedMinutes: 10, baselineCoveragePct: 90 },
  evidence: { ircBound: true, eventRollupAvailable: true, baselineMeasuredMinutes: 9, baselineExpectedMinutes: 10, baselineCoveragePct: 90 },
}
describe('device shortlist', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('persists public identity only and strips source/authorization data on read', () => {
    const saved = savedMomentRecord(moment)
    expect(saved).not.toHaveProperty('vodId'); expect(saved).not.toHaveProperty('handoffRef'); expect(saved).not.toHaveProperty('profileImageUrl')
    expect(saved).not.toHaveProperty('categoryId'); expect(saved).not.toHaveProperty('boxArtUrl')
    const parsed = parseSavedMoments(JSON.stringify({ version: 1, items: [{ ...saved, vodId: '111', handoffRef: 'cr_bad', categoryId: '213490846', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/213490846-144x192.jpg' }] }))
    expect(parsed[0]).not.toHaveProperty('vodId'); expect(parsed[0]).not.toHaveProperty('handoffRef')
    expect(parsed[0]).not.toHaveProperty('categoryId'); expect(parsed[0]).not.toHaveProperty('boxArtUrl')
  })
  it('bounds story IDs before writing and when loading older records', () => {
    expect(savedMomentRecord({ ...moment, storyId: 'story-1' }).storyId).toBe('story-1')
    expect(savedMomentRecord({ ...moment, storyId: 'x'.repeat(221) })).not.toHaveProperty('storyId')
    const forged = { ...savedMomentRecord(moment), storyId: 'x'.repeat(221) }
    expect(parseSavedMoments(JSON.stringify({ version: 2, items: [forged] }))[0]).not.toHaveProperty('storyId')
  })
  it('rejects malformed and oversized persisted data', () => {
    expect(() => parseSavedMoments('{')).toThrow()
    expect(() => parseSavedMoments(JSON.stringify({ version: 3, items: [] }))).toThrow()
    expect(() => parseSavedMoments(JSON.stringify({ version: 1, items: [{ ...savedMomentRecord(moment), offsetSeconds: -1 }] }))).toThrow()
  })
  it('stores bounded notes and preserves them when reading saved identities', async () => {
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    store.toggleSavedMoment(moment)
    expect(store.updateSavedMomentNote(moment.key, 'Watch the lead-in')).toContain('Note saved')
    expect(store.parseSavedMoments(localStorage.getItem(store.SAVED_MOMENTS_KEY))[0]?.note).toBe('Watch the lead-in')
    store.updateSavedMomentNote(moment.key, 'x'.repeat(2000))
    expect(store.parseSavedMoments(localStorage.getItem(store.SAVED_MOMENTS_KEY))[0]?.note).toHaveLength(1000)
    store.toggleSavedMoment(moment)
    expect(store.updateSavedMomentNote(moment.key, 'Do not recreate')).toContain('no longer saved')
    expect(store.parseSavedMoments(localStorage.getItem(store.SAVED_MOMENTS_KEY))).toEqual([])
  })
  it('merges v2-only saves with candidate v1 saves without downgrading measured evidence or notes', async () => {
    const rich = { ...fromHubMoment({ ...moment, at: 1_800_000_000_000, chatPerMin: 220, emotesPerMin: 80,
      kind: 'emote_spike', comparison, topEmotes: [{ name: 'LOL', provider: 'seventv', count: 70,
        imageUrl: 'https://example.com/private.webp' }] })!, evidenceAsOf: '2026-09-08T17:01:00Z' }
    const v2Only = fromHubMoment({ ...moment, offsetSeconds: 20, label: 'Only in v2', chatPerMin: 180 })!
    const v1Only = fromHubMoment({ ...moment, offsetSeconds: 30, label: 'Only in v1' })!
    localStorage.setItem('streampulse.saved-moments.v2', JSON.stringify({ version: 2,
      items: [savedMomentRecord(rich), savedMomentRecord(v2Only)] }))
    localStorage.setItem('streampulse.saved-moments.v1', JSON.stringify({ version: 1,
      items: [{ ...savedMomentRecord(rich), note: 'Review this spike' }, { ...savedMomentRecord(v1Only), note: 'Local note' }] }))
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    store.toggleSavedMoment(fromHubMoment({ ...moment, offsetSeconds: 40 })!)
    const raw = localStorage.getItem(store.SAVED_MOMENTS_KEY)!
    const envelope = JSON.parse(raw)
    const saved = store.parseSavedMoments(raw)
    expect(envelope).toMatchObject({ version: 2, legacyMerged: true })
    expect(saved.map(item => item.key)).toEqual(expect.arrayContaining([rich.key, v2Only.key, v1Only.key]))
    expect(saved).toHaveLength(4)
    expect(saved.find(item => item.key === rich.key)).toMatchObject({ chatPerMin: 220, emotesPerMin: 80,
      measurementScope: 'verified_minute', evidenceAsOf: '2026-09-08T17:01:00.000Z',
      comparison: { chat: { currentPerMin: 220 } }, reactionSignal: 'emotes', note: 'Review this spike',
      topEmotes: [{ name: 'LOL', provider: 'seventv', count: 70 }] })
    expect(saved.find(item => item.key === v1Only.key)?.note).toBe('Local note')
    expect(raw).not.toContain('private.webp')
    expect(localStorage.getItem(store.LEGACY_SAVED_MOMENTS_KEY)).not.toBeNull()

    store.toggleSavedMoment(rich)
    vi.resetModules()
    const reloaded = await import('../src/lib/savedDiscoveryMoments')
    reloaded.toggleSavedMoment(fromHubMoment({ ...moment, offsetSeconds: 50 })!)
    expect(reloaded.parseSavedMoments(localStorage.getItem(reloaded.SAVED_MOMENTS_KEY)).some(item => item.key === rich.key)).toBe(false)
  })
  it('keeps the readable v2 list available without overwriting an unreadable v1 list', async () => {
    const v2Only = fromHubMoment({ ...moment, offsetSeconds: 20, label: 'Only in v2' })!
    const v2Raw = JSON.stringify({ version: 2, items: [savedMomentRecord(v2Only)] })
    localStorage.setItem('streampulse.saved-moments.v2', v2Raw)
    localStorage.setItem('streampulse.saved-moments.v1', 'broken')
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    expect(store.toggleSavedMoment(v2Only)).toContain('Removed')
    expect(localStorage.getItem(store.SAVED_MOMENTS_KEY)).toBe(v2Raw)
    expect(localStorage.getItem(store.LEGACY_SAVED_MOMENTS_KEY)).toBe('broken')
  })
  it('shows a readable v1 backup for this session when v2 is corrupt', async () => {
    const legacyRaw = JSON.stringify({ version: 1, items: [{ ...savedMomentRecord(moment), note: 'Keep this note' }] })
    localStorage.setItem('streampulse.saved-moments.v2', 'broken')
    localStorage.setItem('streampulse.saved-moments.v1', legacyRaw)
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    expect(store.updateSavedMomentNote(moment.key, 'Still here')).toContain('session only')
    expect(store.toggleSavedMoment(moment)).toContain('Removed')
    expect(store.toggleSavedMoment(moment)).toContain('session only')
    expect(localStorage.getItem(store.SAVED_MOMENTS_KEY)).toBe('broken')
    expect(localStorage.getItem(store.LEGACY_SAVED_MOMENTS_KEY)).toBe(legacyRaw)
  })
  it('shows the union for this session when the migration write is denied', async () => {
    const v2Only = fromHubMoment({ ...moment, offsetSeconds: 20 })!
    localStorage.setItem('streampulse.saved-moments.v2', JSON.stringify({ version: 2, items: [savedMomentRecord(v2Only)] }))
    localStorage.setItem('streampulse.saved-moments.v1', JSON.stringify({ version: 1, items: [savedMomentRecord(moment)] }))
    vi.resetModules()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'QuotaExceededError') })
    const store = await import('../src/lib/savedDiscoveryMoments')
    expect(store.toggleSavedMoment(v2Only)).toContain('Removed')
    expect(store.toggleSavedMoment(moment)).toContain('Removed')
    expect(JSON.parse(localStorage.getItem(store.SAVED_MOMENTS_KEY)!).items).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(store.LEGACY_SAVED_MOMENTS_KEY)!).items).toHaveLength(1)
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
    localStorage.setItem('streampulse.saved-moments.v1', 'broken')
    vi.resetModules()
    const store = await import('../src/lib/savedDiscoveryMoments')
    expect(store.toggleSavedMoment(moment)).toContain('session only')
    expect(localStorage.getItem(store.LEGACY_SAVED_MOMENTS_KEY)).toBe('broken')
    expect(localStorage.getItem(store.SAVED_MOMENTS_KEY)).toBeNull()
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
    localStorage.setItem(store.SAVED_MOMENTS_KEY, JSON.stringify({ version: 2, items: [savedMomentRecord(moment), savedMomentRecord(second)] }))
    const third = fromHubMoment({ ...moment, offsetSeconds: 30 })!
    store.toggleSavedMoment(third)
    expect(parseSavedMoments(localStorage.getItem(store.SAVED_MOMENTS_KEY))).toHaveLength(3)
    localStorage.setItem(store.SAVED_MOMENTS_KEY, 'new corruption')
    expect(store.toggleSavedMoment(fromHubMoment({ ...moment, offsetSeconds: 40 })!)).toContain('session only')
    expect(localStorage.getItem(store.SAVED_MOMENTS_KEY)).toBe('new corruption')
  })
})
