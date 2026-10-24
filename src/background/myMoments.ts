import { createPulseBookmark, deletePulseBookmark, fetchPulseBookmarks } from './api.ts'
import { isDeviceCredentialInvalidatedError } from './deviceAuth.ts'
import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'
import { bindAccountDataForget, supporterAccount } from './supporterAccountRuntime.ts'
import { MY_MOMENTS_CHANGED, type BookmarksState, type DeviceBookmark, type MyMomentsRecent, type MyMomentsRequest, type MyMomentsSnapshot } from '../shared/myMoments.ts'
import type { BackgroundResponse, ListBookmarksMessage, PulseBookmark, RemoveBookmarkMessage, SaveBookmarkMessage } from '../shared/messages.ts'
import { replayAvailability, type LibraryMoment, type MomentReference } from '../ui/library/model.ts'
import { addDeviceBookmark, bookmarkIdentity, deletePersonal, keepReplayDelta, linkAccountReplays, linkDeviceReplays, momentIdentity as identity, personalTransaction, recordWatched, savedVodOriginDelta } from './myMomentsStore.ts'
import { findStreamReplays, streamKey, type ReplayLookups } from './bookmarkReplay.ts'
import { clearAccountHistory, historySyncCheckDue, historySyncView, refreshHistorySync, setAccountRetention, setHistorySync, syncHistoryNow } from './historySync.ts'
import { handleMomentPicture, wantPicture, type PictureMoment } from './momentPictures.ts'
import { momentPictures } from '../shared/momentPictureStore.ts'
import type { MomentPictureRequest } from '../shared/momentPictureMessages.ts'
import { recordNewDeviceBookmark } from './reviewRequest.ts'

export { replayAvailability }
/** `kept`: an account scope's delta for this hosted save (`PersonalData.replayDeltas`). */
const bookmarkMoment = (b: DeviceBookmark, note: string, kept?: { vodId: string; seconds: number }): LibraryMoment => {
  const delta = savedVodOriginDelta(b, kept)
  return { id: b.id, channel: b.login, title: b.label || 'Saved moment', vodId: b.vodId ?? null, streamId: b.streamId, offsetSeconds: b.offsetSeconds,
    ...(delta === undefined ? {} : { vodOriginDeltaSeconds: delta }),
    availability: replayAvailability({ vodId: b.vodId ?? null, offsetSeconds: b.offsetSeconds }), savedAt: Date.parse(b.createdAt), note }
}
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
 *
 * A key-only connection (Become a Supporter without an account) only pays: its
 * moments stay in this browser and never sync.
 */
async function resolveScope(): Promise<{ scope: string; held: boolean }> {
  const root = await getBackendUrl()
  if (root !== DEFAULT_BACKEND_URL) return { scope: `${root}|local`, held: false }
  const account = await supporterAccount.run('status')
  const waiting = account.state === 'unavailable' && account.linked === true
  const accountId = account.state === 'linked' ? account.accountId : waiting ? await supporterAccount.localAccountId() : null
  if (accountId && await supporterAccount.isInstallationIdentity()) return { scope: `${root}|local`, held: false }
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
        for (const b of page.items) moments.push(bookmarkMoment(b.vodId ? b : { ...b, vodId: data.replayLinks?.[b.id] }, data.notes[b.id] ?? b.notes, data.replayDeltas?.[b.id]))
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
  // A picture goes with the last save or History entry of its moment. Only a
  // complete list decides: an account's bookmarks must have loaded.
  if (!scopeAccount(scope) || bookmarksState === 'ready') await momentPictures.reconcile(scope, new Set(moments.map(identity))).catch(() => undefined)
  if (device) await momentPictures.reconcile(deviceScope(scope), new Set([...device.bookmarks.map(bookmarkIdentity), ...device.history.map(identity)])).catch(() => undefined)
  const historySync = historySyncView(!!scopeAccount(scope), data)
  return { scope, production: true, bookmarksState, bookmarksAvailable: bookmarksState === 'ready', localNotes: data.notes, moments,
    deviceBookmarks: device?.bookmarks.map(b => ({ ...b, notes: device.notes[b.id] ?? '' })) ?? [], collections: [], membership: 'free', preferences: data.preferences,
    sync: historySync.state !== 'on' ? { kind: 'local' } : historySync.failed ? { kind: 'offline', pending: historySync.pending }
      : historySync.syncedAt ? { kind: 'synced', at: historySync.syncedAt } : { kind: 'syncing', pending: historySync.pending },
    historySync, storage: { usedBytes: new TextEncoder().encode(JSON.stringify(data)).length, limitBytes: 2 * 1048576, persistence: 'unknown' } }
}
/** Waits for work only so long; slow work finishes in the background. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms) })]) } finally { clearTimeout(timer) }
}
let replayLookups: ReplayLookups | undefined
/** The service worker's archive lookups: stream history and the channel's open tab. */
export function bindReplayLookups(lookups: ReplayLookups) { replayLookups = lookups }
/**
 * Live saves made stream-only ("Replay not linked", PAGE-1) get their stream's
 * VOD once its archive can be matched: device saves in place, hosted saves as
 * a link kept beside their notes. A lookup that outlasts the open still stores
 * its answer, for the next one. Resolves true when it stored something.
 */
