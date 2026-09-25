import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Sentry, sanitizePortalPath } from '../lib/sentry'

type Props = { children: ReactNode }
type State = { hasError: boolean; moduleLoadFailed: boolean }

export function isModuleLoadError(error: unknown): boolean {
  return error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|error loading dynamically imported module/i.test(error.message)
}

/**
 * Root error boundary — reports to Sentry when initialized, never attaches
 * storage, beta keys, or route params.
 */
export class PortalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, moduleLoadFailed: false }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, moduleLoadFailed: isModuleLoadError(error) }
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
          <h1>{this.state.moduleLoadFailed ? 'This page could not load' : 'Something went wrong'}</h1>
          <p className="muted">{this.state.moduleLoadFailed
            ? 'A required part of the site failed to load. Reload to request the current version.'
            : 'Reload the page. If it keeps happening, check Status.'}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
