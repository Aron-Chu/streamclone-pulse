/** Suspense fallback while lazy analytics routes load. */
export function AnalyticsRouteFallback() {
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
