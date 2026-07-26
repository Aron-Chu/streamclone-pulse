import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Sentry, sanitizePortalPath } from '../lib/sentry'

type Props = { children: ReactNode }
type State = { hasError: boolean }

/**
 * Root error boundary — reports to Sentry when initialized, never attaches
 * storage, beta keys, or route params.
 */
export class PortalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const route =
      typeof window !== 'undefined' ? sanitizePortalPath(window.location.pathname) : 'unknown'
    Sentry.withScope((scope) => {
      scope.setTag('route', route)
      scope.setTag('error_type', error.name || 'Error')
      Sentry.captureException(error)
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="panel" style={{ margin: '2rem auto', maxWidth: 480 }}>
          <h1>Something went wrong</h1>
          <p className="muted">Reload the page. If it keeps happening, check Status.</p>
          <button type="button" onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
