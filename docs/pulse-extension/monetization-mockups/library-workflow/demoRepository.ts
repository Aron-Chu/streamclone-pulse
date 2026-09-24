import { clearHistory, DAY, hasRecent, rememberInteraction, validateNote, type LibraryCommand, type LibraryRepository, type LibrarySnapshot, type MomentReference } from '../../../../src/ui/library/model.ts'

export type DemoScenario = 'design' | 'ready' | 'new' | 'offline' | 'full' | 'load-error' | 'write-error' | 'free' | 'expired' | 'large'
export const demoReference: MomentReference = { id: 'demo-jump', channel: 'northstar', title: 'Emote spike at the final round', vodId: '9999999991', offsetSeconds: 6138, availability: 'available' }
export function createDemoSnapshot(scenario: DemoScenario = 'ready', now = Date.now()): LibrarySnapshot {
  const base: LibrarySnapshot = {
    preferences: { captureHistory: false, retentionDays: scenario === 'free' || scenario === 'expired' ? 7 : 90 },
    membership: scenario === 'free' ? 'free' : scenario === 'expired' ? 'expired' : 'supporter',
    collections: [{ id: 'watch-again', name: 'Watch again' }, { id: 'clip-ideas', name: 'Clip ideas' }],
    sync: scenario === 'offline' ? { kind: 'offline', pending: 2 } : { kind: 'local' },
    storage: { usedBytes: 0, limitBytes: 25 * 1048576, persistence: 'not-granted' },
    moments: scenario === 'new' ? [] : [
      { id: 'one', channel: 'xqc', title: 'Halloween: The Game · emote reaction', streamId: '321274489178', vodId: null, offsetSeconds: 12321, availability: 'unresolved', savedAt: now - 12 * 60_000, note: 'Come back to this part of the Halloween stream.', collectionId: 'watch-again' },
      { id: 'two', channel: 'lunaroom', title: 'Chat spike after the reveal', vodId: '9999999993', offsetSeconds: 2284, availability: 'available', jumpedAt: now - 28 * 60_000, historyExpiresAt: now + 6 * DAY, note: '' },
      { id: 'three', channel: 'pixelharbor', title: 'Reaction worth keeping', vodId: '9999999994', offsetSeconds: 3370, availability: 'unavailable', savedAt: now - DAY, jumpedAt: now - DAY, historyExpiresAt: now + 5 * DAY, note: 'My note is still here even though the VOD has gone.', collectionId: 'clip-ideas' },
      { id: 'four', channel: 'northstar', title: 'Live source · waiting for a stable replay', vodId: null, offsetSeconds: null, availability: 'unresolved', savedAt: now - 2 * DAY, note: 'A saved reference, not a confirmed playback position.' },
    ],
  }
  if (scenario === 'design') base.moments = base.moments.map(moment => moment.id === 'two' ? { ...moment, savedAt: now - 5 * 60_000, collectionId: 'watch-again', note: 'Keep the reveal and the chat reaction together.' } : moment)
  if (scenario === 'large') base.moments = Array.from({ length: 37 }, (_, i) => ({ ...base.moments[0], id: `page-${i}`, title: `Saved reaction ${i + 1}`, savedAt: now - i * 60_000 }))
  return measure(base, scenario === 'full')
}
function measure(snapshot: LibrarySnapshot, full = false): LibrarySnapshot {
  return { ...snapshot, storage: { ...snapshot.storage, usedBytes: full ? snapshot.storage.limitBytes : new TextEncoder().encode(JSON.stringify(snapshot.moments)).byteLength } }
}
function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
/** In-memory demonstration ONLY. No IndexedDB, network, real seek, billing or uploads. */
export function createDemoRepository(scenario: DemoScenario, latency = 450, now = Date.now): LibraryRepository {
  let snapshot = createDemoSnapshot(scenario, now())
  const copy = () => structuredClone(snapshot)
  return {
    async load(signal) { await abortableDelay(latency, signal); if (scenario === 'load-error') throw new Error('Simulated load failure'); return copy() },
    async execute(command: LibraryCommand, signal) {
      await abortableDelay(latency, signal)
      if (scenario === 'write-error') throw new Error('Could not write to storage. Your change was not saved. Try again or export your existing Library.')
      const before = snapshot
      if (scenario === 'full' && (command.kind === 'save' || command.kind === 'edit' || command.kind === 'interaction')) throw new Error('Device allowance is full. No new record was saved. Export or remove items in Storage & privacy.')
      switch (command.kind) {
        case 'save': {
          const old = snapshot.moments.find(m => m.id === command.reference.id)
          if (old?.savedAt !== undefined) break
          snapshot = { ...snapshot, moments: [...snapshot.moments.filter(m => m.id !== command.reference.id), { ...command.reference, ...old, note: old?.note ?? '', savedAt: now() }] }; break
        }
        case 'unsave': snapshot = { ...snapshot, moments: snapshot.moments.filter(m => m.id !== command.id || hasRecent(m, now())).map(m => m.id === command.id ? { ...m, savedAt: undefined, note: '', collectionId: undefined } : m) }; break
        case 'edit': {
          const error = validateNote(command.note); if (error) throw new Error(error)
          const old = snapshot.moments.find(m => m.id === command.id)
          if (old?.savedAt === undefined) throw new Error('This saved moment is no longer available. Reload the Library.')
          if (snapshot.membership !== 'supporter' && old.collectionId !== command.collectionId) throw new Error('Changing collections requires Supporter.')
          if (command.collectionId && !snapshot.collections.some(c => c.id === command.collectionId)) throw new Error('Collection not found.')
          snapshot = { ...snapshot, moments: snapshot.moments.map(m => m.id === command.id ? { ...m, note: command.note, collectionId: command.collectionId } : m) }; break
        }
        case 'clear-history': snapshot = clearHistory(snapshot); break
        case 'interaction': snapshot = rememberInteraction(snapshot, command.event); break
        case 'preferences': {
          if (snapshot.membership !== 'supporter' && command.value.retentionDays !== 7) throw new Error('Extended history requires Supporter.')
          snapshot = { ...snapshot, preferences: command.value, moments: snapshot.moments.map(m => m.jumpedAt === undefined ? m : { ...m, historyExpiresAt: Math.min(m.historyExpiresAt ?? Infinity, m.jumpedAt + command.value.retentionDays * DAY) }) }; break
        }
        case 'create-collection': {
          const name = command.name.trim()
          if (snapshot.membership !== 'supporter') throw new Error('New collections require Supporter.')
          if (!name || name.length > 60) throw new Error('Use a name between 1 and 60 characters.')
          if (snapshot.collections.length >= 50) throw new Error('You have reached the 50-collection limit.')
          if (snapshot.collections.some(c => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A collection with that name already exists.')
          snapshot = { ...snapshot, collections: [...snapshot.collections, { id: `collection-${snapshot.collections.length + 1}`, name }] }; break
        }
      }
      snapshot = measure(snapshot)
      if (snapshot.storage.usedBytes > snapshot.storage.limitBytes) { snapshot = before; throw new Error('Storage allowance exceeded. Change was not saved.') }
      return copy()
    },
    async export(signal) {
      await abortableDelay(latency, signal)
      return JSON.stringify({ schemaVersion: 1, demo: true, exportedAt: new Date(now()).toISOString(), moments: snapshot.moments.filter(m => m.savedAt !== undefined || hasRecent(m, now())), collections: snapshot.collections }, null, 2)
    },
  }
}
