import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AnalyticsRouteFallback } from './AnalyticsRouteFallback'
import Landing from './public/Landing'
// The public pages' styles stay in the first stylesheet, in the order the
// pages brought them when they were imported here: a prerendered page paints
// styled before its chunk loads, and the cascade is unchanged.
import './account/account.css'
import './public/support.css'
import NotFound from './public/NotFound'
import { PageErrorBoundary } from '../ui/PortalErrorBoundary'
import { PublicLayout } from '../ui/components/PublicLayout'
import { retiredExplorerPath } from '../lib/momentsNavigation'

const AnalyticsHubV5Page = lazy(() => import('./analytics/AnalyticsHubV5Page'))
const AnalyticsMomentsPage = lazy(() => import('./analytics/AnalyticsMomentsPage'))
const AccountPage = lazy(() => import('./account/AccountPage'))
const AccountSettings = lazy(() => import('./account/AccountSettings'))
const BillingPage = lazy(() => import('./account/BillingPage'))
const AccountRestore = lazy(() => import('./account/AccountRestore'))
const ChannelAnalyticsPage = lazy(() => import('./analytics/ChannelAnalyticsPage'))
const AnalyticsShell = lazy(() =>
  import('../ui/components/analytics/AnalyticsFigmaShell').then((module) => ({ default: module.AnalyticsFigmaShell })),
)

/**
 * A public page loads on demand, so the hub, Moments and stream pages do not
 * download the help and legal pages. Once its chunk is in it renders at once:
 * main.tsx loads the opening page before the first render, so a prerendered
 * page never flashes the loading shell.
 */
function onDemandPage(load: () => Promise<{ default: ComponentType }>) {
  let loaded: ComponentType | null = null
  const preload = () => load().then((module) => { loaded = module.default })
  const LazyPage = lazy(() => load().then((module) => { loaded = module.default; return module }))
  function Page() {
    const [Ready] = useState(() => loaded)
    return Ready ? <Ready /> : <LazyPage />
  }
  return Object.assign(Page, { preload })
}

const Docs = onDemandPage(() => import('./public/Docs'))
const Status = onDemandPage(() => import('./public/Status'))
const Privacy = onDemandPage(() => import('./public/Privacy'))
const Terms = onDemandPage(() => import('./public/Terms'))
const Refunds = onDemandPage(() => import('./public/Refunds'))
const Withdraw = onDemandPage(() => import('./public/Withdraw'))
const Supporter = onDemandPage(() => import('./public/Supporter'))
const SupporterThanks = onDemandPage(() => import('./public/SupporterThanks'))
const Support = onDemandPage(() => import('./public/Support'))
const Feedback = onDemandPage(() => import('./public/Feedback'))
const Discord = onDemandPage(() => import('./public/Discord'))
const Changelog = onDemandPage(() => import('./public/Changelog'))

const OPENING_PAGES: Record<string, { preload: () => Promise<void> }> = {
  '/docs': Docs,
  '/status': Status,
  '/privacy': Privacy,
  '/terms': Terms,
  '/refunds': Refunds,
  '/withdraw': Withdraw,
  '/supporter': Supporter,
  '/supporter/thanks': SupporterThanks,
  '/support': Support,
  '/feedback': Feedback,
  '/discord': Discord,
  '/changelog': Changelog,
}

/** Load the public page a visit opens on, before the first render. Other paths resolve at once. */
export function preloadOpeningPage(pathname: string): Promise<void> {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return OPENING_PAGES[path]?.preload() ?? Promise.resolve()
}

/**
 * Backcompat alias: /analytics/:login/s/:streamId → /analytics/:login/:streamId.
 * The `/s/` form is no longer canonical; it only exists so old links/bookmarks
 * resolve to the single canonical channel-session route.
 */
function SessionAliasRedirect() {
  const { login = '', streamId = '' } = useParams<{ login: string; streamId: string }>()
  const { search, hash } = useLocation()
  if (!validShareRouteParams(login, streamId)) return <Navigate to="/analytics" replace />
  return <Navigate to={`/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}${search}${hash}`} replace />
}

/** Short `/s/:login` and `/s/:login/:streamId` → canonical analytics (preserve query/hash). */
function ShortSessionRedirect() {
  const { login = '', streamId } = useParams<{ login: string; streamId?: string }>()
  const { search, hash } = useLocation()
  if (!validShareRouteParams(login, streamId)) return <Navigate to="/analytics" replace />
  const target = streamId
    ? `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}${search}${hash}`
    : `/analytics/${encodeURIComponent(login)}${search}${hash}`
  return <Navigate to={target} replace />
}

function validShareRouteParams(login: string, streamId?: string) {
  return /^[a-z0-9_]{1,25}$/i.test(login) && (streamId === undefined || /^[a-z0-9_-]{1,128}$/i.test(streamId))
}

