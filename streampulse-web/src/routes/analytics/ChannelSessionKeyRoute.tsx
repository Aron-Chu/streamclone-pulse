import { Navigate, useLocation, useParams } from 'react-router-dom'
import { resolveAnalyticsSessionKeyRoute } from '../../lib/analyticsSessionKey'
import ChannelDatePage from './ChannelDatePage'

/** HUB-P3-002 — single parser for /analytics/:login/:sessionKey */
export default function ChannelSessionKeyRoute() {
  const { login = '', sessionKey = '' } = useParams<{ login: string; sessionKey: string }>()
  const location = useLocation()
  const resolved = resolveAnalyticsSessionKeyRoute(login, sessionKey, location.search)

  if (resolved.kind === 'session-day') {
    return <ChannelDatePage />
  }

  return <Navigate to={resolved.to} replace />
}
