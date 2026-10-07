import { useEffect, useLayoutEffect, useRef } from 'react'
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom'
import { hashTargetId, holdHashScroll, routeScrollIntent, scrollToHashTarget } from '../lib/routeScroll'

interface SeenLocation {
  entry: string
  pathname: string
  search: string
  hash: string
}

/** History entries whose place is remembered, oldest dropped first. */
const MAX_PLACES = 50

/**
 * The current history entry, as only Back or Forward can return to it, or null
 * when a new entry could share it. React Router keys the first entry and every
 * native #fragment entry 'default', so its key cannot tell a second click on a
 * native #link from Back to the first one.
 */
function historyEntry(key: string, url: string): string | null {
  // The Navigation API gives every entry its own id, which a new entry never has.
  const id = (window as { navigation?: { currentEntry?: { id?: unknown } | null } }).navigation?.currentEntry?.id
  if (typeof id === 'string' && id) return `${id} ${url}`
  // Otherwise only React Router's entries are told apart: it stamps them, the
  // first one included, in history.state; a native #fragment entry has none.
  return window.history.state == null ? null : `${key} ${url}`
}

/**
 * One scroll owner for route changes. A pushed page opens at the top, or at its
 * `#target` once that has rendered; a replaced page keeps the reader's place
 * unless it names a `#target`; the first document load lands its hash the same
 * way. Navigation state can ask otherwise (`routeScrollState`). Back/Forward is
 * left to the browser, which restores the position the reader had on that
 * history entry, except that a `#target` the reader left returns to the same
 * place once it has rendered.
 */
export function RouteScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const intent = routeScrollIntent(location.state)
  const current = useRef<SeenLocation | null>(null)
  const previous = useRef<SeenLocation | null>(null)
  // Where the reader left each hashed entry: its #target's offset from the viewport top.
  const places = useRef(new Map<string, number>())
  const following = useRef<{ entry: string; id: string } | null>(null)

  useEffect(() => {
    const record = () => {
      const seen = following.current
      const target = seen ? document.getElementById(seen.id) : null
      if (!seen || !target) return
      places.current.delete(seen.entry)
      places.current.set(seen.entry, target.getBoundingClientRect().top)
      const oldest = places.current.keys().next().value
      if (places.current.size > MAX_PLACES && oldest !== undefined) places.current.delete(oldest)
    }
    // A traversal scrolls before the router commits its entry; that is not where
    // the reader left the entry still on screen.
    const pause = () => {
      following.current = null
    }
    window.addEventListener('scroll', record, { passive: true })
    window.addEventListener('popstate', pause)
    return () => {
      window.removeEventListener('scroll', record)
      window.removeEventListener('popstate', pause)
    }
  }, [])

  useLayoutEffect(() => {
    const url = `${location.pathname}${location.search}${location.hash}`
    // Keyed by location, so a StrictMode effect replay is not read as a navigation.
    const seen = `${location.key} ${url}`
    if (current.current?.entry !== seen) {
      previous.current = current.current
      current.current = { entry: seen, pathname: location.pathname, search: location.search, hash: location.hash }
    }
    const from = previous.current
    const id = hashTargetId(location.hash)
    const entry = id ? historyEntry(location.key, url) : null
    following.current = id && entry ? { entry, id } : null
    if (from && navigationType === NavigationType.Pop) {
      // The browser restores a raw offset, which misses when the content above
      // the target renders later or at another height (the hub's sections).
      const place = entry ? places.current.get(entry) : undefined
      return id && place !== undefined ? scrollToHashTarget(id, { top: place }) : undefined
    }
    const pathChanged = from !== null && from.pathname !== location.pathname
    // A page that replaces its own entry (a live broadcast becoming its session) keeps the reader's place.
    const toTop = navigationType === NavigationType.Push ? intent !== 'keep' : intent === 'top'
    // A link to the bare page from one of its #sections opens it at the top, as a document load does.
    // Dropping a deep-link fragment such as #t= (not a section) keeps the reader's place.
    const hashCleared = from !== null && navigationType === NavigationType.Push && !pathChanged
      && from.search === location.search && hashTargetId(from.hash) !== null && location.hash === ''
    if ((pathChanged && toTop) || hashCleared) window.scrollTo(0, 0)
    // A search-only update is in-page state (filters, ranges): keep the reader's place.
    if (from && !pathChanged && from.hash === location.hash) return
    if (!id) return
    return scrollToHashTarget(id, { smooth: from !== null && !pathChanged })
  }, [location.key, location.pathname, location.search, location.hash, navigationType, intent])

  return null
}

/** Hold a cold `#target` landing until this page's sections have their real content. */
export function useHashScrollHold(pending: boolean): void {
  useLayoutEffect(() => (pending ? holdHashScroll() : undefined), [pending])
}
