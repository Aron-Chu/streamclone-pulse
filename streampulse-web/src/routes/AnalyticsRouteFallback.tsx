/** Suspense fallback while lazy analytics routes load. */
export function AnalyticsRouteFallback() {
  const message = import.meta.env.DEV
    ? 'Loading analytics…'
    : 'Loading command center…'

  return (
    <div className="app-main" role="status" aria-live="polite">
      <p className="muted analytics-route-fallback">
        <span className="analytics-route-fallback__spinner" aria-hidden="true" />
        {message}
      </p>
    </div>
  )
}
