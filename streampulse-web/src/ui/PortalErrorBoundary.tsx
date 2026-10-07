import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sentry, sanitizePortalPath } from '../lib/sentry'
import { clearPublicHubCache, discardPublicHubCacheAfterError } from '../lib/publicHubCacheReset'

type Props = {
  children: ReactNode
  /** Route-level use: wraps the error panel so the site header and nav stay usable. */
  shell?: (panel: ReactNode, moduleLoadFailed: boolean) => ReactNode
  /** Route-level use: a new value (the next path) clears the error. */
  resetKey?: string
}
type State = { hasError: boolean; moduleLoadFailed: boolean }

export function isModuleLoadError(error: unknown): boolean {
  return error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|error loading dynamically imported module/i.test(error.message)
}

/** Drop cached hub snapshots first, so the reload refetches instead of re-hydrating a crash. */
export function reloadAfterPortalError(reload: () => void = () => window.location.reload()): void {
  clearPublicHubCache()
  reload()
}

/** Nested boundaries can meet the same error again (React.lazy rethrows a cached failure). */
const reportedErrors = new WeakSet<object>()

/**
 * Root error boundary — reports to Sentry when initialized, never attaches
 * storage, beta keys, or route params. PageErrorBoundary mounts it again around
 * the routes and inside each layout, so one broken page keeps its navigation.
 */
export class PortalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, moduleLoadFailed: false }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, moduleLoadFailed: isModuleLoadError(error) }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    // The crash may come from a hub snapshot that was already saved: drop it so
    // a retry, a reload or a new tab starts from a fresh read.
    discardPublicHubCacheAfterError()
    if (error !== null && typeof error === 'object') {
      if (reportedErrors.has(error)) return
      reportedErrors.add(error)
    }
    const route =
      typeof window !== 'undefined' ? sanitizePortalPath(window.location.pathname) : 'unknown'
    Sentry.withScope((scope) => {
      scope.setTag('route', route)
      scope.setTag('error_type', error.name || 'Error')
      Sentry.captureException(error)
    })
  }

  componentDidUpdate(prevProps: Props, prevState: State): void {
    // Only clear an error that was already showing. When the navigation itself
    // lands on a broken page, clearing would re-render it and report it twice.
    if (prevState.hasError && this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, moduleLoadFailed: false })
    }
  }

  render() {
    if (this.state.hasError) {
      const panel = (
        <div className="panel" style={{ margin: '2rem auto', maxWidth: 480 }}>
          <h1>{this.state.moduleLoadFailed ? 'This page could not load' : 'Something went wrong'}</h1>
          <p className="muted">{this.state.moduleLoadFailed
            ? 'A required part of the site failed to load. Reload to request the current version.'
            : 'Reload the page. If it keeps happening, check Status.'}</p>
          <button type="button" onClick={() => reloadAfterPortalError()}>
            Reload page
          </button>
        </div>
      )
      return this.props.shell ? this.props.shell(panel, this.state.moduleLoadFailed) : panel
    }
    return this.props.children
  }
}

/** A broken page keeps the header around it; following a link to another path clears the error. */
export function PageErrorBoundary({ children, shell }: { children: ReactNode; shell?: Props['shell'] }) {
  const { pathname, search } = useLocation()
  return <PortalErrorBoundary shell={shell} resetKey={`${pathname}${search}`}>{children}</PortalErrorBoundary>
}
