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

/**
 * Explorer compatibility. `/analytics/explore` shipped hosted (PR #39) as a
 * Newsroom replacement; Moments is the canonical discovery workflow, so the
 * route resolves here instead of remaining a hosted-only ghost product or a
 * local 404.
 *
 * Only meaning that Moments actually implements is carried across. Verified
 * against the live hosted Explorer controls (window / signal / category /
 * state / sort):
 *   - `:broadcastId` → `story`, the same session identity the Newsroom alias
 *     uses. If the id does not resolve, the Moments session view reports that
 *     honestly rather than this redirect guessing a substitute.
 *   - `window` → `window`. Explorer offers Live / 24 hours / 7 days, which is
 *     exactly the set Moments accepts; anything else is dropped.
 *   - `category` → `category`. Both are the Twitch stream category, and
 *     `readMomentBrowse` treats it as a free-string equality filter, so an
 *     unmatched value narrows to an honestly empty result rather than lying.
 *
 * `signal` and `state` have no Moments equivalent and are dropped.
 *
 * `sort` is dropped **deliberately despite both surfaces using that key**:
 * Explorer sorts by Strongest / Most recent / Most moments, while Moments'
 * `readMomentBrowse` accepts only 'oldest' | 'category'. Forwarding it would
 * silently reinterpret the value, which is worse than losing it.
 *
 * The hash is preserved as-is.
 */
const MOMENTS_WINDOWS = new Set(['live', '24h', '7d'])

function ExplorerCompatibilityRedirect() {
  const { broadcastId } = useParams<{ broadcastId?: string }>()
  const { search, hash } = useLocation()
  const incoming = new URLSearchParams(search)
  const query = new URLSearchParams()
  query.set('view', 'sessions')
  if (broadcastId) query.set('story', broadcastId)
  const window = incoming.get('window')
  if (window && MOMENTS_WINDOWS.has(window)) query.set('window', window)
  const category = incoming.get('category')
  if (category) query.set('category', category)
  return <Navigate to={`/analytics/moments?${query}${hash}`} replace />
}

/** Preserve legacy story identity. The Moments session view resolves it through the original endpoint. */
function NewsroomCompatibilityRedirect() {
  const { storyId } = useParams<{ storyId?: string }>()
  const { search, hash } = useLocation()
  const query = new URLSearchParams(search)
  query.set('view', 'sessions')
  if (storyId) query.set('story', storyId)
  return <Navigate to={`/analytics/moments?${query}${hash}`} replace />
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
        <Route path="/analytics/newsroom" element={<NewsroomCompatibilityRedirect />} />
        <Route path="/analytics/newsroom/:storyId" element={<NewsroomCompatibilityRedirect />} />
        {/* Hosted-only Explorer resolves into Moments; must stay above /analytics/:login
            so "explore" is never mistaken for a channel handle. */}
        <Route path="/analytics/explore" element={<ExplorerCompatibilityRedirect />} />
        <Route path="/analytics/explore/:broadcastId" element={<ExplorerCompatibilityRedirect />} />

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
