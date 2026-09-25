import { describe, expect, it } from 'vitest'
import { clearHistory, DAY, hasRecent, rememberInteraction, replayUrl, timestamp, validateNote, visibleMoments } from './model.ts'
import { createDemoRepository, createDemoSnapshot, demoReference } from '../../../docs/pulse-extension/monetization-mockups/library-workflow/demoRepository.ts'

const now = 1_800_000_000_000
describe('Library semantics', () => {
  it.each(['selected', 'opened-link', 'seek-failed'] as const)('does not remember %s', kind => {
    const snapshot = createDemoSnapshot('ready', now)
    snapshot.preferences.captureHistory = true
    expect(rememberInteraction(snapshot, { kind, reference: demoReference })).toBe(snapshot)
  })
  it('requires opt-in and excludes incognito', () => {
    const snapshot = createDemoSnapshot('ready', now)
    expect(rememberInteraction(snapshot, { kind: 'seek-confirmed', reference: demoReference, occurredAt: now, incognito: false })).toBe(snapshot)
    snapshot.preferences.captureHistory = true
    expect(rememberInteraction(snapshot, { kind: 'seek-confirmed', reference: demoReference, occurredAt: now, incognito: true })).toBe(snapshot)
  })
  it('deduplicates confirmed jumps, preserves saves, rejects time regression', () => {
    const snapshot = createDemoSnapshot('ready', now); snapshot.preferences.captureHistory = true
    const reference = snapshot.moments[0]
    const once = rememberInteraction(snapshot, { kind: 'seek-confirmed', reference, occurredAt: now, incognito: false })
    const twice = rememberInteraction(once, { kind: 'seek-confirmed', reference, occurredAt: now - 1, incognito: false })
    expect(twice.moments).toHaveLength(snapshot.moments.length)
    const saved = twice.moments.find(m => m.id === reference.id)!
    expect(saved.savedAt).toBe(reference.savedAt); expect(saved.note).toBe(reference.note)
    expect(saved.jumpedAt).toBe(now); expect(saved.historyExpiresAt).toBe(now + 90 * DAY)
  })
  it('filters expiry on reads without deleting saved references', () => {
    const snapshot = createDemoSnapshot('ready', now)
    expect(visibleMoments(snapshot, 'recent', '', '', now + 10 * DAY)).toHaveLength(0)
    expect(visibleMoments(snapshot, 'saved', '', '', now + 10 * DAY)).toHaveLength(3)
  })
  it('remembers a stable verified live offset without pretending a VOD exists', () => {
    const snapshot = createDemoSnapshot('ready', now); snapshot.preferences.captureHistory = true
    const reference = { ...demoReference, vodId: null, streamId: 'stable-stream', availability: 'unresolved' as const }
    const result = rememberInteraction(snapshot, { kind: 'seek-confirmed', reference, occurredAt: now, incognito: false })
    expect(result.moments.find(m => m.id === reference.id)?.jumpedAt).toBe(now)
    expect(replayUrl(reference)).toBeNull()
    expect(rememberInteraction(snapshot, { kind: 'seek-confirmed', reference: { ...reference, streamId: undefined }, occurredAt: now, incognito: false })).toBe(snapshot)
  })
  it('clears history but preserves saved notes and collection IDs', () => {
    const result = clearHistory(createDemoSnapshot('ready', now))
    expect(result.moments).toHaveLength(3)
    expect(result.moments.every(m => !hasRecent(m, now))).toBe(true)
    expect(result.moments.find(m => m.id === 'three')?.collectionId).toBe('clip-ideas')
    expect(result.moments.find(m => m.id === 'three')?.note).toContain('note is still here')
  })
  it('searches notes', () => {
    const snapshot = createDemoSnapshot('ready', now)
    expect(visibleMoments(snapshot, 'saved', 'come back', '', now).map(m => m.id)).toEqual(['one'])
  })
  it('uses a stable tiebreaker', () => {
    const snapshot = createDemoSnapshot('ready', now)
    snapshot.moments = snapshot.moments.map(m => ({ ...m, savedAt: now }))
    expect(visibleMoments(snapshot, 'saved', '', '', now).map(m => m.id)).toEqual(['four', 'one', 'three', 'two'])
  })
  it('never renders an arbitrary or unresolved replay URL', () => {
    expect(replayUrl({ ...demoReference, vodId: 'javascript:alert(1)' })).toBeNull()
    expect(replayUrl({ ...demoReference, availability: 'unresolved' })).toBeNull()
    expect(replayUrl({ ...demoReference, offsetSeconds: NaN })).toBeNull()
    expect(replayUrl(demoReference)).toBe('https://www.twitch.tv/videos/9999999991?t=6138s')
  })
  it('formats timestamps and bounds notes', () => {
    expect(timestamp(6138)).toBe('01:42:18'); expect(timestamp(null)).toBe('Position unknown')
    expect(validateNote('x'.repeat(1001))).toBeTruthy(); expect(validateNote('<script>plain text</script>')).toBeNull()
  })
})

