import { useEffect, useId, useRef, useState } from 'react'
import {
  analyticsBlockedByBrowser,
  analyticsConfigured,
  getAnalyticsPreference,
  setAnalyticsPreference,
  subscribeAnalyticsPreference,
} from '../../lib/productAnalytics'
import './AnalyticsPreferences.css'

/** A voluntary footer choice: nothing is collected before the visitor opts in. */
export function AnalyticsPreferences() {
  const [preference, setPreference] = useState(getAnalyticsPreference)
  const details = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  const descriptionId = useId()

  useEffect(() => subscribeAnalyticsPreference(() => {
    setPreference(getAnalyticsPreference())
  }), [])

  const blockedByBrowser = analyticsBlockedByBrowser()
  const configured = analyticsConfigured()
  const unavailable = blockedByBrowser || !configured
  const allowed = preference === 'allowed' && !unavailable
  const status = blockedByBrowser
    ? 'Analytics are off because your browser asks websites not to track.'
    : !configured
      ? 'Optional website analytics are currently unavailable and off.'
      : allowed
        ? 'Anonymous website analytics are on. You can turn them off at any time.'
        : 'Anonymous website analytics are off.'

  return (
    <details className="analytics-preferences" ref={details} onKeyDown={(event) => {
      if (event.key !== 'Escape' || !details.current?.open) return
      event.preventDefault()
      details.current.open = false
      summary.current?.focus()
    }}>
      <summary ref={summary}>Analytics preferences</summary>
      <div className="analytics-preferences__body" aria-describedby={descriptionId}>
        <p id={descriptionId}>
          If you allow it, PostHog receives anonymous public page categories and clicks on
          Install or Open Analytics to help us improve this website. Account pages, dashboard
          activity and your Twitch viewing are excluded. No cookies, session recordings or
          person profiles are used.
        </p>
        <p className="analytics-preferences__status" role="status">{status}</p>
        <div className="analytics-preferences__actions">
          <button type="button" disabled={unavailable || allowed}
            onClick={() => setAnalyticsPreference('allowed')}>
            Allow anonymous analytics
          </button>
          <button type="button" onClick={() => setAnalyticsPreference('declined')}>
            {allowed ? 'Turn analytics off' : 'Keep analytics off'}
          </button>
        </div>
        <p className="analytics-preferences__note">
          Your choice is saved in this browser. Turning analytics off stops future events;
          it cannot recall events already sent. <a href="/privacy">Read the privacy policy</a>.
        </p>
      </div>
    </details>
  )
}