async function linkReplays(scope: string, view: MyMomentsSnapshot): Promise<boolean> {
  if (!replayLookups) return false
  const account = scopeAccount(scope)
  const hosted = account ? view.moments.filter(m => m.savedAt !== undefined && !m.vodId && m.streamId) : []
  const device = (await personalTransaction(deviceScope(scope))).bookmarks.filter(b => !b.vodId && b.streamId)
  const saves = [...hosted.map(m => ({ login: m.channel, streamId: m.streamId!, at: m.savedAt! })),
    ...device.map(b => ({ login: b.login, streamId: b.streamId!, at: Date.parse(b.createdAt) }))].sort((a, b) => b.at - a.at)
  if (!saves.length) return false
  const vods = await findStreamReplays(saves, replayLookups)
  const links = Object.fromEntries(hosted.flatMap(m => vods.has(streamKey(m.channel, m.streamId!)) ? [[m.id, vods.get(streamKey(m.channel, m.streamId!))!]] : []))
  const deviceLinked = device.some(b => vods.has(streamKey(b.login, b.streamId!)))
  if (!deviceLinked && !Object.keys(links).length) return false
  await assertScope(scope)
  if (deviceLinked) await personalTransaction(deviceScope(scope), data => linkDeviceReplays(data, vods))
  if (Object.keys(links).length) await personalTransaction(scope, data => linkAccountReplays(data, links))
  return true
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
    let created = false
    const data = await personalTransaction(scope, d => {
      const next = addDeviceBookmark(d, { ...b, vodOriginDeltaSeconds: message.vodOriginDeltaSeconds }, Date.now())
      created = next !== d
      return next
    })
    const key = identity({ channel: b.login ?? '', vodId: b.vodId ?? null, streamId: b.streamId, offsetSeconds: Math.floor(b.offsetSeconds) })
    const reviewRequest = created && !message.restoreOf && await recordNewDeviceBookmark()
    return { type: 'BOOKMARK', item: data.bookmarks.find(item => bookmarkIdentity(item) === key)!, device: true, ...(reviewRequest ? { reviewRequest: true } : {}) }
  }
  const start = message.cursor ? Number(message.cursor) : 0
  if (!Number.isSafeInteger(start) || start < 0) throw new Error('invalid_bookmark_cursor')
  const limit = message.limit ?? 50
  const matches = (await personalTransaction(scope)).bookmarks
    .filter(b => (!message.login || b.login === message.login) && (!message.streamId || b.streamId === message.streamId) && (!message.vodId || b.vodId === message.vodId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { type: 'BOOKMARKS', items: matches.slice(start, start + limit), ...(start + limit < matches.length ? { nextCursor: String(start + limit) } : {}), device: true }
}
/**
 * The Twitch panel's remove (the bookmark on the moment card). Only a bookmark
 * of the channel, and the stream or VOD, the panel shows, found in that list
 * first: the list the page may already read and save to. A save kept on this
 * device leaves this database; an account's leaves the account, and its local
 * note goes with it, as an unsave in My Moments does. Undo can bring that note
 * back for a short while (restoreRemovedNote).
 */
export async function removePanelBookmark(message: RemoveBookmarkMessage, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  const belongs = (b: PulseBookmark) => b.id === message.id && b.login === message.login
    && (message.streamId ? b.streamId === message.streamId : !!message.vodId && b.vodId === message.vodId)
  const { scope, held } = await resolveScope()
  const account = scopeAccount(scope)
  let removed: PulseBookmark | undefined
  const dropNote = (data: Awaited<ReturnType<typeof personalTransaction>>) => {
    const notes = { ...data.notes }
    if (notes[message.id] && removed) keepRemovedNote(scope, removed, notes[message.id])
    delete notes[message.id]
    return { ...data, notes }
  }
  if (!privateBrowsing(sender) && !held && !account) {
    await personalTransaction(scope, data => {
      removed = data.bookmarks.find(belongs)
      return removed ? { ...dropNote(data), bookmarks: data.bookmarks.filter(b => b.id !== message.id) } : data
    })
    if (!removed) throw new Error('bookmark_not_found')
    await dropPictureUnlessWatched(scope, bookmarkIdentity(removed))
    return { type: 'REMOVE_BOOKMARK', ok: true, device: true }
  }
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const page = await fetchPulseBookmarks({ login: message.login, streamId: message.streamId,
      vodId: message.streamId ? undefined : message.vodId, limit: 100, ...(cursor ? { cursor } : {}) }, undefined, account)
    removed = page.items.find(belongs)
    cursor = page.nextCursor
    if (cursor && (seen.has(cursor) || seen.size >= 50)) throw new Error('invalid_bookmark_pagination')
    if (cursor) seen.add(cursor)
  } while (!removed && cursor)
  if (!removed) throw new Error('bookmark_not_found')
  // Pinned to the account the scope named, so a switch mid-way fails instead of reaching the next one.
  await deletePulseBookmark(message.id, undefined, account)
  if (account && !privateBrowsing(sender)) {
    await personalTransaction(scope, data => {
      if (!(message.id in data.notes) && !data.replayDeltas?.[message.id]) return data
      const replayDeltas = { ...data.replayDeltas }
      delete replayDeltas[message.id]
      return { ...dropNote(data), ...(data.replayDeltas ? { replayDeltas } : {}) }
    })
    await dropPictureUnlessWatched(scope, bookmarkIdentity(removed))
  }
  return { type: 'REMOVE_BOOKMARK', ok: true }
}
/** A removed save's picture goes too, unless History still lists that moment. */
async function dropPictureUnlessWatched(scope: string, key: string): Promise<void> {
  try {
    if (!(await personalTransaction(scope)).history.some(m => identity(m) === key)) await momentPictures.drop(scope, key)
  } catch { /* it goes at the next My Moments load instead */ }
}
/** Whether `scope` still saves `key` or lists it in History, so a watched moment may keep its picture. */
async function pictureListed(scope: string, key: string, moment: PictureMoment): Promise<boolean> {
  const data = await personalTransaction(scope)
  if (data.history.some(m => identity(m) === key) || data.bookmarks.some(b => bookmarkIdentity(b) === key)) return true
  const account = scopeAccount(scope)
  if (!account) return false
  const page = await fetchPulseBookmarks({ login: moment.channel, ...(moment.streamId ? { streamId: moment.streamId } : { vodId: moment.vodId ?? undefined }), limit: 100 }, undefined, account)
  return page.items.some(b => bookmarkIdentity(b) === key)
}
/**
 * A save the panel made in the account (the hosted path) keeps the panel's VOD
 * origin delta on this device, beside its id: the hosted bookmark cannot hold
 * it. `vodId`: the VOD the delta was sent for; a saved bookmark naming another
 * keeps none. Never fails the save.
 */
