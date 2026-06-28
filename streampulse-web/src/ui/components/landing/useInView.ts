import { useEffect, useRef, useState } from 'react'

export function useInView() {
  const ref = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, inView }
}