import type { ReactNode } from 'react'
import { chromeWebStoreUrlForPage, storeLinkPageForPath } from '../../lib/publicSiteConfig'
import { capturePublicCta } from '../../lib/productAnalytics'

export type ChromeInstallCtaProps = {
  className?: string
  children?: ReactNode
  /** Extra class for layout tests (nav vs hero vs analytics). */
  'data-cta'?: string
}

/**
 * Public-site “Add StreamPulse to Chrome” control.
 * Always opens the canonical CWS listing in a new tab; never uses chrome://.
 * Does not claim or detect extension install state on the website.
 */
export function ChromeInstallCta({
  className,
  children = 'Add StreamPulse to Chrome',
  'data-cta': dataCta = 'chrome-install',
}: ChromeInstallCtaProps) {
  const page = typeof window === 'undefined' ? 'home' : storeLinkPageForPath(window.location.pathname)
  const listingUrl = chromeWebStoreUrlForPage(page)
  return (
    <a
      className={className}
      href={listingUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-cta={dataCta}
      data-cws-listing={listingUrl}
      onClick={() => capturePublicCta('install_extension')}
    >
      {children}
    </a>
  )
}
