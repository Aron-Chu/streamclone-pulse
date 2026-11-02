/**
 * Which store an install button opens: the visitor's own browser's, read once
 * after load. One button, never a picker: Edge gets Edge Add-ons, Firefox gets
 * Firefox Add-ons, and every other browser (Chrome, Brave, Opera, Safari,
 * unknown) gets the Chrome Web Store. Nothing here redirects on its own.
 */
import {
  EDGE_ADDONS_LISTING_URL,
  FIREFOX_ADDONS_LISTING_URL,
  chromeWebStoreUrlForPage,
  type StoreLinkPage,
} from './publicSiteConfig'

export type InstallStore = 'chrome' | 'edge' | 'firefox'

/** The store a server render and an unknown browser use. */
export const DEFAULT_INSTALL_STORE: InstallStore = 'chrome'

export const INSTALL_STORE_NAMES: Record<InstallStore, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
}

type BrowserHints = {
  userAgent?: string
  userAgentData?: { brands?: ReadonlyArray<{ brand: string }> }
}

/** Edge first: its user agent also says Chrome. */
export function detectInstallStore(hints: BrowserHints | undefined = typeof navigator === 'undefined' ? undefined : navigator): InstallStore {
  if (!hints) return DEFAULT_INSTALL_STORE
  const ua = hints.userAgent ?? ''
  if (hints.userAgentData?.brands?.some((b) => b.brand === 'Microsoft Edge') || /\bEdg(?:e|A|iOS)?\//.test(ua)) return 'edge'
  if (/\b(?:Firefox|FxiOS)\//.test(ua)) return 'firefox'
  return DEFAULT_INSTALL_STORE
}

/** The store listing. Only the Chrome link carries the fixed page kind (never the path). */
export function installStoreUrl(store: InstallStore, page: StoreLinkPage): string {
  if (store === 'edge') return EDGE_ADDONS_LISTING_URL
  if (store === 'firefox') return FIREFOX_ADDONS_LISTING_URL
  return chromeWebStoreUrlForPage(page)
}
