/** Suspense fallback while lazy analytics routes load. */
export function AnalyticsRouteFallback() {
  const message = import.meta.env.DEV
    ? 'Loading analytics…'
    : 'Loading command center…'

  return (
    <div className="app-main" role="status" aria-live="polite">
      <div className="analytics-route-fallback" aria-label={message}>
        <p className="muted">
          <span className="analytics-route-fallback__spinner" aria-hidden="true" />
          {message}
        </p>
        <div className="analytics-route-fallback__skeleton" aria-hidden="true">
          <div className="analytics-route-fallback__skeleton-line analytics-route-fallback__skeleton-line--wide" />
          <div className="analytics-route-fallback__skeleton-line" />
          <div className="analytics-route-fallback__skeleton-chart" />
        </div>
      </div>
    </div>
  )
}
