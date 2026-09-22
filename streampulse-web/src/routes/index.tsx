import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { RequireAuth } from './guards'
import { AnalyticsRouteFallback } from './AnalyticsRouteFallback'
import Landing from './public/Landing'
import Docs from './public/Docs'
import Status from './public/Status'
import Privacy from './public/Privacy'
import Terms from './public/Terms'
import Refunds from './public/Refunds'
import Supporter from './public/Supporter'
import Support from './public/Support'
import NotFound from './public/NotFound'

const AnalyticsLandingPage = lazy(() => import('./analytics/AnalyticsLandingPage'))
const AnalyticsMomentsPage = lazy(() => import('./analytics/AnalyticsMomentsPage'))
const AnalyticsExplorerPage = lazy(() => import('./analytics/AnalyticsExplorerPage'))
const DashboardShell = lazy(() => import('./dashboard/DashboardShell'))
const DashboardHome = lazy(() => import('./dashboard/Home'))
const ClipsPage = lazy(() => import('./dashboard/Clips'))
const AccountPage = lazy(() => import('./account/AccountPage'))
const AccountSettings = lazy(() => import('./account/AccountSettings'))
const BillingPage = lazy(() => import('./account/BillingPage'))
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

/** Fixed compatibility aliases preserve useful selection/search fragments too. */
function AnalyticsAliasRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={`/analytics${search}${hash}`} replace />
}

/** Retired Newsroom URLs keep their identifier and query/hash on Pulse Explorer. */
function NewsroomAliasRedirect() {
  const { storyId } = useParams<{ storyId?: string }>()
  const { search, hash } = useLocation()
  const path = storyId ? `/analytics/explore/${encodeURIComponent(storyId)}` : '/analytics/explore'
  return <Navigate to={`${path}${search}${hash}`} replace />
}

export function AppRoutes() {
  return (
    <Suspense fallback={<AnalyticsRouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<AnalyticsAliasRedirect />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/getting-started" element={<Navigate to="/docs#extension" replace />} />
        <Route path="/docs/coverage" element={<Navigate to="/docs#coverage" replace />} />
        <Route path="/docs/api" element={<Navigate to="/docs#api" replace />} />
        <Route path="/docs/*" element={<NotFound />} />
        <Route path="/status" element={<Status />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/refunds" element={<Refunds />} />
        {/* Public offer page. The extension's Supporter card links here, so it
            must stay a real route — never a redirect into a gated surface. */}
        <Route path="/supporter" element={<Supporter />} />
        <Route path="/support" element={<Support />} />
        <Route path="/account/sign-in" element={<AccountPage />} />
        <Route path="/account/settings" element={<AccountSettings />} />
        <Route path="/account/confirm" element={<AccountPage />} />
        <Route path="/account/link-device" element={<AccountPage />} />
        <Route path="/account/billing" element={<BillingPage />} />
        <Route path="/account/billing/return" element={<BillingPage />} />

        {/* Public analytics is a no-login surface. The legacy beta-key /login
            screen is gone — point old links at the public analytics hub. */}
        <Route path="/login" element={<AnalyticsAliasRedirect />} />

        {/* Public aggregate analytics — single landing. /hub kept as a permanent
            redirect so old links/bookmarks resolve to the one analytics page. */}
        <Route path="/analytics" element={<AnalyticsLandingPage />} />
        <Route path="/analytics/hub" element={<AnalyticsAliasRedirect />} />
        <Route path="/analytics/emotes" element={<AnalyticsAliasRedirect />} />
        <Route path="/atlas" element={<AnalyticsAliasRedirect />} />
        <Route path="/analytics/streams" element={<AnalyticsAliasRedirect />} />

        {/* Fixed discovery routes must precede dynamic channel routes. */}
        <Route path="/analytics/moments" element={<AnalyticsMomentsPage />} />
        {/* Pulse Explorer and its retired Newsroom aliases must precede dynamic channel routes. */}
        <Route path="/analytics/explore" element={<AnalyticsExplorerPage />} />
        <Route path="/analytics/explore/:broadcastId" element={<AnalyticsExplorerPage />} />
        <Route path="/analytics/newsroom" element={<NewsroomAliasRedirect />} />
        <Route path="/analytics/newsroom/:storyId" element={<NewsroomAliasRedirect />} />

        {/* Public read-only channel analytics — one console; legacy ?figma flags do not select another product. */}
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
