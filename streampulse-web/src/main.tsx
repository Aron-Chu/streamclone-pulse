import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { AppRoutes } from './routes/index'
import { clearBetaKey, refreshPrincipal } from './lib/auth'
import { setupStreamcloneAnalyticsApi } from './lib/streamcloneAnalytics'
import { shadowStyles } from './ui/theme'
import './ui/global.css'

// Portal analytics console queries run on first paint — configure before React mounts.
setupStreamcloneAnalyticsApi()

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
  await refreshPrincipal()
  const style = document.createElement('style')
  style.textContent = shadowStyles
  document.head.appendChild(style)

  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthRejectedListener />
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
