import { useCallback, useRef } from 'react'

/** A card a press inside anchors past, holding the content below it still. */
const SLOT = '.pulse-moment-slot'
/**
 * What may move the pressed element: the moment-card slots, and the 7TV
 * plot panel, which folds shut when a moment is selected. Nothing else is
 * corrected, so list expanders and other disclosures still grow downward.
 */
const TRACKED = '.pulse-moment-slot,.pulse-seven-tv-panel'
const PRESSABLE = 'button,a[href],[role="button"]'
/** How long a press keeps its target still while a card opens or closes. */
const SESSION_MS = 600
const QUIET_MS = 120
/** Never push the opening card above the panel's top edge, less this margin. */
const CARD_TOP_PAD = 8

function elementAfter(slot: Element, scroller: Element): Element | null {
  for (let node: Element | null = slot; node && node !== scroller; node = node.parentElement) {
    if (node.nextElementSibling) return node.nextElementSibling
  }
  return null
}

/** Total height of the tracked elements laid out before the anchor. */
function trackedHeightBefore(scroller: Element, anchor: Element): number {
  let height = 0
  for (const element of scroller.querySelectorAll(TRACKED)) {
    if (element.contains(anchor) || !(element.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
    height += element.getBoundingClientRect().height
  }
  return height
}

/**
 * Keep whatever the user pressed under the pointer while a moment card opens
 * or closes above it, by scrolling the panel instead of moving the content.
 *
 * The chart's card sits above the Top Moments list, so opening or closing it
 * moves the rows below (a row pick closes it). Each press records the pressed
 * element's position; every frame until the layout settles, any drift is
 * taken back out of `scrollTop`. Content above the card therefore moves up
 * ("the card expands up"), but the card itself is never scrolled out of view.
 * A press inside a card (its close button) holds the content below the card
 * still instead. The Top Moments card keeps its height, so it needs no
 * correction. Any scroll the user makes ends the correction.
 */
export function bindKeepPressedInPlace(scroller: HTMLElement): () => void {
  let anchor: Element | null = null
  let top = 0
  let trackedBase = 0
  let expected = 0
  let until = 0
  /** No session outlives this, whatever keeps moving underneath it. */
  let deadline = 0
  let frame = 0

  const stop = (): void => {
    if (!anchor) return
    cancelAnimationFrame(frame)
    scroller.removeAttribute('data-keep-in-place')
    anchor = null
  }
  const tick = (now: number): void => {
    if (!anchor) return
    if (!anchor.isConnected || Math.abs(scroller.scrollTop - expected) > 1) return stop()
    let drift = anchor.getBoundingClientRect().top - top
    // Only movement the tracked elements caused is taken back.
    const tracked = trackedHeightBefore(scroller, anchor) - trackedBase
    drift = drift > 0 ? Math.min(drift, Math.max(0, tracked)) : Math.max(drift, Math.min(0, tracked))
    if (drift > 0) {
      let slot: Element | null = null
      for (const candidate of scroller.querySelectorAll(SLOT)) {
        if (candidate.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING) slot = candidate
      }
      if (slot) {
        const room = slot.getBoundingClientRect().top - scroller.getBoundingClientRect().top - CARD_TOP_PAD
        drift = Math.min(drift, Math.max(0, room))
      }
    }
    if (Math.abs(drift) >= 0.5) {
      const before = scroller.scrollTop
      scroller.scrollTop = before + drift
      expected = scroller.scrollTop
      const applied = expected - before
      // The panel clamps at its top and bottom. Whatever it could not absorb is
      // the anchor's new resting place, not something to retry every frame.
      // Rounding scrollTop to device pixels is not a clamp: that remainder stays
      // in the drift for the next frame, or it adds up over the animation.
      if (Math.abs(drift - applied) >= 1) top += drift - applied
      trackedBase += applied
      if (Math.abs(applied) >= 0.5) until = Math.min(deadline, Math.max(until, now + QUIET_MS))
    }
    if (now > until) return stop()
    frame = requestAnimationFrame(tick)
  }
  const start = (target: EventTarget | null): void => {
    stop()
    if (!(target instanceof Element) || target === scroller) return
    const slot = target.closest(SLOT)
    anchor = slot ? elementAfter(slot, scroller) : (target.closest(PRESSABLE) ?? target)
    if (!anchor) return
    // Measured at pointerdown, before any handler can change the layout.
    top = anchor.getBoundingClientRect().top
    trackedBase = trackedHeightBefore(scroller, anchor)
    expected = scroller.scrollTop
    until = performance.now() + SESSION_MS
    deadline = until + SESSION_MS
    scroller.setAttribute('data-keep-in-place', '')
    frame = requestAnimationFrame(tick)
  }
  const down = (event: PointerEvent): void => {
    if (event.button === 0 && event.isPrimary) start(event.target)
  }
  // A long press can outlast the session before the click changes anything.
  const click = (event: MouseEvent): void => {
    if (anchor) {
      until = Math.max(until, performance.now() + SESSION_MS)
      deadline = Math.max(deadline, until + SESSION_MS)
    } else start(event.target)
  }
  const key = (event: KeyboardEvent): void => {
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element | null)?.closest?.(PRESSABLE)) start(event.target)
  }

  // Capture listeners inside the shadow tree see the real target even when
  // the root is closed, and run before the chart's outside-press handling.
  scroller.addEventListener('pointerdown', down, true)
  scroller.addEventListener('click', click, true)
  scroller.addEventListener('keydown', key, true)
  scroller.addEventListener('wheel', stop, { capture: true, passive: true })
  scroller.addEventListener('touchmove', stop, { capture: true, passive: true })
  return () => {
    stop()
    scroller.removeEventListener('pointerdown', down, true)
    scroller.removeEventListener('click', click, true)
    scroller.removeEventListener('keydown', key, true)
    scroller.removeEventListener('wheel', stop, true)
    scroller.removeEventListener('touchmove', stop, true)
  }
}

/** Callback ref for the panel's scroll container. */
export function useKeepPressedInPlace(): (node: HTMLElement | null) => void {
  const unbind = useRef<(() => void) | null>(null)
  return useCallback((node: HTMLElement | null) => {
    unbind.current?.()
    unbind.current = node ? bindKeepPressedInPlace(node) : null
  }, [])
}
