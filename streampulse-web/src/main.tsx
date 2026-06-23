import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { AppRoutes } from './routes/index'
import { clearBetaKey, refreshPrincipal } from './lib/auth'
import { shadowStyles } from './ui/theme'
import './ui/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
    },
  },
})

function AuthRejectedListener() {
  const navigate = useNavigate()

  useEffect(() => {
    function onRejected() {
      clearBetaKey()
      queryClient.clear()
      navigate('/login', { replace: true })
    }
    window.addEventListener('auth:rejected', onRejected)
    return () => window.removeEventListener('auth:rejected', onRejected)
  }, [navigate])

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
