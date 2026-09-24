import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Reveal new identities once; polling, artwork enrichment and filtering stay still. */
export function useCollectionArrival(root: RefObject<HTMLElement | null>, identitySignature: string) {
  const seen = useRef(new Set<string>())
  const running = useRef(new Set<Animation>())
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let order = 0
    root.current?.querySelectorAll<HTMLElement>('[data-arrival-key]').forEach(element => {
      const key = element.dataset.arrivalKey!
      if (seen.current.has(key)) return
      seen.current.add(key)
      if (media.matches || order >= 12 || typeof element.animate !== 'function' || element.contains(document.activeElement)) return
      const animation = element.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 220, delay: Math.min(order++, 5) * 24, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' },
      )
      running.current.add(animation)
      animation.finished.then(() => running.current.delete(animation), () => running.current.delete(animation))
    })
    // Long archive browsing must not grow a lifetime identity list without bound.
    while (seen.current.size > 1000) seen.current.delete(seen.current.values().next().value!)
  }, [root, identitySignature])
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cancel = () => { running.current.forEach(animation => animation.cancel()); running.current.clear() }
    const changed = () => { if (media.matches) cancel() }
    media.addEventListener('change', changed)
    return () => { media.removeEventListener('change', changed); cancel(); seen.current.clear() }
  }, [])
}
