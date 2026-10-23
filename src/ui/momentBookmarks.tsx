import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import { sendBackgroundMessage } from '../content/bridge.ts'
import type { CreatePulseBookmarkInput, PulseBookmark } from '../shared/messages.ts'
import { TWITCH_SIGNIN_ENABLED } from '../shared/twitchSignIn.ts'

/** What a moment card saves: the ranked moment it shows, or its raw chart minute (no score). */
export interface BookmarkTarget {
  kind: 'moment' | 'minute'
  offsetSeconds: number
  label: string
}

/**
 * A save stays with its moment within this window, as the chart's pins do, so
 * one that rescoring moved still shows as saved and is not saved twice.
 */
export const BOOKMARK_MATCH_SECONDS = 90

/**
 * The save a card or row shows. A minute owns the saves inside it; a moment,
 * the nearest save within the window that no other listed moment is nearer to.
 */
export function matchBookmark(
  items: readonly PulseBookmark[],
  target: Pick<BookmarkTarget, 'kind' | 'offsetSeconds'>,
  momentOffsets: readonly number[] = [],
): PulseBookmark | undefined {
  const at = Math.floor(target.offsetSeconds)
  const distance = (item: PulseBookmark) => Math.abs(item.offsetSeconds - at)
  let best: PulseBookmark | undefined
  for (const item of items) {
    const mine = target.kind === 'minute'
      ? item.offsetSeconds >= at && item.offsetSeconds < at + 60
      : distance(item) <= BOOKMARK_MATCH_SECONDS
        && !momentOffsets.some(other => Math.abs(item.offsetSeconds - other) < distance(item))
    if (mine && (!best || distance(item) < distance(best))) best = item
  }
  return best
}

export interface BookmarkToast {
  key: number
  text: string
  tone: 'info' | 'error'
  undo?: () => void
  /** Offers to connect an account (a save that needs one). */
  connect?: boolean
}

interface MomentBookmarksValue {
  /** False without a channel and a stream or VOD to save against; cards then show no bookmark. */
  canSave: boolean
  busy: boolean
  savedFor: (target: Pick<BookmarkTarget, 'kind' | 'offsetSeconds'>) => PulseBookmark | undefined
  /** Saves the target, or removes the save it shows. */
  toggle: (target: BookmarkTarget) => void
  toast: BookmarkToast | null
  dismissToast: () => void
  openSettings: (section: 'moments' | 'supporter') => void
}

const MomentBookmarksContext = createContext<MomentBookmarksValue | null>(null)

/** Null outside the panel (demo cards, tests): no bookmark is offered there. */
export const useMomentBookmarks = () => useContext(MomentBookmarksContext)

/** A private window keeps nothing on the device, so the worker sends its saves to an account. */
const privateWindow = () => !!globalThis.chrome?.extension?.inIncognitoContext

/** The worker could not save without a linked account (signed out in a private window, or a lapsed link). */
const needsAccount = (code: string) => /account_authorization_required|account_identity_changed/.test(code)

function problem(error: unknown): Pick<BookmarkToast, 'text' | 'connect'> {
  const code = error instanceof Error ? error.message : String(error ?? '')
  if (needsAccount(code)) {
    // With sign-in compiled off nobody can make an account: a private window
    // says so with no button, and only an invited tester whose link lapsed is
    // sent to settings to reconnect.
    if (!TWITCH_SIGNIN_ENABLED && privateWindow()) return { text: 'Private windows keep no bookmarks.' }
    return { text: TWITCH_SIGNIN_ENABLED ? 'Connect your free Pulse account to bookmark.' : 'Reconnect your account in settings to bookmark.', connect: true }
  }
  if (code === 'account_hosted_only') return { text: 'Bookmarks need the hosted StreamPulse connection.' }
  if (code === 'extension_context_invalidated') return { text: 'The extension was updated. Refresh this tab to bookmark.' }
  if (code === 'bookmark_not_found') return { text: 'That bookmark was already removed.' }
  return { text: 'Could not update this bookmark. Try again.' }
}