export async function keepSaveDelta(item: PulseBookmark, vodId: string | undefined, raw: unknown, sender: chrome.runtime.MessageSender): Promise<void> {
  if (raw === undefined || !vodId || item.vodId !== vodId || privateBrowsing(sender)) return
  try {
    const { scope, held } = await resolveScope()
    if (held || !scopeAccount(scope)) return
    await personalTransaction(scope, data => keepReplayDelta(data, item.id, item.vodId, raw))
  } catch { /* the save stands; its link keeps the stream's second */ }
}
const pictureMoment = (m: MomentReference): PictureMoment => ({ channel: m.channel, vodId: m.vodId, streamId: m.streamId, offsetSeconds: m.offsetSeconds ?? -1 })
/**
 * A bookmark saved from a Twitch tab keeps the frame that tab holds of its
 * moment, if any (Moment pictures on, not a private window). Never fails the save.
 */
export async function wantSavedPicture(saved: SaveBookmarkMessage['bookmark'], sender: chrome.runtime.MessageSender): Promise<void> {
  if (privateBrowsing(sender) || !saved.login) return
  try {
    const { scope, held } = await resolveScope()
    if (held) return
    const moment = { channel: saved.login, vodId: saved.vodId ?? null, streamId: saved.streamId, offsetSeconds: saved.offsetSeconds }
    await wantPicture(sender, moment, scope, identity(moment), { owned: true, waitMs: 20_000 })
  } catch { /* the save stands without a picture */ }
}
export async function handlePicture(message: Exclude<MomentPictureRequest, { action: 'vod' | 'vodFrame' }>, sender: chrome.runtime.MessageSender) {
  if (privateBrowsing(sender)) return { type: 'MOMENT_PICTURE' as const, ok: false }
  return handleMomentPicture(message, sender, pictureListed)
}
/** How long the panel's Undo can bring a removed bookmark's note back. */
const UNDO_NOTE_MS = 2 * 60 * 1000
/**
 * Notes the panel's removes took with them, by removed id. Only this worker
 * holds them: the Twitch page never reads one, a note an account keeps on
 * this device is never uploaded, and a worker restart forgets them.
 */
