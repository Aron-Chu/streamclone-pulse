import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AnalyticsRouteFallback } from './AnalyticsRouteFallback'
// The home page loads on demand like the other public pages. The tokens it
// brought stay first in the first stylesheet: every page's styles read them.
import '../ui/tokens.css'
// The public pages' styles stay in the first stylesheet, in the order the
// pages brought them when they were imported here: a prerendered page paints
// styled before its chunk loads, and the cascade is unchanged.
import './account/account.css'
import './public/support.css'
import './public/growth-guides.css'
import NotFound from './public/NotFound'
import { PageErrorBoundary } from '../ui/PortalErrorBoundary'
import { PublicLayout } from '../ui/components/PublicLayout'
import { retiredExplorerPath } from '../lib/momentsNavigation'
import { twitchSignInEnabled } from '../lib/twitchSignInFlag'
import { accountMomentsEnabled } from '../lib/accountMoments'

// On demand like the public pages: /analytics is prerendered as the hub's first render, which main.tsx loads before its own.
const AnalyticsHubV5Page = onDemandPage(() => import('./analytics/AnalyticsHubV5Page'))
const AnalyticsMomentsPage = lazy(() => import('./analytics/AnalyticsMomentsPage'))
// A clip's own page exists only in a build with the Clips tab; read inline so a build without it folds the route away.
const clipsBuildFlag = import.meta.env.VITE_PUBLIC_NATIVE_CLIPS
const clipsRouteOn = clipsBuildFlag === 'on' || clipsBuildFlag === '1'
const NativeClipWatchPage = clipsRouteOn ? lazy(() => import('./analytics/NativeClipWatchPage')) : null
// Each account address has its own prerendered card (scripts/prerender.mjs), which stays up until its page is in.
const AccountPage = onDemandPage(() => import('./account/AccountPage'))
const AccountSettings = onDemandPage(() => import('./account/AccountSettings'))
const BillingPage = onDemandPage(() => import('./account/BillingPage'))
const AccountRestore = onDemandPage(() => import('./account/AccountRestore'))
// Sign in with Twitch and My Moments pages exist only in builds with their
// switches on; read inline, like the clip page, so a build without them emits
// no chunk for them.
const twitchSignInBuild = import.meta.env.VITE_TWITCH_SIGNIN === '1'
const accountMomentsBuild = import.meta.env.VITE_ACCOUNT_MOMENTS === '1'
const AccountTwitchCallback = twitchSignInBuild ? lazy(() => import('./account/AccountTwitchCallback')) : null
const AccountMoments = accountMomentsBuild ? lazy(() => import('./account/AccountMoments')) : null
const AccountHome = accountMomentsBuild ? lazy(() => import('./account/AccountHome')) : null
const AccountSync = accountMomentsBuild ? lazy(() => import('../ui/components/AccountSync').then((m) => ({ default: m.AccountSync }))) : null
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

const Landing = onDemandPage(() => import('./public/Landing'))
const FindTwitchMomentsGuide = onDemandPage(() => import('./public/FindTwitchMomentsGuide'))
const TwitchVodTimestampsGuide = onDemandPage(() => import('./public/TwitchVodTimestampsGuide'))
const Recaps = onDemandPage(() => import('./public/Recaps'))

const Help = onDemandPage(() => import('./public/Help'))
const Status = onDemandPage(() => import('./public/Status'))
const Privacy = onDemandPage(() => import('./public/Privacy'))
const Terms = onDemandPage(() => import('./public/Terms'))
const Refunds = onDemandPage(() => import('./public/Refunds'))
const Withdraw = onDemandPage(() => import('./public/Withdraw'))
const Supporter = onDemandPage(() => import('./public/Supporter'))
const SupporterThanks = onDemandPage(() => import('./public/SupporterThanks'))
const Discord = onDemandPage(() => import('./public/Discord'))
const Changelog = onDemandPage(() => import('./public/Changelog'))

const OPENING_PAGES: Record<string, { preload: () => Promise<void> }> = {
  '/': Landing,
  '/analytics': AnalyticsHubV5Page,
  // The builder's old address opens the guide it now sits in.
  '/tools/twitch-vod-timestamp-link': TwitchVodTimestampsGuide,
  '/guides/find-twitch-moments': FindTwitchMomentsGuide,
  '/guides/twitch-vod-timestamps': TwitchVodTimestampsGuide,
  '/recaps': Recaps,
  '/help': Help,
  // The old help pages open a section of Help.
  '/docs': Help,
  '/support': Help,
  '/feedback': Help,
  '/status': Status,
  '/privacy': Privacy,
  '/terms': Terms,
  '/refunds': Refunds,
  '/withdraw': Withdraw,
  '/supporter': Supporter,
  '/supporter/thanks': SupporterThanks,
  '/discord': Discord,
  '/changelog': Changelog,
  '/account/sign-in': AccountPage,
  '/account/confirm': AccountPage,
  '/account/link-device': AccountPage,
  '/account/settings': AccountSettings,
  '/account/restore': AccountRestore,
  '/account/billing': BillingPage,
  '/account/billing/return': BillingPage,
}