const SYNC_HINT_KEY = 'pulseBookmarkSyncHintShown'

/** True once per browser: the first save kept on this device says sign-in syncs it. */
async function firstDeviceSave(): Promise<boolean> {
  if (!TWITCH_SIGNIN_ENABLED) return false
  try {
    const local = globalThis.chrome?.storage?.local
    if (!local) return false
    if ((await local.get(SYNC_HINT_KEY))[SYNC_HINT_KEY]) return false
    await local.set({ [SYNC_HINT_KEY]: true })
    return true
  } catch {
    return false
  }
}

const NO_OFFSETS: readonly number[] = []

/**
 * Free, on-demand bookmarks for the panel's moment cards. Account credentials
 * never leave the worker; without an account it keeps saves on this device.
 *
 * One provider holds the saves of the stream or VOD the panel shows, so the
 * chart's card, the Top Moments card and the rows agree on what is saved.
 */
export function MomentBookmarksProvider({ login, streamId, vodId, resolveVodId, momentOffsets = NO_OFFSETS, notice, children }: {
  login: string
  streamId?: string
  vodId?: string
  /**
   * Live only: finds the live archive's VOD id. A save with only the stream
   * stays "Replay not linked" in My Moments for good (PAGE-1).
   */
  resolveVodId?: () => Promise<string | null>
  /** The listed moments' offsets, so a save near two goes to the nearer one. */
  momentOffsets?: readonly number[]
  /** Another note for the same slot, such as an arrival joining History; a new key shows it. */
  notice?: { key: number; text: string } | null
  children: ReactNode
}) {
  const [items, setItems] = useState<PulseBookmark[]>([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<BookmarkToast | null>(null)
  const generation = useRef(0)
  const pending = useRef(false)
  const toastKey = useRef(0)
  const validVodId = vodId && /^\d+$/.test(vodId) ? vodId : undefined
  const canSave = Boolean(login && (streamId || validVodId))
  const filter = { login, streamId, vodId: streamId ? undefined : validVodId, contextVodId: validVodId }
  const inContext = (item: PulseBookmark) => (streamId ? item.streamId === streamId : item.vodId === validVodId)
  const offsetsRef = useRef(momentOffsets)
  offsetsRef.current = momentOffsets
  const resolveRef = useRef(resolveVodId)
  resolveRef.current = resolveVodId

  useEffect(() => {
    let active = true
    const reset = () => {
      generation.current++
      pending.current = false
      setItems([]); setToast(null); setBusy(false)
    }
    const hydrate = () => {
      const current = generation.current
      if (!globalThis.chrome?.runtime?.id || !canSave) return
      // Display only. A signed-out or offline viewer still gets the bookmark;
      // a save reports what went wrong, and re-checks for duplicates first.
      void Promise.resolve(sendBackgroundMessage({ type: 'LIST_BOOKMARKS', ...filter, limit: 100 })).then(result => {
        if (!active || current !== generation.current || pending.current) return
        if ('type' in result && result.type === 'BOOKMARKS' && !result.error) {
          setItems(previous => {
            const merged = new Map(previous.map(item => [item.id, item]))
            for (const item of result.items) merged.set(item.id, item)
            return [...merged.values()]
          })
        }
      }).catch(() => undefined)
    }
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('pulseAccountRevision' in changes || 'backendUrl' in changes) { reset(); hydrate() }
    }
    reset()
    hydrate()
    const storage = globalThis.chrome?.storage?.onChanged
    storage?.addListener(changed)
    return () => { active = false; generation.current++; storage?.removeListener(changed) }
  }, [login, streamId, validVodId])

  const show = (next: Omit<BookmarkToast, 'key' | 'tone'> & { tone?: BookmarkToast['tone'] }) =>
    setToast({ tone: 'info', ...next, key: ++toastKey.current })

  useEffect(() => {
    if (notice) show({ text: notice.text })
  }, [notice?.key])

  /** Runs one bookmark change at a time; a change of account or stream drops its result. */
  async function run(work: (current: number) => Promise<void>) {
    if (pending.current) return
    const current = generation.current
    pending.current = true
    setBusy(true)
    try {
      await work(current)
    } catch (cause) {
      if (current === generation.current) show({ ...problem(cause), tone: 'error' })
    } finally {
      if (current === generation.current) { pending.current = false; setBusy(false) }
    }
  }

  async function create(input: CreatePulseBookmarkInput, current: number, restoreOf?: string) {
    const result = await sendBackgroundMessage({ type: 'SAVE_BOOKMARK', bookmark: input, ...(restoreOf ? { restoreOf } : {}) })
    if (current !== generation.current) return null
    if ('error' in result && result.error) throw new Error(result.error)
    if (!('type' in result) || result.type !== 'BOOKMARK') throw new Error('invalid_bookmark_response')
    setItems(previous => [result.item, ...previous.filter(item => item.id !== result.item.id)])
    return { item: result.item, device: result.device === true }
  }

  async function remove(item: PulseBookmark, current: number) {
    const result = await sendBackgroundMessage({ type: 'REMOVE_BOOKMARK', id: item.id, login: item.login,
      ...(item.streamId ? { streamId: item.streamId } : {}), ...(item.vodId ? { vodId: item.vodId } : {}),
      ...(validVodId ? { contextVodId: validVodId } : {}) })
    if (current !== generation.current) return false
    if ('error' in result && result.error) throw new Error(result.error)
    if (!('type' in result) || result.type !== 'REMOVE_BOOKMARK') throw new Error('invalid_bookmark_response')
    setItems(previous => previous.filter(other => other.id !== item.id))
    return true
  }

  // The account's note comes back with the save; the worker puts back the note it kept on this device.
  const restore = (item: PulseBookmark) => run(async current => {
    const restored = await create({ login: item.login, ...(item.streamId ? { streamId: item.streamId } : {}),
      ...(item.vodId ? { vodId: item.vodId } : {}), offsetSeconds: item.offsetSeconds, label: item.label,
      ...(item.notes ? { notes: item.notes } : {}), source: 'extension' }, current, item.id)
    if (restored) setToast(null)
  })

  const unsave = (item: PulseBookmark, undoing = false) => run(async current => {
    if (!await remove(item, current)) return
    if (undoing) setToast(null)
    else show({ text: `Removed bookmark at ${formatHeatOffset(item.offsetSeconds)}.`, undo: () => void restore(item) })
  })

  const save = (target: BookmarkTarget) => run(async current => {
    const offset = Math.floor(target.offsetSeconds)
    if (!Number.isFinite(offset) || offset < 0) return
    // Every page, so a reload or an uncertain earlier answer never saves the
    // same moment twice.
    let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const result = await sendBackgroundMessage({ type: 'LIST_BOOKMARKS', ...filter, limit: 100, ...(cursor ? { cursor } : {}) })
      if (current !== generation.current) return
      if ('error' in result && result.error) throw new Error(result.error)
      if (!('type' in result) || result.type !== 'BOOKMARKS') throw new Error('invalid_bookmark_response')
      const existing = matchBookmark(result.items.filter(inContext), target, offsetsRef.current)
      if (existing) {
        setItems(previous => [...previous.filter(item => item.id !== existing.id), existing])
        show({ text: `Already bookmarked at ${formatHeatOffset(existing.offsetSeconds)}.` })
        return
      }
      cursor = result.nextCursor
      if (cursor && (seen.has(cursor) || seen.size >= 50)) throw new Error('invalid_bookmark_pagination')
      if (cursor) seen.add(cursor)
    } while (cursor)

    // Without an archive id the save still goes through, stream-only.
    const archiveId = validVodId ?? (streamId && resolveRef.current ? await resolveRef.current().catch(() => null) : null)
    if (current !== generation.current) return
    const saveVodId = archiveId && /^\d+$/.test(archiveId) ? archiveId : undefined
    const saved = await create({ login, streamId, ...(saveVodId ? { vodId: saveVodId } : {}), offsetSeconds: offset,
      label: target.label, source: 'extension' }, current)
    if (!saved) return
    const at = formatHeatOffset(offset)
    const text = !saved.device ? `Saved to your account at ${at}.`
      : await firstDeviceSave() ? 'Saved on this device · Sign in to sync' : `Saved on this device at ${at}.`
    if (current !== generation.current) return
    show({ text, undo: () => void unsave(saved.item, true) })
  })

  const scoped = items.filter(inContext)
  const value = useMemo<MomentBookmarksValue>(() => ({
    canSave,
    busy,
    savedFor: target => matchBookmark(scoped, target, momentOffsets),
    toggle: target => {
      const existing = matchBookmark(scoped, target, offsetsRef.current)
      void (existing ? unsave(existing) : save(target))
    },
    toast,
    dismissToast: () => setToast(null),
    openSettings: section => {
      void Promise.resolve(sendBackgroundMessage({ type: 'OPEN_SETTINGS_HOST', section })).then(result => {
        if ('error' in result && result.error) throw new Error(result.error)
      }).catch(() => show({ text: 'Could not open settings. Try again.', tone: 'error' }))
    },
    // The handlers read refs, or what these change with.
  }), [items, busy, toast, canSave, momentOffsets, login, streamId, validVodId])

  return <MomentBookmarksContext.Provider value={value}>{children}</MomentBookmarksContext.Provider>
}

