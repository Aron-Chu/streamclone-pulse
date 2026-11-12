import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_INSTALL_STORE, INSTALL_STORE_NAMES, detectInstallStore, installStoreUrl, type InstallStore } from '../../lib/installBrowser'
import { storeLinkPageForPath } from '../../lib/publicSiteConfig'
import { capturePublicCta } from '../../lib/productAnalytics'

export type InstallCtaProps = {
  className?: string
  /** "long": Add StreamPulse to Chrome; "short": Add to Chrome. */
  label?: 'long' | 'short'
  /** "mark" draws the store's browser mark before the label. */
  icon?: 'mark' | ReactNode
  /** A fixed store, for the install guide's per-browser list. Otherwise the visitor's browser picks it. */
  store?: InstallStore
  /** Extra class for layout tests (nav vs hero vs analytics). */
  'data-cta'?: string
}

/**
 * The one public-site install button. It shows the visitor's own browser's
 * store after load (Chrome until then, the label keeps its width) and always
 * opens the public listing in a new tab, never chrome://. Does not claim or
 * detect whether the extension is installed.
 */
export function InstallCta({
  className,
  label = 'long',
  icon,
  store: fixedStore,
  'data-cta': dataCta = 'chrome-install',
}: InstallCtaProps) {
  const [detected, setDetected] = useState<InstallStore>(DEFAULT_INSTALL_STORE)
  useEffect(() => {
    if (!fixedStore) setDetected(detectInstallStore())
  }, [fixedStore])
  const store = fixedStore ?? detected
  const page = typeof window === 'undefined' ? 'home' : storeLinkPageForPath(window.location.pathname)
  const href = installStoreUrl(store, page)
  const name = INSTALL_STORE_NAMES[store]
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-cta={dataCta}
      data-store={store}
      data-store-listing={href}
      data-cws-listing={store === 'chrome' ? href : undefined}
      onClick={() => capturePublicCta('install_extension')}
    >
      {icon === 'mark' ? <span className={`${store}-mark`} aria-hidden="true" /> : icon}
      <span className="install-cta__label">{label === 'short' ? `Add to ${name}` : `Add StreamPulse to ${name}`}</span>
    </a>
  )
}
