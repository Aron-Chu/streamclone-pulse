import { createPulseBookmark, deletePulseBookmark, fetchPulseBookmarks } from './api.ts'
import { isDeviceCredentialInvalidatedError } from './deviceAuth.ts'
import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'
import { supporterAccount } from './supporterAccountRuntime.ts'
import type { BookmarksState, MyMomentsRecent, MyMomentsRequest, MyMomentsSnapshot } from '../shared/myMoments.ts'
import type { BackgroundResponse, ListBookmarksMessage, PulseBookmark, SaveBookmarkMessage } from '../shared/messages.ts'
import { replayAvailability, type LibraryMoment, type MomentReference } from '../ui/library/model.ts'
import { addDeviceBookmark, bookmarkIdentity, momentIdentity as identity, personalTransaction, recordWatched } from './myMomentsStore.ts'
import { clearAccountHistory, historySyncView, refreshHistorySync, setAccountRetention, setHistorySync, syncHistoryNow } from './historySync.ts'

export { replayAvailability }
const bookmarkMoment = (b: PulseBookmark, note: string): LibraryMoment => ({ id: b.id, channel: b.login, title: b.label || 'Saved moment', vodId: b.vodId ?? null,
  streamId: b.streamId, offsetSeconds: b.offsetSeconds, availability: replayAvailability({ vodId: b.vodId ?? null, offsetSeconds: b.offsetSeconds }), savedAt: Date.parse(b.createdAt), note })
/**
 * Who owns this device's moments, and whether the device may keep bookmarks.
 *
 * Only a really unlinked device saves bookmarks locally. A connection waiting
 * on token renewal (`unavailable` with `linked`) is still its account: the
 * stored credentials name it, so it keeps the account scope, and the hosted
 * path reports the outage (`account_temporarily_unavailable`) instead of a
 * device save that would drop out of view once renewal succeeds. If that
 * account cannot be read back it is held rather than treated as signed out.
 *
 * An unconfirmed disconnect (`error` with `revocationPending`) stays local on
 * purpose: its tombstone authorizes nothing and resolves only to signed out,
 * so saves made meanwhile land in the scope the device returns to.
 */
async function resolveScope(): Promise<{ scope: string; held: boolean }> {
  const root = await getBackendUrl()
  if (root !== DEFAULT_BACKEND_URL) return { scope: `${root}|local`, held: false }
  const account = await supporterAccount.run('status')
  const waiting = account.state === 'unavailable' && account.linked === true
  const accountId = account.state === 'linked' ? account.accountId : waiting ? await supporterAccount.localAccountId() : null
  if (accountId) return { scope: `${root}|account:${accountId}`, held: false }
  return { scope: `${root}|local`, held: waiting }
}
async function currentScope(): Promise<string> { return (await resolveScope()).scope }
const scopeAccount = (scope: string): string | undefined => scope.split('|account:')[1]
/** Device saves belong to the backend root, not to whichever account is linked. */
const deviceScope = (scope: string) => `${scope.split('|')[0]}|local`
async function assertScope(scope: string) { if (scope !== await currentScope()) throw new Error('Device connection changed. Reload My Moments.') }
async function snapshot(scope: string): Promise<MyMomentsSnapshot> {
  const data = await personalTransaction(scope)
  const moments: LibraryMoment[] = []
  let bookmarksState: BookmarksState = 'ready'
  // Scope resolution uses the serialized account refresh path. Signed-out
  // requests never fall back to the unrelated Protect device credential.
  if (!scopeAccount(scope)) {
    bookmarksState = 'not_linked'
    for (const b of data.bookmarks) moments.push(bookmarkMoment(b, data.notes[b.id] ?? ''))
  } else {
    try {
      let cursor: string | undefined
      const cursors = new Set<string>()
      do {
        const page = await fetchPulseBookmarks({ limit: 100, cursor }, undefined, scopeAccount(scope))
        await assertScope(scope)
        for (const b of page.items) moments.push(bookmarkMoment(b, data.notes[b.id] ?? b.notes))
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
  // Saves made before linking stay on the device until an explicit import;
  // listing them here keeps them in exports and lets the page say so.
  const device = scopeAccount(scope) ? await personalTransaction(deviceScope(scope)) : null
  for (const h of data.history) {
    const bookmark = moments.find(b => identity(b) === identity(h))
    if (bookmark) Object.assign(bookmark, { jumpedAt: h.jumpedAt, historyExpiresAt: h.historyExpiresAt })
    else moments.push({ ...h, availability: replayAvailability(h), note: data.notes[h.id] ?? h.note })
  }
  const historySync = historySyncView(!!scopeAccount(scope), data)
  return { scope, production: true, bookmarksState, bookmarksAvailable: bookmarksState === 'ready', localNotes: data.notes, moments,
    deviceBookmarks: device?.bookmarks.map(b => ({ ...b, notes: device.notes[b.id] ?? '' })) ?? [], collections: [], membership: 'free', preferences: data.preferences,
    sync: historySync.state !== 'on' ? { kind: 'local' } : historySync.failed ? { kind: 'offline', pending: historySync.pending }
      : historySync.syncedAt ? { kind: 'synced', at: historySync.syncedAt } : { kind: 'syncing', pending: historySync.pending },
    historySync, storage: { usedBytes: new TextEncoder().encode(JSON.stringify(data)).length, limitBytes: 2 * 1048576, persistence: 'unknown' } }
}
/** Waits for a sync only so long; a slow one finishes in the background. */
async function within(work: Promise<void>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })]) } finally { clearTimeout(timer) }
}
let syncTimer: ReturnType<typeof setTimeout> | undefined
/** Batches the jumps of a viewing session into one push shortly after. */
function syncSoon(scope: string, accountId: string, delayMs = 20_000) {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { void syncHistoryNow(scope, accountId).catch(() => undefined) }, delayMs)
}
const privateBrowsing = (sender: chrome.runtime.MessageSender) => !!(sender.tab?.incognito || chrome.extension?.inIncognitoContext)
/**
 * Twitch-page bookmark requests while no account is linked: kept in this
 * worker's database, never sent over the network. Resolves null when the
 * hosted path owns the request (a linked account, including one waiting on
 * renewal, or private browsing where nothing may persist), so the caller keeps
 * that path exactly as before.
 * Each read or write is one IndexedDB transaction, so it needs no queue slot.
 */
