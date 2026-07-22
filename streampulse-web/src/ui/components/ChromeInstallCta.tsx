import type { ReactNode } from 'react'
import { CHROME_WEB_STORE_LISTING_URL } from '../../lib/publicSiteConfig'

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
  return (
    <a
      className={className}
      href={CHROME_WEB_STORE_LISTING_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-cta={dataCta}
      data-cws-listing={CHROME_WEB_STORE_LISTING_URL}
    >
      {children}
    </a>
  )
}
