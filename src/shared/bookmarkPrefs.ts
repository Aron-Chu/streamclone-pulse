import { getBetaKey, isExtensionContextAlive } from './storage.ts'

const GUEST_BOOKMARK_EXPLAINER_SEEN_KEY = 'guestBookmarkExplainerSeen'

export const BOOKMARK_BUTTON_LABEL = 'Bookmark'
export const BOOKMARKING_BUTTON_LABEL = 'Saving…'

export const BOOKMARK_BETA_OK_TOAST = 'Moment bookmarked'
export const BOOKMARK_GUEST_PIN_TOAST = 'Sign in with a beta key to keep bookmarks across devices'

export const GUEST_BOOKMARK_EXPLAINER_COPY =
  'Bookmarks sync when you add a beta key in Pulse settings. You can still jump this moment on the VOD now.'
export const GUEST_BOOKMARK_EXPLAINER_ACTION = 'Got it'

export function hasBetaKey(betaKey: string | null | undefined): boolean {
  return Boolean(betaKey?.trim())
}

export async function getGuestBookmarkExplainerSeen(): Promise<boolean> {
  if (!isExtensionContextAlive()) return false
  try {
    const stored = await chrome.storage.sync.get(GUEST_BOOKMARK_EXPLAINER_SEEN_KEY)
    return Boolean(stored[GUEST_BOOKMARK_EXPLAINER_SEEN_KEY])
  } catch {
    return false
  }
}

export async function setGuestBookmarkExplainerSeen(seen: boolean): Promise<void> {
  if (!isExtensionContextAlive()) return
  try {
    await chrome.storage.sync.set({ [GUEST_BOOKMARK_EXPLAINER_SEEN_KEY]: seen })
  } catch {
    /* ignore quota / context errors */
  }
}

export function shouldShowGuestBookmarkExplainer(explainerSeen: boolean): boolean {
  return !explainerSeen
}

/** Convenience for callers that only have storage access. */
export async function resolveHasBetaKey(): Promise<boolean> {
  return hasBetaKey(await getBetaKey())
}
