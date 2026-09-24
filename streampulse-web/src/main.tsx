import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { AppRoutes } from './routes/index'
import {
  clearBetaKey,
  clearStaleLocalBackendOverride,
  isAllowedDevBackendQueryOverride,
  refreshPrincipal,
  setBackendUrlOverride,
} from './lib/auth'
import { initPortalSentry } from './lib/sentry'
import { PortalErrorBoundary } from './ui/PortalErrorBoundary'
import { PageMetadata } from './ui/PageMetadata'
import { shadowStyles } from './ui/theme'
import './ui/portal-fonts.css'
import './ui/public-utilities.css'
import './ui/global.css'
import { captureAccountConfirmation } from './lib/accountConfirmation'

captureAccountConfirmation()
if (!window.location.pathname.startsWith('/account/')) initPortalSentry()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
    },
  },
})

function isPublicAnalyticsPath(pathname: string): boolean {
  if (
    pathname === '/analytics' ||
    pathname === '/analytics/streams'
  ) {
    return true
  }
  // /analytics/:channelLogin, /analytics/:channelLogin/:streamId, and the
  // /s/ backcompat alias are all public, no-login channel surfaces.
  return /^\/analytics\/[^/]+(?:\/(?:s\/)?[^/]+)?$/.test(pathname)
}

function AuthRejectedListener() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function onRejected() {
      if (isPublicAnalyticsPath(location.pathname) || location.pathname.startsWith('/account/')) {
        return
      }
      clearBetaKey()
      queryClient.clear()
      navigate('/analytics', { replace: true })
    }
    window.addEventListener('auth:rejected', onRejected)
    return () => window.removeEventListener('auth:rejected', onRejected)
  }, [location.pathname, navigate])

  return null
}

/**
 * Dev-only: `?spBackend=<origin>` sets the session backend override so a local
 * shim (e.g. scripts/dev-discovery-fixture.mjs) is reachable from a single
 * shareable URL instead of a console incantation. `setBackendUrlOverride`
 * itself refuses a localhost origin unless VITE_ALLOW_LOCAL_BACKEND=1, and this
 * whole branch is compiled out of production by `import.meta.env.DEV`.
 */
function applyDevBackendQueryOverride(): void {
  if (!import.meta.env.DEV) return
  const requested = new URLSearchParams(window.location.search).get('spBackend')
  if (requested == null) return
  setBackendUrlOverride(isAllowedDevBackendQueryOverride(requested) ? requested : null)
  // Drop the parameter so it does not ride along on shared links or reloads.
  const url = new URL(window.location.href)
  url.searchParams.delete('spBackend')
  window.history.replaceState(window.history.state, '', url.toString())
}

async function bootstrap() {
  applyDevBackendQueryOverride()
  clearStaleLocalBackendOverride()
  if (!window.location.pathname.startsWith('/account/')) await refreshPrincipal()
  const style = document.createElement('style')
  style.textContent = shadowStyles
  document.head.appendChild(style)

  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')
  root.removeAttribute('data-prerendered')

  createRoot(root).render(
    <StrictMode>
      <PortalErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <PageMetadata />
            <AuthRejectedListener />
            <AppRoutes />
          </BrowserRouter>
        </QueryClientProvider>
      </PortalErrorBoundary>
    </StrictMode>,
  )
}

void bootstrap()
