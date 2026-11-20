import { useLocation } from 'react-router-dom'
import { PublicLayout } from '../ui/components/PublicLayout'
import { twitchSignInEnabled } from '../lib/twitchSignInFlag'

/**
 * Which account page the waiting card stands in for, when that page's first
 * render is taller than the room the layout keeps under the header: the card
 * then holds that height (account.css, [data-account-wait]) so the footer stays
 * put when the page replaces it. Confirm and restore open on cards that mostly
 * fit that room; link-device opens on its own short "Checking your account…"
 * card, and so does sign-in when Twitch sign-in is on. None of those hold any.
 */
export function accountWaitFor(pathname: string): string | undefined {
  const page = pathname.replace(/\/+$/, '').replace(/^\/account\//, '')
  if (page === 'sign-in') return twitchSignInEnabled() ? undefined : page
  if (page === 'billing/return') return 'billing'
  return page === 'settings' || page === 'billing' ? page : undefined
}

function AccountWaitingCard() {
  const { pathname } = useLocation()
  return (
    <PublicLayout>
      <section className="pulse-account" data-account-wait={accountWaitFor(pathname)} aria-label="StreamPulse account">
        <p role="status" className="pulse-account-waiting"><span className="pulse-account-spinner" aria-hidden="true" />Checking your account…</p>
      </section>
    </PublicLayout>
  )
}

/**
 * Suspense fallback while lazy routes load. An account page opens in its own
 * card, which is also the account shell scripts/prerender.mjs writes for the
 * account documents; it shows no account data.
 */
export function AnalyticsRouteFallback({ variant = 'analytics' }: { variant?: 'analytics' | 'account' } = {}) {
  if (variant === 'account') return <AccountWaitingCard />

  const message = import.meta.env.DEV
    ? 'Loading analytics…'
    : 'Loading command center…'

  return (
    <div className="app-main" role="status" aria-live="polite" data-analytics-route-skeleton>
      <div className="analytics-route-fallback__skeleton" aria-hidden="true">
        <div className="analytics-route-fallback__skeleton-line analytics-route-fallback__skeleton-line--wide" />
        <div className="analytics-route-fallback__skeleton-line" />
        <div className="analytics-route-fallback__skeleton-chart">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <p className="muted analytics-route-fallback">
        <span className="analytics-route-fallback__spinner" aria-hidden="true" />
        {message}
      </p>
    </div>
  )
}
