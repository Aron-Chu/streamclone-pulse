import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Animate the measured content height, including late-arriving bucket data. */
export function InspectorReveal({ open, children }: { open: boolean; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null)
  const retained = useRef(children)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => { if (open) retained.current = children }, [open, children])
  useLayoutEffect(() => {
    if (!open) { setHeight(0); return }
    const element = content.current
    if (!element) return
    const measure = () => setHeight(element.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open])
  return <div className="inspector-reveal" data-open={open} aria-hidden={!open}
    {...(!open ? { inert: '' } : {})} style={{ height: `${height}px` }}>
    <div ref={content} className="inspector-reveal__content">{open ? children : retained.current}</div>
  </div>
}
