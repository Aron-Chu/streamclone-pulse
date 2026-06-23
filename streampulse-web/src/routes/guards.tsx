import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { hasBetaKey } from '../lib/auth'

export function RequireAuth() {
  const location = useLocation()
  if (!hasBetaKey()) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <Outlet />
}
