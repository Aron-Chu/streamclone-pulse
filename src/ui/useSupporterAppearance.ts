import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
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
 * The last finish the worker verified, shared by every mount until it lapses.
 * The header and quick settings take turns being mounted, so without this each
 * switch started blank and asked the worker again.
 */
let lastVerified: { finish: Finish; until: number } | null = null

function verifiedNow(): { finish: Finish; remaining: number } | null {
  const remaining = lastVerified ? lastVerified.until - performance.now() : 0
  return lastVerified && remaining > 0 ? { finish: lastVerified.finish, remaining } : null
}

/** Tests only: forget the shared verified finish. */
export function resetSupporterAppearanceForTests(): void {
  lastVerified = null
}

/**
 * The equipped Supporter finish for the header, verified by the worker.
 *
 * A verified accent stays until its validity lapses: refreshing never clears
 * it first, and a failed refresh leaves it to its own expiry. Hidden tabs do
 * not poll; they check again when shown.
 */
export function useSupporterAppearance(request: () => Promise<AppearanceReply> = requestAppearance): Finish | null {
  const [finish, setFinish] = useState<Finish | null>(() => verifiedNow()?.finish ?? null)
  useEffect(() => {
    let alive = true
    let running = false
    let lastStart = Number.NEGATIVE_INFINITY
    let expiry: number | undefined
    let next: number | undefined
    const schedule = (delay: number) => {
      window.clearTimeout(next)
      next = window.setTimeout(() => { next = undefined; void refresh() }, delay)
    }
    const refresh = async (initial = false) => {
      if (!alive || running) return
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
            lastVerified = { finish: result.finish, until: performance.now() + remaining }
            setFinish(result.finish)
            expiry = window.setTimeout(() => setFinish(null), remaining)
            delay = Math.max(APPEARANCE_MIN_RENEW_MS, remaining - APPEARANCE_RENEW_LEAD_MS)
          } else {
            lastVerified = null
            setFinish(null)
          }
        }
      } catch { /* Keep a verified accent only until its own expiry. */ }
      finally {
        running = false
        if (alive) schedule(delay)
      }
    }
    const wake = () => {
      if (document.hidden) return
      const since = performance.now() - lastStart
      if (since >= APPEARANCE_WAKE_DEBOUNCE_MS) void refresh()
      else if (next === undefined && !running) schedule(APPEARANCE_WAKE_DEBOUNCE_MS - since)
    }
    // A mount that inherits a still-valid finish waits for its renewal instead
    // of asking again right away.
    // Too close to lapsing to wait for the usual renewal: renew now, still
    // showing the inherited finish, since a refresh never clears it first.
    const inherited = verifiedNow()
    const renewIn = inherited ? inherited.remaining - APPEARANCE_RENEW_LEAD_MS : 0
    if (inherited) {
      setFinish(inherited.finish)
      expiry = window.setTimeout(() => setFinish(null), inherited.remaining)
    }
    if (inherited && renewIn >= APPEARANCE_MIN_RENEW_MS) {
      lastStart = performance.now()
      schedule(renewIn)
    } else {
      void refresh(true)
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      alive = false
      window.clearTimeout(expiry)
      window.clearTimeout(next)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [request])
  return finish
}
