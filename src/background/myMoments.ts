import { createPulseBookmark, deletePulseBookmark, fetchPulseBookmarks } from './api.ts'
import { isDeviceCredentialInvalidatedError } from './deviceAuth.ts'
import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'
import { supporterAccount } from './supporterAccountRuntime.ts'
import type { BookmarksState, MyMomentsRequest, MyMomentsSnapshot } from '../shared/myMoments.ts'
import type { LibraryMoment } from '../ui/library/model.ts'
import { personalTransaction, recordWatched } from './myMomentsStore.ts'

const identity = (m: { channel: string; vodId: string | null; streamId?: string; offsetSeconds: number | null }) => `${m.channel}:${m.streamId || m.vodId}:${m.offsetSeconds}`
async function currentScope(): Promise<string> {
  const root = await getBackendUrl()
  const account = root === DEFAULT_BACKEND_URL ? await supporterAccount.run('status') : null
  return `${root}|${account?.state === 'linked' ? `account:${account.accountId}` : 'local'}`
}
const scopeAccount = (scope: string): string | undefined => scope.split('|account:')[1]
async function assertScope(scope: string) { if (scope !== await currentScope()) throw new Error('Device connection changed. Reload My Moments.') }
async function snapshot(scope: string): Promise<MyMomentsSnapshot> {
  const data = await personalTransaction(scope)
  const moments: LibraryMoment[] = []
  let bookmarksState: BookmarksState = 'ready'
  // Scope resolution uses the serialized account refresh path. Signed-out
  // requests never fall back to the unrelated Protect device credential.
  if (!scopeAccount(scope)) {
    bookmarksState = 'not_linked'
  } else {
    try {
      let cursor: string | undefined
      const cursors = new Set<string>()
      do {
        const page = await fetchPulseBookmarks({ limit: 100, cursor }, undefined, scopeAccount(scope))
        await assertScope(scope)
        for (const b of page.items) moments.push({ id: b.id, channel: b.login, title: b.label || 'Saved moment', vodId: b.vodId ?? null, streamId: b.streamId,
          offsetSeconds: b.offsetSeconds, availability: 'unresolved', savedAt: Date.parse(b.createdAt), note: data.notes[b.id] ?? b.notes })
        cursor = page.nextCursor
        if (cursor && (cursors.has(cursor) || moments.length >= 5000)) throw new Error('Bookmark pagination limit')
        if (cursor) cursors.add(cursor)
      } while (cursor)
    } catch (err) {
      bookmarksState = isDeviceCredentialInvalidatedError(err) ? 'expired' : 'error'
      moments.length = 0
    }
  }
  await assertScope(scope)
  for (const h of data.history) {
    const bookmark = moments.find(b => identity(b) === identity(h))
    if (bookmark) Object.assign(bookmark, { jumpedAt: h.jumpedAt, historyExpiresAt: h.historyExpiresAt })
    else moments.push({ ...h, note: data.notes[h.id] ?? h.note })
  }
  return { scope, production: true, bookmarksState, bookmarksAvailable: bookmarksState === 'ready', localNotes: data.notes, moments, collections: [], membership: 'free', preferences: data.preferences,
    sync: { kind: 'local' }, storage: { usedBytes: new TextEncoder().encode(JSON.stringify(data)).length, limitBytes: 2 * 1048576, persistence: 'unknown' } }
}
let queue: Promise<unknown> = Promise.resolve()
export function handleMyMoments(message: MyMomentsRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const run = queue.then(async () => {
    if (sender.tab?.incognito || chrome.extension?.inIncognitoContext) throw new Error('My Moments is unavailable in private browsing.')
    const scope = await currentScope()
    if (message.type === 'MOMENT_CAPTURE') {
      if (message.action === 'status') {
        const data = await personalTransaction(scope)
        return { type: 'MOMENT_CAPTURE', enabled: data.preferences.captureHistory, epoch: data.epoch }
      }
      const ref = message.reference
      const path = new URL(sender.tab?.url ?? 'https://invalid/').pathname
      if (path !== `/videos/${ref.vodId}` && path !== `/${ref.channel}`) throw new Error('Source changed')
      await assertScope(scope)
      await personalTransaction(scope, data => recordWatched(data, { ...ref, id: identity(ref), note: '' }, message.epoch, Date.now()))
      return { ok: true }
    }
    if (message.action === 'mutate') {
      if (message.scope !== scope) throw new Error('Device connection changed. Reload My Moments.')
      const command = message.command
      if (command.kind === 'save') {
        const r = command.reference
        const all = await snapshot(scope)
        if (!all.bookmarksAvailable) {
          throw new Error(all.bookmarksState === 'not_linked' || all.bookmarksState === 'expired'
            ? 'Connect your Pulse account before saving bookmarks.'
            : 'Could not reach StreamPulse. Try saving again shortly.')
        }
        if (!all.moments.some(m => m.savedAt !== undefined && identity(m) === identity(r))) {
          await assertScope(scope)
          await createPulseBookmark({ login: r.channel, streamId: r.streamId, vodId: r.vodId ?? undefined, offsetSeconds: Math.floor(r.offsetSeconds!), label: r.title.slice(0, 160), source: 'extension' }, undefined, scopeAccount(scope))
        }
      } else if (command.kind === 'unsave' || command.kind === 'edit') {
        const all = await snapshot(scope)
        if (!all.moments.some(m => m.id === command.id && m.savedAt !== undefined)) throw new Error('Bookmark unavailable. Reload before editing.')
        await assertScope(scope)
        if (command.kind === 'unsave') await deletePulseBookmark(command.id, undefined, scopeAccount(scope))
        await assertScope(scope)
        await personalTransaction(scope, data => {
          const notes = { ...data.notes }
          if (command.kind === 'edit') notes[command.id] = command.note
          else delete notes[command.id]
          return { ...data, notes }
        })
      } else {
        await personalTransaction(scope, data => command.kind === 'clear-history'
          ? { ...data, epoch: Math.max(Date.now(), data.epoch + 1), history: [] }
          : { ...data, epoch: Math.max(Date.now(), data.epoch + 1), preferences: command.value,
            history: data.history.map(m => ({ ...m, historyExpiresAt: Math.min(m.historyExpiresAt!, m.jumpedAt! + command.value.retentionDays * 86400000) })) })
      }
    }
    return { type: 'MY_MOMENTS', snapshot: await snapshot(scope) }
  })
  queue = run.catch(() => undefined)
  return run
}