export async function handleDeviceBookmarks(message: ListBookmarksMessage | SaveBookmarkMessage, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse | null> {
  if (privateBrowsing(sender)) return null
  const { scope, held } = await resolveScope()
  if (held || scopeAccount(scope)) return null
  if (message.type === 'SAVE_BOOKMARK') {
    const b = message.bookmark
    const data = await personalTransaction(scope, d => addDeviceBookmark(d, b, Date.now()))
    const key = identity({ channel: b.login ?? '', vodId: b.vodId ?? null, streamId: b.streamId, offsetSeconds: Math.floor(b.offsetSeconds) })
    return { type: 'BOOKMARK', item: data.bookmarks.find(item => bookmarkIdentity(item) === key)!, device: true }
  }
  const start = message.cursor ? Number(message.cursor) : 0
  if (!Number.isSafeInteger(start) || start < 0) throw new Error('invalid_bookmark_cursor')
  const limit = message.limit ?? 50
  const matches = (await personalTransaction(scope)).bookmarks
    .filter(b => (!message.login || b.login === message.login) && (!message.streamId || b.streamId === message.streamId) && (!message.vodId || b.vodId === message.vodId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { type: 'BOOKMARKS', items: matches.slice(start, start + limit), ...(start + limit < matches.length ? { nextCursor: String(start + limit) } : {}), device: true }
}
const reference = (m: MomentReference): MomentReference => ({ id: m.id, channel: m.channel, title: m.title, vodId: m.vodId, streamId: m.streamId,
  offsetSeconds: m.offsetSeconds, availability: replayAvailability(m) })
/** The popup's "Jump back in": this device's history and saves only, no network. */
async function recent(scope: string): Promise<MyMomentsRecent> {
  const now = Date.now()
  const data = await personalTransaction(scope)
  const device = scopeAccount(scope) ? await personalTransaction(deviceScope(scope)) : data
  const watched = data.history
    .filter(m => m.jumpedAt !== undefined && (m.historyExpiresAt ?? 0) > now)
    .sort((a, b) => b.jumpedAt! - a.jumpedAt!)
    .slice(0, 2)
    .map(m => ({ ...reference(m), jumpedAt: m.jumpedAt! }))
  const latest = [...device.bookmarks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return { watched, deviceSaves: device.bookmarks.length, latestSave: latest ? reference(bookmarkMoment(latest, '')) : null }
}
let queue: Promise<unknown> = Promise.resolve()
export function handleMyMoments(message: MyMomentsRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const run = queue.then(async () => {
    if (privateBrowsing(sender)) throw new Error('My Moments is unavailable in private browsing.')
    const { scope, held } = await resolveScope()
    if (message.type === 'MOMENT_CAPTURE') {
      if (message.action === 'status') {
        const data = await personalTransaction(scope)
        return { type: 'MOMENT_CAPTURE', enabled: data.preferences.captureHistory, epoch: data.epoch }
      }
      const ref = message.reference
      const path = new URL(sender.tab?.url ?? 'https://invalid/').pathname
      if (path !== `/videos/${ref.vodId}` && path !== `/${ref.channel}`) throw new Error('Source changed')
      await assertScope(scope)
      const saved = await personalTransaction(scope, data => recordWatched(data, { ...ref, id: identity(ref), note: '' }, message.epoch, Date.now()))
      const account = scopeAccount(scope)
      if (account && saved.accountSync?.enabled && saved.accountSync.pending.length) syncSoon(scope, account)
      return { ok: true }
    }
    if (message.action === 'recent') {
      const account = scopeAccount(scope)
      const sync = account ? (await personalTransaction(scope)).accountSync : undefined
      // The popup reads this device's copy; a stale one refreshes for next time.
      if (account && sync?.enabled && Date.now() - (sync.syncedAt ?? 0) > 120_000) syncSoon(scope, account, 0)
      return { type: 'MY_MOMENTS_RECENT', recent: await recent(scope) }
    }
    if (message.action === 'load' && scopeAccount(scope)) await within(refreshHistorySync(scope, scopeAccount(scope)!), 6000)
    if (message.action === 'mutate') {
      if (message.scope !== scope) throw new Error('Device connection changed. Reload My Moments.')
      const command = message.command
      if (command.kind === 'save' && held) {
        // Still connected; a device save here would leave the account's list.
        throw new Error('Could not reach StreamPulse. Try saving again shortly.')
      } else if (command.kind === 'save' && !scopeAccount(scope)) {
        // No account: the save stays in this database and is never uploaded.
        const r = command.reference
        await personalTransaction(scope, data => addDeviceBookmark(data, { login: r.channel, streamId: r.streamId, vodId: r.vodId ?? undefined, offsetSeconds: r.offsetSeconds!, label: r.title }, Date.now()))
      } else if (command.kind === 'save') {
        const r = command.reference
        const all = await snapshot(scope)
        if (!all.bookmarksAvailable) {
          throw new Error(all.bookmarksState === 'expired'
            ? 'Your Pulse account link expired. Reconnect to save bookmarks.'
            : 'Could not reach StreamPulse. Try saving again shortly.')
        }
        if (!all.moments.some(m => m.savedAt !== undefined && identity(m) === identity(r))) {
          await assertScope(scope)
          await createPulseBookmark({ login: r.channel, streamId: r.streamId, vodId: r.vodId ?? undefined, offsetSeconds: Math.floor(r.offsetSeconds!), label: r.title.slice(0, 160), source: 'extension' }, undefined, scopeAccount(scope))
        }
      } else if (command.kind === 'unsave' || command.kind === 'edit') {
        const all = await snapshot(scope)
        const hosted = all.moments.some(m => m.id === command.id && m.savedAt !== undefined)
        // A save made before linking is listed read-only beside the account's
        // bookmarks; removing it only touches this device, never the account.
        const onDevice = !hosted && command.kind === 'unsave' && !!scopeAccount(scope) && all.deviceBookmarks.some(b => b.id === command.id)
        if (!hosted && !onDevice) throw new Error('Bookmark unavailable. Reload before editing.')
        await assertScope(scope)
        if (command.kind === 'unsave' && scopeAccount(scope) && !onDevice) await deletePulseBookmark(command.id, undefined, scopeAccount(scope))
        await assertScope(scope)
        await personalTransaction(onDevice ? deviceScope(scope) : scope, data => {
          const notes = { ...data.notes }
          if (command.kind === 'edit') notes[command.id] = command.note
          else delete notes[command.id]
          return { ...data, notes, bookmarks: command.kind === 'unsave' ? data.bookmarks.filter(b => b.id !== command.id) : data.bookmarks }
        })
      } else if (command.kind === 'history-sync') {
        const account = scopeAccount(scope)
        if (!account) throw new Error('Connect a Pulse account to sync history.')
        await setHistorySync(scope, account, command.enabled)
      } else {
        // While the account syncs, its copy changes first so a failure changes nothing here.
        const account = scopeAccount(scope)
        const current = await personalTransaction(scope)
        if (account && current.accountSync?.enabled) {
          if (command.kind === 'clear-history') await clearAccountHistory(account)
          else if (command.value.retentionDays !== current.preferences.retentionDays) await setAccountRetention(account, command.value.retentionDays)
          await assertScope(scope)
        }
        await personalTransaction(scope, data => command.kind === 'clear-history'
          ? { ...data, epoch: Math.max(Date.now(), data.epoch + 1), history: [], ...(data.accountSync ? { accountSync: { ...data.accountSync, pending: [] } } : {}) }
          : { ...data, epoch: Math.max(Date.now(), data.epoch + 1), preferences: command.value,
            history: data.history.map(m => ({ ...m, historyExpiresAt: Math.min(m.historyExpiresAt!, m.jumpedAt! + command.value.retentionDays * 86400000) })) })
      }
    }
    return { type: 'MY_MOMENTS', snapshot: await snapshot(scope) }
  })
  queue = run.catch(() => undefined)
  return run
}
