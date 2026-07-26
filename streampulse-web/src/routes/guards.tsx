import { Navigate, Outlet } from 'react-router-dom'
import { hasBetaKey } from '../lib/auth'

/**
 * Gate for the separate dashboard product surface. Public analytics never uses
 * this — analytics is a no-login surface. Without a beta key we send visitors to
 * the public analytics hub rather than a (now removed) login screen.
 */
export function RequireAuth() {
  if (!hasBetaKey()) {
    return <Navigate to="/analytics" replace />
  }
  return <Outlet />
}