const removedNotes = new Map<string, { scope: string; key: string; note: string; at: number }>()
function keepRemovedNote(scope: string, b: PulseBookmark, note: string) {
  const now = Date.now()
  for (const [id, kept] of removedNotes) if (now - kept.at > UNDO_NOTE_MS) removedNotes.delete(id)
  removedNotes.set(b.id, { scope, key: bookmarkIdentity(b), note, at: now })
}
/**
 * The panel's Undo saved a removed bookmark again: the note this device kept
 * for it moves to the new save, when that is the same moment in the same
 * scope and the remove was recent. The save stands either way.
 */
export async function restoreRemovedNote(removedId: string, item: PulseBookmark, sender: chrome.runtime.MessageSender): Promise<void> {
  const kept = removedNotes.get(removedId)
  removedNotes.delete(removedId)
  if (!kept || privateBrowsing(sender) || Date.now() - kept.at > UNDO_NOTE_MS || kept.key !== bookmarkIdentity(item)) return
  try {
    if (kept.scope !== await currentScope()) return
    await personalTransaction(kept.scope, data => data.notes[item.id] ? data : { ...data, notes: { ...data.notes, [item.id]: kept.note } })
  } catch {
    // Only the note stays behind.
  }
}
const reference = (m: MomentReference): MomentReference => ({ id: m.id, channel: m.channel, title: m.title, vodId: m.vodId, streamId: m.streamId,
  offsetSeconds: m.offsetSeconds, ...(m.vodOriginDeltaSeconds === undefined ? {} : { vodOriginDeltaSeconds: m.vodOriginDeltaSeconds }), availability: replayAvailability(m) })
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
        // A 2xx without the new bookmark's id is no receipt: keep the save here.
        if (typeof created?.id !== 'string' || !created.id) throw new Error('Bookmark not confirmed')
        hostedId = created.id
        inAccount.set(key, hostedId)
      }
    } catch (error) {
      if (error instanceof Error && /connection changed/.test(error.message)) throw error
      throw new Error(added
        ? `Added ${added} of ${chosen.length} to your account. The rest stay on this device; try again shortly.`
        : 'Could not add to your account. Your saves stay on this device; try again shortly.')
    }
    const note = b.notes
    if (note && hostedId) await personalTransaction(scope, data => data.notes[hostedId!] ? data : { ...data, notes: { ...data.notes, [hostedId!]: note } })
    // Its delta moves with it, kept beside the hosted id.
    if (b.vodOriginDeltaSeconds !== undefined && hostedId) await personalTransaction(scope, data => keepReplayDelta(data, hostedId!, b.vodId, b.vodOriginDeltaSeconds))
    await personalTransaction(deviceScope(scope), data => {
      const notes = { ...data.notes }
      delete notes[b.id]
      return { ...data, notes, bookmarks: data.bookmarks.filter(item => item.id !== b.id) }
    })
    await momentPictures.move(deviceScope(scope), scope, key).catch(() => undefined)
    added++
  }
}
let queue: Promise<unknown> = Promise.resolve()
/**
 * This device left the account by an explicit, confirmed Sign out or Sign out
 * everywhere: its copy of that account's watched history and notes goes. A
 * credential the server rejects (401) or a relink keeps the copy.
 * Saves made without an account (the `|local` scope) stay. Queued behind any
 * My Moments request already under way, so none can write the copy back.
 */
