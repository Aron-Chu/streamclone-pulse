import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { RequireAuth } from './guards'
import Landing from './public/Landing'
import Docs from './public/Docs'
import Status from './public/Status'
import AnalyticsLandingPage from './analytics/AnalyticsLandingPage'

const DashboardShell = lazy(() => import('./dashboard/DashboardShell'))
const DashboardHome = lazy(() => import('./dashboard/Home'))
const ClipsPage = lazy(() => import('./dashboard/Clips'))
const AdminShell = lazy(() => import('./admin/AdminShell'))
const ChannelAnalyticsPage = lazy(() => import('./analytics/ChannelAnalyticsPage'))
const StreamsHubPlaceholder = lazy(() => import('./analytics/StreamsHubPlaceholder'))

function RouteFallback() {
  return (
    <div className="app-main">
      <p className="muted">Loading…</p>
    </div>
  )
}

/**
 * Backcompat alias: /analytics/:login/s/:streamId → /analytics/:login/:streamId.
 * The `/s/` form is no longer canonical; it only exists so old links/bookmarks
 * resolve to the single canonical channel-session route.
 */
function SessionAliasRedirect() {
  const { login = '', streamId = '' } = useParams<{ login: string; streamId: string }>()
  const { search, hash } = useLocation()
  return <Navigate to={`/analytics/${login}/${streamId}${search}${hash}`} replace />
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Navigate to="/analytics" replace />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/*" element={<Docs />} />
        <Route path="/status" element={<Status />} />

        {/* Public analytics is a no-login surface. The legacy beta-key /login
            screen is gone — point old links at the public analytics hub. */}
        <Route path="/login" element={<Navigate to="/analytics" replace />} />

        {/* Public aggregate analytics — single landing. /hub kept as a permanent
            redirect so old links/bookmarks resolve to the one analytics page. */}
        <Route path="/analytics" element={<AnalyticsLandingPage />} />
        <Route path="/analytics/hub" element={<Navigate to="/analytics" replace />} />
        <Route path="/analytics/emotes" element={<Navigate to="/analytics" replace />} />
        <Route path="/atlas" element={<Navigate to="/analytics" replace />} />
        <Route path="/analytics/streams" element={<StreamsHubPlaceholder />} />

        {/* Public read-only channel analytics — analytics console; ?figma=1 for the Figma session dashboard. */}
        <Route path="/analytics/:login" element={<ChannelAnalyticsPage />} />
        <Route path="/analytics/:login/:streamId" element={<ChannelAnalyticsPage />} />
        {/* Backcompat: redirect the old /s/ session form to the canonical route. */}
        <Route path="/analytics/:login/s/:streamId" element={<SessionAliasRedirect />} />

        {/* Dashboard remains a separate, gated product surface. */}
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardShell />}>
            <Route index element={<DashboardHome />} />
            <Route path="clips" element={<ClipsPage />} />
          </Route>
        </Route>

        <Route path="/admin/*" element={<AdminShell />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
