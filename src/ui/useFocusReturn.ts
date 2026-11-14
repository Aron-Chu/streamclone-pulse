import { useEffect, useRef } from 'react'

/**
 * J1: a control that answers or closes something hands focus back to the
 * control that held it when that something appeared (or changed `key`), not
 * to the page. Attach the ref to the thing; call the function to go back.
 */
export function useFocusReturn<T extends HTMLElement>(key?: unknown) {
  const ref = useRef<T>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const active = (ref.current?.getRootNode() as Document | undefined)?.activeElement as HTMLElement | null
    if (!ref.current?.contains(active)) opener.current = active
  }, [key])
  return [ref, () => opener.current?.focus()] as const
}
