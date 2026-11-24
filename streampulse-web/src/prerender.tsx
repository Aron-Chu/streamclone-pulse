import FindTwitchMomentsGuide from './routes/public/FindTwitchMomentsGuide'
import TwitchVodTimestampsGuide from './routes/public/TwitchVodTimestampsGuide'
import Recaps from './routes/public/Recaps'
export { GROWTH_PAGES } from './lib/growthPages'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import Landing from './routes/public/Landing'
import Help from './routes/public/Help'
import Privacy from './routes/public/Privacy'
import Terms from './routes/public/Terms'
import Refunds from './routes/public/Refunds'
import Withdraw from './routes/public/Withdraw'
import Supporter from './routes/public/Supporter'
import SupporterThanks from './routes/public/SupporterThanks'
import AccountRestore from './routes/account/AccountRestore'
import Discord from './routes/public/Discord'
import Status from './routes/public/Status'
import Changelog from './routes/public/Changelog'
import BrainChat from './routes/public/BrainChat'
import NotFound from './routes/public/NotFound'
import { PublicLayout } from './ui/components/PublicLayout'
import { AnalyticsRouteFallback } from './routes/AnalyticsRouteFallback'
import AnalyticsHubV5Page from './routes/analytics/AnalyticsHubV5Page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/** Render the actual public components, without a network request or private state. */
export function prerenderPublicPage(path: string): string {
  // The builder's old address shows the guide it moved into; the old help pages show Help. Both point search to the new page.
  const page = path === '/guides/twitch-vod-timestamps' || path === '/tools/twitch-vod-timestamp-link' ? <TwitchVodTimestampsGuide />
    : path === '/guides/find-twitch-moments' ? <FindTwitchMomentsGuide />
    : path === '/recaps' ? <Recaps />
    : path === '/' ? <Landing />
    : ['/help', '/docs', '/support', '/feedback'].includes(path) || path.startsWith('/docs/') ? <Help />
    : path === '/privacy' ? <Privacy />
    : path === '/terms' ? <Terms />
    : path === '/refunds' ? <Refunds />
    : path === '/withdraw' ? <Withdraw />
    : path === '/supporter' ? <Supporter />
    : path === '/supporter/thanks' ? <SupporterThanks />
    : path === '/account/restore' ? <AccountRestore />
    : path === '/discord' ? <Discord />
    : path === '/status' ? <Status />
    : path === '/changelog' ? <Changelog />
    : path === '/brainchat' ? <BrainChat />
    // The hub as it first renders, waiting on its data: main.tsx loads it before the first render, so it never flashes.
    : path === '/analytics' ? <QueryClientProvider client={new QueryClient()}><AnalyticsHubV5Page /></QueryClientProvider>
    // Stream, channel and recap documents keep the loading shell: their pages load after the first render.
    : ['/analytics-fallback', '/setup', '/login'].includes(path)
      ? <><AnalyticsRouteFallback /><noscript><style>{'[data-analytics-route-skeleton]{display:none}'}</style><PublicLayout><article className="panel public-document"><h1>StreamPulse Analytics</h1>
        <p>Explore aggregate Twitch activity, timestamped moments, emotes, and tracked channels.</p>
        <p>Live measurements load when JavaScript is available. Coverage and freshness are shown with the data.</p>
        <a href="/help#hub">Read how the Hub works</a></article></PublicLayout></noscript></>
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
