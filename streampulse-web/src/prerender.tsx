import TwitchTimestampTool from './routes/public/TwitchTimestampTool'
import FindTwitchMomentsGuide from './routes/public/FindTwitchMomentsGuide'
import TwitchVodTimestampsGuide from './routes/public/TwitchVodTimestampsGuide'
import Recaps from './routes/public/Recaps'
export { GROWTH_PAGES } from './lib/growthPages'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import Landing from './routes/public/Landing'
import Docs from './routes/public/Docs'
import Privacy from './routes/public/Privacy'
import Terms from './routes/public/Terms'
import Refunds from './routes/public/Refunds'
import Withdraw from './routes/public/Withdraw'
import Supporter from './routes/public/Supporter'
import SupporterThanks from './routes/public/SupporterThanks'
import AccountRestore from './routes/account/AccountRestore'
import Support from './routes/public/Support'
import Feedback from './routes/public/Feedback'
import Discord from './routes/public/Discord'
import Status from './routes/public/Status'
import Changelog from './routes/public/Changelog'
import NotFound from './routes/public/NotFound'
import { PublicLayout } from './ui/components/PublicLayout'
import { AnalyticsRouteFallback } from './routes/AnalyticsRouteFallback'
import AnalyticsHubV5Page from './routes/analytics/AnalyticsHubV5Page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/** Render the actual public components, without a network request or private state. */
export function prerenderPublicPage(path: string): string {
  const page = path === '/tools/twitch-vod-timestamp-link' ? <TwitchTimestampTool />
    : path === '/guides/find-twitch-moments' ? <FindTwitchMomentsGuide />
    : path === '/guides/twitch-vod-timestamps' ? <TwitchVodTimestampsGuide />
    : path === '/recaps' ? <Recaps />
    : path === '/' ? <Landing />
    : path === '/docs' || path.startsWith('/docs/') ? <Docs />
    : path === '/privacy' ? <Privacy />
    : path === '/terms' ? <Terms />
    : path === '/refunds' ? <Refunds />
    : path === '/withdraw' ? <Withdraw />
    : path === '/supporter' ? <Supporter />
    : path === '/supporter/thanks' ? <SupporterThanks />
    : path === '/account/restore' ? <AccountRestore />
    : path === '/support' ? <Support />
    : path === '/feedback' ? <Feedback />
    : path === '/discord' ? <Discord />
    : path === '/status' ? <Status />
    : path === '/changelog' ? <Changelog />
    // The hub as it first renders, waiting on its data: main.tsx loads it before the first render, so it never flashes.
    : path === '/analytics' ? <QueryClientProvider client={new QueryClient()}><AnalyticsHubV5Page /></QueryClientProvider>
    // Stream, channel and recap documents keep the loading shell: their pages load after the first render.
    : ['/analytics-fallback', '/setup', '/login'].includes(path)
      ? <><AnalyticsRouteFallback /><noscript><style>{'[data-analytics-route-skeleton]{display:none}'}</style><PublicLayout><article className="panel public-document"><h1>StreamPulse Analytics</h1>
        <p>Explore aggregate Twitch activity, timestamped moments, emotes, and tracked channels.</p>
        <p>Live measurements load when JavaScript is available. Coverage and freshness are shown with the data.</p>
        <a href="/docs#analytics">Read the analytics guide</a></article></PublicLayout></noscript></>
      : <NotFound />
  if (path !== '/analytics') return renderToString(<StaticRouter location={path}>{page}</StaticRouter>)
  // The hub measures itself in layout effects, which run once it mounts in the browser. On the server
  // React warns, once per component, that they do nothing; that is expected here, so it is not printed.
  const error = console.error
  console.error = (...args: unknown[]) => {
    if (!(typeof args[0] === 'string' && args[0].startsWith('Warning: useLayoutEffect does nothing on the server'))) error(...args)
  }
  try {
    return renderToString(<StaticRouter location={path}>{page}</StaticRouter>)
  } finally {
    console.error = error
  }
}
