import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { AnalyticsPreferences } from './AnalyticsPreferences'
import { capturePublicCta } from '../../lib/productAnalytics'
import { SITE_FOOTER_ITEMS, SITE_NAV_ITEMS } from '../../lib/siteNav'
import { SUPPORTER_WITHDRAWAL_PATH, supporterWithdrawalEnabled } from '../../lib/supporterWithdrawal'

/**
 * The one footer on every page: the home page, the site pages and the
 * analytics pages. The first row repeats the header's destinations; the second
 * holds site information and the analytics choice.
 */
export function SiteFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        {/* Footer classes, not utilities: the site's utilities exist only
            inside .app-shell, and the home and analytics pages have none. */}
        <div className="app-footer__lead">
          <Link to="/" className="app-footer__brand" aria-label="StreamPulse home">
            <BrandMark size={20} />
            <span className="app-footer__name">StreamPulse</span>
          </Link>
          <span className="app-footer__sep" aria-hidden="true">·</span>
          <span className="app-footer__tagline">Free Twitch chat and emote stats. Not affiliated with Twitch.</span>
        </div>
        {/* Two rows: where to go, then site information. Both rows keep the same
            colour and size — dimming the second would drop it below the
            contrast floor for small text. */}
        <nav className="app-footer__nav" aria-label="Footer">
          <div className="app-footer__links">
            {SITE_NAV_ITEMS.map((item) => (
              <Link key={item.to} to={item.to}
                onClick={item.to === '/analytics' ? () => capturePublicCta('open_analytics') : undefined}>
                {item.label}
              </Link>
            ))}
          </div>
          <div className="app-footer__links">
            {SITE_FOOTER_ITEMS.map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
            {supporterWithdrawalEnabled() ? <Link to={SUPPORTER_WITHDRAWAL_PATH}>Withdraw from contract here</Link> : null}
            <AnalyticsPreferences />
          </div>
        </nav>
      </div>
    </footer>
  )
}
