import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import Landing from './routes/public/Landing'
import Docs from './routes/public/Docs'
import Privacy from './routes/public/Privacy'
import Terms from './routes/public/Terms'
import Refunds from './routes/public/Refunds'
import Supporter from './routes/public/Supporter'
import SupporterThanks from './routes/public/SupporterThanks'
import AccountRestore from './routes/account/AccountRestore'
import Support from './routes/public/Support'
import Discord from './routes/public/Discord'
import Status from './routes/public/Status'
import Changelog from './routes/public/Changelog'
import NotFound from './routes/public/NotFound'
import { PublicLayout } from './ui/components/PublicLayout'
import { AnalyticsRouteFallback } from './routes/AnalyticsRouteFallback'

/** Render the actual public components, without a network request or private state. */
export function prerenderPublicPage(path: string): string {
  const page = path === '/' ? <Landing />
    : path === '/docs' || path.startsWith('/docs/') ? <Docs />
    : path === '/privacy' ? <Privacy />
    : path === '/terms' ? <Terms />
    : path === '/refunds' ? <Refunds />
    : path === '/supporter' ? <Supporter />
    : path === '/supporter/thanks' ? <SupporterThanks />
    : path === '/account/restore' ? <AccountRestore />
    : path === '/support' ? <Support />
    : path === '/discord' ? <Discord />
    : path === '/status' ? <Status />
    : path === '/changelog' ? <Changelog />
    : ['/analytics', '/setup', '/login'].includes(path)
      ? <><AnalyticsRouteFallback /><noscript><style>{'[data-analytics-route-skeleton]{display:none}'}</style><PublicLayout><article className="panel public-document"><h1>StreamPulse Analytics</h1>
        <p>Explore aggregate Twitch activity, timestamped moments, emotes, and tracked channels.</p>
        <p>Live measurements load when JavaScript is available. Coverage and freshness are shown with the data.</p>
        <a href="/docs#analytics">Read the analytics guide</a></article></PublicLayout></noscript></>
      : <NotFound />
  return renderToString(<StaticRouter location={path}>{page}</StaticRouter>)
}
