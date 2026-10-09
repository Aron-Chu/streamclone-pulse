import { createPulseBookmark, deletePulseBookmark, fetchPulseBookmarks } from './api.ts'
import { isDeviceCredentialInvalidatedError } from './deviceAuth.ts'
import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'
import { bindAccountDataForget, supporterAccount } from './supporterAccountRuntime.ts'
import type { BookmarksState, MyMomentsRecent, MyMomentsRequest, MyMomentsSnapshot } from '../shared/myMoments.ts'
import type { BackgroundResponse, ListBookmarksMessage, PulseBookmark, SaveBookmarkMessage } from '../shared/messages.ts'
import { replayAvailability, type LibraryMoment, type MomentReference } from '../ui/library/model.ts'
import { addDeviceBookmark, bookmarkIdentity, deletePersonal, momentIdentity as identity, personalTransaction, recordWatched } from './myMomentsStore.ts'

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
  return { scope, production: true, bookmarksState, bookmarksAvailable: bookmarksState === 'ready', localNotes: data.notes, moments,
    deviceBookmarks: device?.bookmarks.map(b => ({ ...b, notes: device.notes[b.id] ?? '' })) ?? [], collections: [], membership: 'free', preferences: data.preferences,
    sync: { kind: 'local' }, storage: { usedBytes: new TextEncoder().encode(JSON.stringify(data)).length, limitBytes: 2 * 1048576, persistence: 'unknown' } }
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
/** One click adds at most this many; any rest stay listed for another click. */
const IMPORT_LIMIT = 100
/**
 * "Add to account": saves made without an account join the signed-in account,
 * only when asked, one (`id`) or all. Each is posted in the hosted bookmark
 * shape it was kept in and leaves this device only after the account confirms
 * it (2xx), so a failure partway keeps the rest here. A save the account
 * already has (same channel, stream or VOD, and second) is not posted again.
 * Its note never leaves the device: it moves to the account's local notes.
 */
async function importDeviceSaves(scope: string, held: boolean, id?: string): Promise<void> {
  const account = scopeAccount(scope)
  if (!account || held) throw new Error('Sign in to add saves to your account.')
  const all = await snapshot(scope)
  if (!all.bookmarksAvailable) {
    throw new Error(all.bookmarksState === 'expired'
      ? 'Your Pulse account link expired. Sign in again to add saves to your account.'
      : 'Could not reach StreamPulse. Your saves stay on this device.')
  }
  const chosen = all.deviceBookmarks.filter(b => id === undefined || b.id === id).slice(0, IMPORT_LIMIT)
  if (!chosen.length) throw new Error('That save is no longer on this device. Reload My Moments.')
  const inAccount = new Map(all.moments.filter(m => m.savedAt !== undefined).map(m => [identity(m), m.id]))
  let added = 0
  for (const b of chosen) {
    const key = bookmarkIdentity(b)
    let hostedId = inAccount.get(key)
    try {
      await assertScope(scope)
      if (!hostedId) {
        const created = await createPulseBookmark({ login: b.login, ...(b.streamId ? { streamId: b.streamId } : {}), ...(b.vodId ? { vodId: b.vodId } : {}),
          offsetSeconds: Math.floor(b.offsetSeconds), label: b.label.slice(0, 160), source: 'extension' }, undefined, account)
        hostedId = typeof created?.id === 'string' && created.id ? created.id : undefined
        inAccount.set(key, hostedId ?? '')
      }
    } catch (error) {
      if (error instanceof Error && /connection changed/.test(error.message)) throw error
      throw new Error(added
        ? `Added ${added} of ${chosen.length} to your account. The rest stay on this device; try again shortly.`
        : 'Could not add to your account. Your saves stay on this device; try again shortly.')
    }
    const note = b.notes
    if (note && hostedId) await personalTransaction(scope, data => data.notes[hostedId!] ? data : { ...data, notes: { ...data.notes, [hostedId!]: note } })
    await personalTransaction(deviceScope(scope), data => {
      const notes = { ...data.notes }
      delete notes[b.id]
      return { ...data, notes, bookmarks: data.bookmarks.filter(item => item.id !== b.id) }
    })
    added++
  }
}
let queue: Promise<unknown> = Promise.resolve()
/**
 * This device left the account (Sign out, Sign out everywhere, or a revoked
 * credential): its copy of that account's watched history and notes goes.
 * Saves made without an account (the `|local` scope) stay. Queued behind any
 * My Moments request already under way, so none can write the copy back.
 */
export function forgetAccountScope(accountId: string): Promise<void> {
  const run = queue.then(() => deletePersonal(`${DEFAULT_BACKEND_URL}|account:${accountId}`))
  queue = run.catch(() => undefined)
  return run
}
bindAccountDataForget(accountId => { void forgetAccountScope(accountId).catch(() => undefined) })
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
      await personalTransaction(scope, data => recordWatched(data, { ...ref, id: identity(ref), note: '' }, message.epoch, Date.now()))
      return { ok: true }
    }
    if (message.action === 'recent') return { type: 'MY_MOMENTS_RECENT', recent: await recent(scope) }
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
      } else if (command.kind === 'import-device-saves') {
        await importDeviceSaves(scope, held, command.id)
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
