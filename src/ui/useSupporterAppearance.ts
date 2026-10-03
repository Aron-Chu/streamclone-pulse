import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { ACCOUNT_REVISION_KEY, SUPPORTER_REVISION_KEY } from '../shared/supporterAccount.ts'
import type { supporterFinish } from './supporterFinish.ts'

type Finish = keyof typeof supporterFinish
type AppearanceReply = Awaited<ReturnType<typeof sendBackgroundMessage>> | null | undefined

/** With no verified accent, check again at most once a minute. */
export const APPEARANCE_RECHECK_MS = 60_000
/** Renew a verified accent this long before it lapses, so it never blinks off. */
export const APPEARANCE_RENEW_LEAD_MS = 5_000
/** Never renew a short-lived accent more often than this. */
export const APPEARANCE_MIN_RENEW_MS = 15_000
/** Focus and visibility changes refresh only when the last check is at least this old. */
export const APPEARANCE_WAKE_DEBOUNCE_MS = 10_000

const requestAppearance = () => sendBackgroundMessage({ type: 'SUPPORTER_APPEARANCE' })

/**
 * The equipped Supporter finish for the header, verified by the worker.
 *
 * A verified accent stays until its validity lapses: refreshing never clears
 * it first, and a failed refresh leaves it to its own expiry. Hidden tabs do
 * not poll; they check again when shown. The worker's non-secret change
 * signals (a verified purchase, a saved finish, a revoked or switched account)
 * trigger an immediate check, so an open Twitch tab never needs a reload.
 */
export function useSupporterAppearance(request: () => Promise<AppearanceReply> = requestAppearance): Finish | null {
  const [finish, setFinish] = useState<Finish | null>(null)
  useEffect(() => {
    let alive = true
    let running = false
    let again = false
    let signalledWhileHidden = false
    let lastStart = Number.NEGATIVE_INFINITY
    let expiry: number | undefined
    let next: number | undefined
    const schedule = (delay: number) => {
      window.clearTimeout(next)
      next = window.setTimeout(() => { next = undefined; void refresh() }, delay)
    }
    const refresh = async (initial = false) => {
      if (!alive) return
      if (running) { again = true; return }
      window.clearTimeout(next)
      next = undefined
      // A hidden tab stops polling here and waits for `wake`. The first check
      // still runs, so a tab opened in the background is ready when shown.
      if (document.hidden && !initial) return
      running = true
      const started = performance.now()
      lastStart = started
      let delay = APPEARANCE_RECHECK_MS
      try {
        const result = await request()
        if (alive && result && 'type' in result && result.type === 'SUPPORTER_APPEARANCE') {
          const remaining = Math.min(60_000, result.validForMs) - (performance.now() - started)
          window.clearTimeout(expiry)
          if (result.finish && Number.isFinite(remaining) && remaining > 0) {
            setFinish(result.finish)
            expiry = window.setTimeout(() => setFinish(null), remaining)
            delay = Math.max(APPEARANCE_MIN_RENEW_MS, remaining - APPEARANCE_RENEW_LEAD_MS)
          } else {
            setFinish(null)
          }
        }
      } catch { /* Keep a verified accent only until its own expiry. */ }
      finally {
        running = false
        if (alive && again) { again = false; void refresh() }
        else if (alive) schedule(delay)
      }
    }
    const signalled = (changes: Record<string, chrome.storage.StorageChange>, area?: string) => {
      if (area && area !== 'local') return
      if (!(ACCOUNT_REVISION_KEY in changes || SUPPORTER_REVISION_KEY in changes)) return
      // A hidden tab catches up as soon as it is shown, without the wake debounce.
      if (document.hidden) signalledWhileHidden = true
      else void refresh()
    }
    const storage = typeof chrome === 'undefined' ? undefined : chrome.storage?.onChanged
    const wake = () => {
      if (document.hidden) return
      const since = performance.now() - lastStart
      if (signalledWhileHidden || since >= APPEARANCE_WAKE_DEBOUNCE_MS) { signalledWhileHidden = false; void refresh() }
      else if (next === undefined && !running) schedule(APPEARANCE_WAKE_DEBOUNCE_MS - since)
    }
    void refresh(true)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    storage?.addListener(signalled)
    return () => {
      alive = false
      storage?.removeListener(signalled)
      window.clearTimeout(expiry)
      window.clearTimeout(next)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [request])
  return finish
}
