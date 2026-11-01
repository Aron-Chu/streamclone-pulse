import { reviewDestination } from '../shared/reviewDestination.ts'

export const REVIEW_REQUEST_KEY = 'pulseReviewRequest.v1'
export const REVIEW_BOOKMARK_THRESHOLD = 3
interface ReviewRequestState { bookmarks: number; offered: boolean }
type LocalStore = Pick<typeof chrome.storage.local, 'get' | 'set'>

function readState(value: unknown): ReviewRequestState | null {
  if (value === undefined) return { bookmarks: 0, offered: false }
  if (!value || typeof value !== 'object') return null
  const state = value as Partial<ReviewRequestState>
  return Number.isInteger(state.bookmarks) && state.bookmarks! >= 0 && state.bookmarks! <= REVIEW_BOOKMARK_THRESHOLD && typeof state.offered === 'boolean'
    ? { bookmarks: state.bookmarks!, offered: state.offered }
    : null
}

/** One worker serializes increments across tabs. Never keep bookmark or user identity. */
let tail: Promise<unknown> = Promise.resolve()
export function recordNewDeviceBookmark(storage: LocalStore | undefined = globalThis.chrome?.storage?.local): Promise<boolean> {
  const work = tail.catch(() => undefined).then(async () => {
    if (!storage || !reviewDestination()) return false
    try {
      const state = readState((await storage.get(REVIEW_REQUEST_KEY))[REVIEW_REQUEST_KEY])
      if (!state || state.offered) return false
      const bookmarks = Math.min(REVIEW_BOOKMARK_THRESHOLD, state.bookmarks + 1)
      const offered = bookmarks === REVIEW_BOOKMARK_THRESHOLD
      // Consume the one-time offer before showing it: a reload, failed dismissal
      // write or lost UI response cannot cause another request later.
      await storage.set({ [REVIEW_REQUEST_KEY]: { bookmarks, offered } })
      return offered
    } catch { return false } // Optional review requests must never fail a save.
  })
  tail = work
  return work
}
