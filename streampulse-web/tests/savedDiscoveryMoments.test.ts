import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fromHubMoment } from '../src/lib/discoveryMoments'
import { parseSavedMoments, savedMomentRecord } from '../src/lib/savedDiscoveryMoments'
const moment = fromHubMoment({ login: 'creator', streamId: 'stream-a', offsetSeconds: 10, label: 'Moment', vodId: '12345', handoffRef: 'cr_secret', profileImageUrl: 'https://example.com/secret',
  category: 'Wuthering Waves', categoryId: '213490846', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/213490846-144x192.jpg' })!
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
  it('rejects malformed and oversized persisted data', () => {
    expect(() => parseSavedMoments('{')).toThrow()
    expect(() => parseSavedMoments(JSON.stringify({ version: 2, items: [] }))).toThrow()
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
