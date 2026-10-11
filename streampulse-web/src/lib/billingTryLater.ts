/**
 * Backend #162 answers Checkout and portal requests over its per-account or
 * per-network budget with 429 {"error":"try_later"} and Retry-After. These
 * name the wait in the same words the extension uses, so a person sees one
 * calm, specific message on either surface.
 */
export function retryWaitCopy(retryAt: number, now = Date.now()): { at: string; span: string } {
  const minutes = Math.max(1, Math.ceil((retryAt - now) / 60_000))
  const hours = Math.round(minutes / 60)
  const span = minutes < 60 ? `about ${minutes} minute${minutes === 1 ? '' : 's'}` : `about ${hours} hour${hours === 1 ? '' : 's'}`
  const at = new Date(retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return { at, span }
}

export function tryLaterCopy(kind: 'checkout' | 'portal', retryAt: number, now = Date.now()): string {
  const { at, span } = retryWaitCopy(retryAt, now)
  return kind === 'checkout'
    ? `Checkout was opened too many times in a short while, so it is paused for this account. This attempt started nothing and charged nothing. Try again after ${at} (${span}).`
    : `Subscription management was opened too many times in a short while, so it is paused for this account. Your membership is unchanged. Try again after ${at} (${span}).`
}

/** Without a usable Retry-After the page still waits a minute before it offers the button again. */
export const DEFAULT_TRY_LATER_SECONDS = 60
