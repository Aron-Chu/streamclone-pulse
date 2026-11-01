import { FIREFOX_ADDONS_LISTING_URL } from '../../lib/publicSiteConfig'
import { capturePublicCta } from '../../lib/productAnalytics'

/** Uses the same opt-in, category-only install event as the Chrome control. */
export function FirefoxInstallCta({ className }: { className?: string }) {
  return (
    <a
      className={className}
      href={FIREFOX_ADDONS_LISTING_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-cta="firefox-install-docs"
      onClick={() => capturePublicCta('install_extension')}
    >
      Add to Firefox
    </a>
  )
}
