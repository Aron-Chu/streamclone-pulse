import { useCallback, useEffect, useRef, useState } from 'react'
import { supporterOfferFromReply, type SupporterOffer } from '../shared/supporterOffer.ts'

/** Focus re-asks the worker at most this often; the worker's own cache decides whether to fetch. */
export const OFFER_WAKE_DEBOUNCE_MS = 60_000

/**
 * The public sales switch for settings surfaces, from the worker
 * (SUPPORTER_OFFER). Opening settings asks with `refresh`, so an answer older
 * than a minute is re-read; returning to the page asks again at most once a
 * minute. `null` until the first answer, which every surface renders exactly
 * like closed: no purchase control appears before the worker says open.
 */
export function useSupporterOffer(): { offer: SupporterOffer | null; recheck: () => Promise<void>; checking: boolean } {
  const [offer, setOffer] = useState<SupporterOffer | null>(null)
  const [checking, setChecking] = useState(false)
  const request = useRef(0)
  const lastRead = useRef(Number.NEGATIVE_INFINITY)

  const read = useCallback(async (refresh: boolean) => {
    const id = ++request.current
    lastRead.current = performance.now()
    let next: SupporterOffer
    try {
      const reply: unknown = await chrome.runtime.sendMessage(refresh ? { type: 'SUPPORTER_OFFER', refresh: true } : { type: 'SUPPORTER_OFFER' })
      next = supporterOfferFromReply(reply)
    } catch {
      next = { state: 'unknown' }
    }
    if (id === request.current) setOffer(next)
  }, [])

  const recheck = useCallback(async () => {
    setChecking(true)
    try { await read(true) } finally { setChecking(false) }
  }, [read])

  useEffect(() => {
    void read(true)
    const wake = () => {
      if (document.hidden) return
      if (performance.now() - lastRead.current >= OFFER_WAKE_DEBOUNCE_MS) void read(true)
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      request.current++
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [read])

  return { offer, recheck, checking }
}