/** An account page loads under its own card, not the analytics skeleton. */
function accountPage(Page: ComponentType) {
  return <Suspense fallback={<AnalyticsRouteFallback variant="account" />}><Page /></Suspense>
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

/**
 * The old help pages are sections of /help now. Each keeps its query and maps
 * its old anchors to the same place on Help, so links from the extension,
 * other sites and bookmarks still land on the right part.
 */
function HelpRedirect({ section, anchors = {} }: { section: string; anchors?: Record<string, string> }) {
  const { search, hash } = useLocation()
  const anchor = hash.slice(1)
  return <Navigate to={`/help${search}#${anchors[anchor] ?? section}`} replace />
}

const DOCS_ANCHORS = { extension: 'install', analytics: 'hub', coverage: 'coverage', api: 'api', help: 'ask' }
const SUPPORT_ANCHORS = { install: 'install', 'send-feedback': 'feedback', 'billing-email': 'billing-email', contact: 'contact', security: 'security' }

function TimestampToolRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/guides/twitch-vod-timestamps${search}`} replace />
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
      {AccountSync && accountMomentsEnabled() ? <Suspense fallback={null}><AccountSync /></Suspense> : null}
    </PageErrorBoundary>
  )
}

function PortalRoutes() {
  return (
    <Suspense fallback={<AnalyticsRouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<AnalyticsAliasRedirect />} />
        {/* The timestamp builder now sits at the top of its guide. */}
        <Route path="/tools/twitch-vod-timestamp-link" element={<TimestampToolRedirect />} />
        <Route path="/guides/find-twitch-moments" element={<FindTwitchMomentsGuide />} />
        <Route path="/guides/twitch-vod-timestamps" element={<TwitchVodTimestampsGuide />} />
        <Route path="/recaps" element={<Recaps />} />
        <Route path="/help" element={<Help />} />
        {/* Install, the docs, Support and Feedback are sections of Help. */}
        <Route path="/docs" element={<HelpRedirect section="install" anchors={DOCS_ANCHORS} />} />
        <Route path="/install" element={<HelpRedirect section="install" />} />
        <Route path="/docs/getting-started" element={<HelpRedirect section="install" />} />
        <Route path="/docs/coverage" element={<HelpRedirect section="coverage" />} />
        <Route path="/docs/api" element={<HelpRedirect section="api" />} />
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
        <Route path="/support" element={<HelpRedirect section="fix" anchors={SUPPORT_ANCHORS} />} />
        {/* The extension's "Send feedback" opens the form on Help. */}
        <Route path="/feedback" element={<HelpRedirect section="feedback" />} />
        {/* The extension's "Join Discord" opens this page; it forwards to the
            build-time invite, or says the server is not open yet. */}
        <Route path="/discord" element={<Discord />} />
        {/* The extension's "Release details" links open this page. */}
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/account/sign-in" element={accountPage(AccountPage)} />
        <Route path="/account/settings" element={accountPage(AccountSettings)} />
        <Route path="/account/confirm" element={accountPage(AccountPage)} />
        <Route path="/account/restore" element={accountPage(AccountRestore)} />
        <Route path="/account/link-device" element={accountPage(AccountPage)} />
        <Route path="/account/billing" element={accountPage(BillingPage)} />
        <Route path="/account/billing/return" element={accountPage(BillingPage)} />
        {/* Sign in with Twitch (VITE_TWITCH_SIGNIN=1). While off, the path is
            the ordinary 404; main.tsx still strips any token from its URL.
            Show my Twitch follows returns here too, and main.tsx moves that
            return back to the page that asked before the routes render. */}
        {AccountTwitchCallback && twitchSignInEnabled() ? <Route path="/account/twitch/callback" element={<AccountTwitchCallback />} /> : null}
        {/* My Moments (VITE_ACCOUNT_MOMENTS=1); while off, the ordinary 404. */}
        {AccountMoments && accountMomentsEnabled() ? <Route path="/account/moments" element={<AccountMoments />} /> : null}
        {/* The one Account page and My Moments' short address, with My Moments on. */}
        {AccountHome && accountMomentsEnabled() ? <Route path="/account" element={<AccountHome />} /> : null}
        {AccountMoments && accountMomentsEnabled() ? <Route path="/moments" element={<Navigate to="/account/moments" replace />} /> : null}

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
        {/* Without the clip page, a clip address is a 404, never a channel named "clips". */}
        {NativeClipWatchPage ? <Route path="/analytics/clips/:clipId" element={<NativeClipWatchPage />} /> : <Route path="/analytics/clips/*" element={<NotFound />} />}
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