/** Fixed compatibility aliases preserve useful selection/search fragments too. */
function AnalyticsAliasRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={`/analytics${search}${hash}`} replace />
}

/** Pulse Explorer and the older Newsroom are retired: a broadcast opens its stream page, the rest open Moments. */
function RetiredExplorerRedirect() {
  const { broadcastId, storyId } = useParams<{ broadcastId?: string; storyId?: string }>()
  return <Navigate to={retiredExplorerPath(broadcastId ?? storyId)} replace />
}

/**
 * For a page that throws before its own layout renders. Each layout also
 * catches errors inside its content, so its header stays mounted. Analytics
 * pages keep the analytics top navigation; a failed module load uses the site
 * header, which is always loaded.
 */
function routeErrorShell(pathname: string, panel: ReactNode, moduleLoadFailed: boolean) {
  if (moduleLoadFailed || !(pathname === '/analytics' || pathname.startsWith('/analytics/'))) {
    return <PublicLayout>{panel}</PublicLayout>
  }
  return (
    <Suspense fallback={<AnalyticsRouteFallback />}>
      <AnalyticsShell hideSidebar>
        <main id="analytics-main" className="figma-analytics__main" tabIndex={-1}>{panel}</main>
      </AnalyticsShell>
    </Suspense>
  )
}

export function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <PageErrorBoundary shell={(panel, moduleLoadFailed) => routeErrorShell(pathname, panel, moduleLoadFailed)}>
      <PortalRoutes />
    </PageErrorBoundary>
  )
}

function PortalRoutes() {
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
        <Route path="/withdraw" element={<Withdraw />} />
        {/* Public offer page. The extension's Supporter card links here, so it
            must stay a real route — never a redirect into a gated surface. */}
        <Route path="/supporter" element={<Supporter />} />
        <Route path="/supporter/thanks" element={<SupporterThanks />} />
        <Route path="/support" element={<Support />} />
        {/* The private feedback form. The extension's "Send feedback" opens this page. */}
        <Route path="/feedback" element={<Feedback />} />
        {/* The extension's "Join Discord" opens this page; it forwards to the
            build-time invite, or says the server is not open yet. */}
        <Route path="/discord" element={<Discord />} />
        {/* The extension's "Release details" links open this page. */}
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/account/sign-in" element={<AccountPage />} />
        <Route path="/account/settings" element={<AccountSettings />} />
        <Route path="/account/confirm" element={<AccountPage />} />
        <Route path="/account/restore" element={<AccountRestore />} />
        <Route path="/account/link-device" element={<AccountPage />} />
        <Route path="/account/billing" element={<BillingPage />} />
        <Route path="/account/billing/return" element={<BillingPage />} />

        {/* Public analytics is a no-login surface. The legacy beta-key /login
            screen is gone — point old links at the public analytics hub. */}
        <Route path="/login" element={<AnalyticsAliasRedirect />} />

        {/* Public aggregate analytics — single landing. /hub kept as a permanent
            redirect so old links/bookmarks resolve to the one analytics page. */}
        <Route path="/analytics" element={<AnalyticsHubV5Page />} />
        <Route path="/analytics/hub" element={<AnalyticsAliasRedirect />} />
        <Route path="/analytics/emotes" element={<AnalyticsAliasRedirect />} />
        <Route path="/atlas" element={<AnalyticsAliasRedirect />} />
        <Route path="/analytics/streams" element={<AnalyticsAliasRedirect />} />

        {/* Fixed discovery routes must precede dynamic channel routes. */}
        <Route path="/analytics/moments" element={<AnalyticsMomentsPage />} />
        <Route path="/analytics/newsroom" element={<RetiredExplorerRedirect />} />
        <Route path="/analytics/newsroom/:storyId" element={<RetiredExplorerRedirect />} />
        <Route path="/analytics/explore" element={<RetiredExplorerRedirect />} />
        <Route path="/analytics/explore/:broadcastId" element={<RetiredExplorerRedirect />} />

        {/* Public read-only channel analytics — one console; legacy ?figma flags do not select another product. */}
        <Route path="/analytics/:login" element={<ChannelAnalyticsPage />} />
        <Route path="/analytics/:login/:streamId" element={<ChannelAnalyticsPage />} />
        {/* Backcompat: redirect the old /s/ session form to the canonical route. */}
        <Route path="/analytics/:login/s/:streamId" element={<SessionAliasRedirect />} />
        {/* Short public aliases used by extension/share links. */}
        <Route path="/s/:login" element={<ShortSessionRedirect />} />
        <Route path="/s/:login/:streamId" element={<ShortSessionRedirect />} />

        {/* /admin is not a public operator console. Cloudflare Access for API
            /v1/admin/* remains an external ops/promotion blocker. */}
        <Route path="/admin/*" element={<NotFound />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