/** The bookmark mark: an outline to save, filled once saved. */
export function BookmarkGlyph({ filled, size = 15 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  )
}

/** My Moments, from a moments heading. Nothing outside the panel. */
export function MyMomentsLink() {
  const bookmarks = useMomentBookmarks()
  if (!bookmarks) return null
  return (
    <button
      type="button"
      className="pulse-my-moments-link"
      data-chart-action="true"
      data-moment-action="open-library"
      title="Open your bookmarks and history"
      onClick={() => bookmarks.openSettings('moments')}
    >
      My Moments
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
    </button>
  )
}

/**
 * Where a save went, with Undo. It floats over the bottom of the panel, so
 * nothing above it moves, and it waits while the pointer or focus is on it.
 */
export function MomentBookmarkToast() {
  const bookmarks = useMomentBookmarks()
  const toast = bookmarks?.toast ?? null
  const [held, setHeld] = useState(false)
  const dismiss = bookmarks?.dismissToast
  useEffect(() => {
    if (!toast || held || !dismiss) return
    const timer = setTimeout(dismiss, toast.tone === 'error' ? 8000 : 4200)
    return () => clearTimeout(timer)
  }, [toast, held, dismiss])
  useEffect(() => setHeld(false), [toast?.key])
  if (!bookmarks) return null
  return (
    <div className="pulse-bookmark-toast-anchor" data-chart-action="true" aria-live="polite">
      {toast ? (
        <div
          key={toast.key}
          className="pulse-bookmark-toast"
          role={toast.tone === 'error' ? 'alert' : 'status'}
          data-bookmark-toast={toast.tone}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <span className="pulse-bookmark-toast-text">{toast.text}</span>
          {toast.undo ? (
            <button type="button" data-bookmark-toast-action="undo" onClick={toast.undo}>Undo</button>
          ) : null}
          {toast.connect ? (
            <button type="button" data-moment-action="connect-account" onClick={() => bookmarks.openSettings('supporter')}>
              {TWITCH_SIGNIN_ENABLED ? 'Connect' : 'Settings'}
            </button>
          ) : (
            <button type="button" data-bookmark-toast-action="library" onClick={() => bookmarks.openSettings('moments')}>My Moments</button>
          )}
        </div>
      ) : null}
    </div>
  )
}
