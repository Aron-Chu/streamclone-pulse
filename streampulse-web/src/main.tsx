import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { AppRoutes } from './routes/index'
import { clearBetaKey, clearStaleLocalBackendOverride, refreshPrincipal } from './lib/auth'
import { initPortalSentry } from './lib/sentry'
import { PortalErrorBoundary } from './ui/PortalErrorBoundary'
import { PageMetadata } from './ui/PageMetadata'
import { BuildIdentityBanner } from './ui/BuildIdentityBanner'
import { shadowStyles } from './ui/theme'
import './ui/portal-fonts.css'
import './ui/global.css'

initPortalSentry()

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
      if (isPublicAnalyticsPath(location.pathname)) {
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

async function bootstrap() {
  clearStaleLocalBackendOverride()
  await refreshPrincipal()
  const style = document.createElement('style')
  style.textContent = shadowStyles
  document.head.appendChild(style)

  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')

  createRoot(root).render(
    <StrictMode>
      <PortalErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <PageMetadata />
            <AuthRejectedListener />
            <BuildIdentityBanner />
            <AppRoutes />
          </BrowserRouter>
        </QueryClientProvider>
      </PortalErrorBoundary>
    </StrictMode>,
  )
}

void bootstrap()
