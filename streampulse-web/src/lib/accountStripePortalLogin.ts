/**
 * Optional link to Stripe's no-code customer portal login
 * (VITE_STRIPE_PORTAL_LOGIN_URL, spec P2.6). There, Stripe emails a one-time
 * code to the billing email, so someone who lost their Twitch account can still
 * cancel or update billing. It changes billing only; it never moves a
 * membership to another StreamPulse account.
 *
 * Only an https://billing.stripe.com/p/login/... address is accepted (no
 * credentials, port, query or fragment). Anything else, including unset, gives
 * null, and pages then keep the plain sentence instead of rendering a link.
 * Turning it on also needs the portal login link enabled in the Stripe
 * Dashboard (owner item).
 */
export function stripePortalLoginUrl(value: unknown = import.meta.env.VITE_STRIPE_PORTAL_LOGIN_URL): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    const ok = url.protocol === 'https:'
      && url.hostname === 'billing.stripe.com'
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^\/p\/login\/[A-Za-z0-9_]+$/.test(url.pathname)
    return ok ? url.href : null
  } catch { return null }
}