export function forgetAccountScope(accountId: string): Promise<void> {
  // A history push scheduled for the account it just left is dropped too.
  clearTimeout(syncTimer)
  const scope = `${DEFAULT_BACKEND_URL}|account:${accountId}`
  const run = queue.then(async () => {
    await momentPictures.dropScope(scope).catch(() => undefined)
    await deletePersonal(scope)
  })
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
        // A browser that joined or was reinstalled into an account that syncs
        // learns it at its first Pulse jump too, not only when My Moments opens.
        const account = scopeAccount(scope)
        if (account && historySyncCheckDue(await personalTransaction(scope))) await within(refreshHistorySync(scope, account), 3000)
        const data = await personalTransaction(scope)
        // A jump or arrival on a saved moment gives the save the picture it lacks.
        if (message.reference && !held) void wantPicture(sender, pictureMoment(message.reference), scope, identity(message.reference), { owned: false, waitMs: 180_000 }).catch(() => undefined)
        return { type: 'MOMENT_CAPTURE', enabled: data.preferences.captureHistory, epoch: data.epoch }
      }
      const ref = message.reference
      // The page the jump was watched on: its channel (any capitals, trailing slash) or the VOD it names.
      const path = new URL(sender.tab?.url ?? 'https://invalid/').pathname.replace(/\/+$/, '').toLowerCase()
      if (path !== `/videos/${ref.vodId}` && path !== `/${ref.channel.toLowerCase()}`) throw new Error('Source changed')
      await assertScope(scope)
      const at = Date.now()
      const saved = await personalTransaction(scope, data => recordWatched(data, { ...ref, id: identity(ref), note: '' }, message.epoch, at))
      // History turned off, or cleared since the jump: nothing joined it, so the
      // panel must not say "Added to History".
      if (!saved.history.some(m => m.id === identity(ref) && m.jumpedAt === at)) return { ok: false }
      // History keeps a picture of what was watched, as a save does.
      if (!held) void wantPicture(sender, pictureMoment(ref), scope, identity(ref), { owned: false, waitMs: 60_000 }).catch(() => undefined)
      // An open My Moments page shows it without a reload; with none open, nobody listens.
      void Promise.resolve().then(() => chrome.runtime.sendMessage({ type: MY_MOMENTS_CHANGED })).catch(() => undefined)
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
    if (message.action === 'load') {
      const view = await snapshot(scope)
      // Read again only after a link was stored, which happens once per such save.
      const linked = await within(linkReplays(scope, view).catch(() => false), 4000)
      return { type: 'MY_MOMENTS', snapshot: linked ? await snapshot(scope) : view }
    }
    if (message.action === 'mutate') {
      if (message.scope !== scope) throw new Error('Device connection changed. Reload My Moments.')
      const command = message.command
      if (command.kind === 'save' && held) {
        // Still connected; a device save here would leave the account's list.
        throw new Error('Could not reach StreamPulse. Try saving again shortly.')
      } else if (command.kind === 'save' && !scopeAccount(scope)) {
        // No account: the save stays in this database and is never uploaded.
        const r = command.reference
        await personalTransaction(scope, data => addDeviceBookmark(data, { login: r.channel, streamId: r.streamId, vodId: r.vodId ?? undefined, offsetSeconds: r.offsetSeconds!, label: r.title,
          vodOriginDeltaSeconds: r.vodOriginDeltaSeconds }, Date.now()))
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
          const created = await createPulseBookmark({ login: r.channel, streamId: r.streamId, vodId: r.vodId ?? undefined, offsetSeconds: Math.floor(r.offsetSeconds!), label: r.title.slice(0, 160), source: 'extension' }, undefined, scopeAccount(scope))
          // The hosted bookmark cannot hold the delta: it stays on this device, beside the new id.
          if (r.vodOriginDeltaSeconds !== undefined && typeof created?.id === 'string' && created.id && created.vodId === (r.vodId ?? undefined)) {
            await personalTransaction(scope, data => keepReplayDelta(data, created.id, created.vodId, r.vodOriginDeltaSeconds))
          }
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
          const replayLinks = { ...data.replayLinks }
          const replayDeltas = { ...data.replayDeltas }
          if (command.kind === 'edit') notes[command.id] = command.note
          else { delete notes[command.id]; delete replayLinks[command.id]; delete replayDeltas[command.id] }
          return { ...data, notes, ...(data.replayLinks ? { replayLinks } : {}), ...(data.replayDeltas ? { replayDeltas } : {}), bookmarks: command.kind === 'unsave' ? data.bookmarks.filter(b => b.id !== command.id) : data.bookmarks }
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
