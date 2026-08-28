import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { RequireAuth } from './guards'
import { AnalyticsRouteFallback } from './AnalyticsRouteFallback'
import Landing from './public/Landing'
import Docs from './public/Docs'
import Status from './public/Status'
import Privacy from './public/Privacy'
import Support from './public/Support'
import NotFound from './public/NotFound'

const AnalyticsLandingPage = lazy(() => import('./analytics/AnalyticsLandingPage'))
const AnalyticsNewsroomPage = lazy(() => import('./analytics/AnalyticsNewsroomPage'))
const DashboardShell = lazy(() => import('./dashboard/DashboardShell'))
const DashboardHome = lazy(() => import('./dashboard/Home'))
const ClipsPage = lazy(() => import('./dashboard/Clips'))
const ChannelAnalyticsPage = lazy(() => import('./analytics/ChannelAnalyticsPage'))

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

/** Short `/s/:login` and `/s/:login/:streamId` → canonical analytics (preserve query/hash). */
function ShortSessionRedirect() {
  const { login = '', streamId } = useParams<{ login: string; streamId?: string }>()
  const { search, hash } = useLocation()
  const target = streamId
    ? `/analytics/${login}/${streamId}${search}${hash}`
    : `/analytics/${login}${search}${hash}`
  return <Navigate to={target} replace />
}

export function AppRoutes() {
  return (
    <Suspense fallback={<AnalyticsRouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Navigate to="/analytics" replace />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/*" element={<Docs />} />
        <Route path="/status" element={<Status />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/support" element={<Support />} />

        {/* Public analytics is a no-login surface. The legacy beta-key /login
            screen is gone — point old links at the public analytics hub. */}
        <Route path="/login" element={<Navigate to="/analytics" replace />} />

        {/* Public aggregate analytics — single landing. /hub kept as a permanent
            redirect so old links/bookmarks resolve to the one analytics page. */}
        <Route path="/analytics" element={<AnalyticsLandingPage />} />
        <Route path="/analytics/hub" element={<Navigate to="/analytics" replace />} />
        <Route path="/analytics/emotes" element={<Navigate to="/analytics" replace />} />
        <Route path="/atlas" element={<Navigate to="/analytics" replace />} />
        <Route path="/analytics/streams" element={<Navigate to="/analytics" replace />} />

        {/* Public Pulse Newsroom routes must precede dynamic channel routes. */}
        <Route path="/analytics/newsroom" element={<AnalyticsNewsroomPage />} />
        <Route path="/analytics/newsroom/:storyId" element={<AnalyticsNewsroomPage />} />

        {/* Public read-only channel analytics — analytics console; ?figma=1 for the Figma session dashboard. */}
        <Route path="/analytics/:login" element={<ChannelAnalyticsPage />} />
        <Route path="/analytics/:login/:streamId" element={<ChannelAnalyticsPage />} />
        {/* Backcompat: redirect the old /s/ session form to the canonical route. */}
        <Route path="/analytics/:login/s/:streamId" element={<SessionAliasRedirect />} />
        {/* Short public aliases used by extension/share links. */}
        <Route path="/s/:login" element={<ShortSessionRedirect />} />
        <Route path="/s/:login/:streamId" element={<ShortSessionRedirect />} />

        {/* Dashboard remains a separate, gated product surface. */}
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardShell />}>
            <Route index element={<DashboardHome />} />
            <Route path="clips" element={<ClipsPage />} />
          </Route>
        </Route>

        {/* /admin is not a public operator console. Cloudflare Access for API
            /v1/admin/* remains an external ops/promotion blocker. */}
        <Route path="/admin/*" element={<NotFound />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