describe('demonstration adapter contracts', () => {
  const signal = () => new AbortController().signal
  it('save without jump is a bookmark only and repeated save is idempotent', async () => {
    const repo = createDemoRepository('new', 0, () => now)
    const once = await repo.execute({ kind: 'save', reference: demoReference }, signal())
    const twice = await repo.execute({ kind: 'save', reference: demoReference }, signal())
    expect(once.moments[0].jumpedAt).toBeUndefined(); expect(twice.moments).toHaveLength(1)
  })
  it('failed writes do not fake saved state', async () => {
    const repo = createDemoRepository('write-error', 0, () => now)
    await expect(repo.execute({ kind: 'save', reference: demoReference }, signal())).rejects.toThrow('not saved')
    expect((await repo.load(signal())).moments.find(m => m.id === demoReference.id)).toBeUndefined()
  })
  it('full store preserves readable/exportable data and rejects growth', async () => {
    const repo = createDemoRepository('full', 0, () => now)
    await expect(repo.execute({ kind: 'save', reference: demoReference }, signal())).rejects.toThrow('full')
    expect(JSON.parse(await repo.export(signal())).moments).toHaveLength(4)
  })
  it('aborts work before commit', async () => {
    const repo = createDemoRepository('new', 10, () => now); const controller = new AbortController()
    const promise = repo.execute({ kind: 'save', reference: demoReference }, controller.signal); controller.abort()
    await expect(promise).rejects.toThrow('Aborted'); expect((await repo.load(signal())).moments).toHaveLength(0)
  })
  it('free accounts keep notes and cannot create collections or extend retention', async () => {
    const repo = createDemoRepository('free', 0, () => now)
    await repo.execute({ kind: 'edit', id: 'one', note: 'Still mine', collectionId: 'watch-again' }, signal())
    await expect(repo.execute({ kind: 'create-collection', name: 'New' }, signal())).rejects.toThrow('Supporter')
    await expect(repo.execute({ kind: 'preferences', value: { captureHistory: true, retentionDays: 90 } }, signal())).rejects.toThrow('Supporter')
  })
  it('rejects duplicate collection names', async () => {
    const repo = createDemoRepository('ready', 0, () => now)
    await expect(repo.execute({ kind: 'create-collection', name: 'WATCH AGAIN' }, signal())).rejects.toThrow('already exists')
  })
  it('removing a saved item does not invent or erase its separate recent jump', async () => {
    const repo = createDemoRepository('ready', 0, () => now)
    const after = await repo.execute({ kind: 'unsave', id: 'three' }, signal())
    const recent = after.moments.find(m => m.id === 'three')!
    expect(recent.savedAt).toBeUndefined(); expect(recent.note).toBe(''); expect(hasRecent(recent, now)).toBe(true)
  })
})
