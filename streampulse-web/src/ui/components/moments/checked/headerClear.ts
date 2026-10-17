/** The mockup's header clearance; the portal's own header is shorter on a wide screen. */
const MIN_CLEAR = 64

/**
 * How far down the page's content starts under the portal's sticky header
 * (56 px wide, 159 px at 390 px), at least the mockup's 64: every scroll
 * offset reads this, and the page's CSS reads it as --mk-top.
 */
export function headerClear(): number {
  const bar = document.querySelector('.analytics-topnav')
  return Math.max(MIN_CLEAR, Math.round(bar ? bar.getBoundingClientRect().bottom : 0))
}

/** Keeps --mk-top on `el` at the header's clearance while the header changes height. */
export function watchHeaderClear(el: HTMLElement): () => void {
  const bar = document.querySelector('.analytics-topnav')
  const set = () => el.style.setProperty('--mk-top', `${Math.max(MIN_CLEAR, Math.round(bar ? bar.getBoundingClientRect().height : 0))}px`)
  set()
  if (!bar || typeof ResizeObserver !== 'function') return () => undefined
  const observer = new ResizeObserver(set)
  observer.observe(bar)
  return () => observer.disconnect()
}
