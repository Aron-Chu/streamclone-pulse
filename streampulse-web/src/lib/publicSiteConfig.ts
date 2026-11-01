/**
 * Canonical public StreamPulse site and verified browser-store listings.
 * Website install CTAs must use these public listings (never chrome://).
 */
export const STREAM_PULSE_HOSTED_API_URL = 'https://api.streampulse.stream' as const

export const STREAM_PULSE_ANALYTICS_URL = 'https://streampulse.stream/analytics' as const
export const STREAM_PULSE_SUPPORT_URL = 'https://streampulse.stream/support' as const
export const STREAM_PULSE_PRIVACY_URL = 'https://streampulse.stream/privacy' as const

/** Published Chrome Web Store extension id. */
export const CHROME_WEB_STORE_EXTENSION_ID = 'nifgoonpcgmdhiffcpmhndjgkgahnelg' as const

/** Canonical public Chrome listing. */
export const CHROME_WEB_STORE_LISTING_URL =
  `https://chromewebstore.google.com/detail/streampulse/${CHROME_WEB_STORE_EXTENSION_ID}` as const

/** Published Firefox listing, verified against the extension's Gecko id. */
export const FIREFOX_ADDONS_LISTING_URL = 'https://addons.mozilla.org/en-US/firefox/addon/streampulse/' as const

/**
 * Fixed utm_medium values for store links. Only the kind of page goes to the store, never the path,
 * so a channel or stream id in the URL never reaches Google.
 */
const STORE_LINK_PAGES = [
  'home', 'analytics', 'account', 'docs', 'status', 'privacy', 'terms', 'refunds',
  'tools', 'guides', 'supporter', 'support', 'feedback', 'discord', 'changelog', 'site',
] as const
export type StoreLinkPage = (typeof STORE_LINK_PAGES)[number]

function isStoreLinkPage(value: string): value is StoreLinkPage {
  return (STORE_LINK_PAGES as readonly string[]).includes(value)
}

/** The store-link page kind for a site path: '/' is 'home', /s/* is 'analytics', a listed first segment is itself, else 'site'. */
export function storeLinkPageForPath(pathname: string): StoreLinkPage {
  const first = pathname.split('/').find(Boolean) ?? ''
  if (!first) return 'home'
  if (first === 's') return 'analytics'
  return isStoreLinkPage(first) ? first : 'site'
}

export function chromeWebStoreUrlForPage(page: StoreLinkPage): string {
  const url = new URL(CHROME_WEB_STORE_LISTING_URL)
  url.searchParams.set('utm_source', 'streampulse.stream')
  url.searchParams.set('utm_medium', isStoreLinkPage(page) ? page : 'site')
  return url.toString()
}

export const PUBLIC_SITE = {
  hostedApiUrl: STREAM_PULSE_HOSTED_API_URL,
  analyticsUrl: STREAM_PULSE_ANALYTICS_URL,
  supportUrl: STREAM_PULSE_SUPPORT_URL,
  privacyUrl: STREAM_PULSE_PRIVACY_URL,
  chromeWebStoreListingUrl: CHROME_WEB_STORE_LISTING_URL,
  chromeWebStoreExtensionId: CHROME_WEB_STORE_EXTENSION_ID,
  firefoxAddonsListingUrl: FIREFOX_ADDONS_LISTING_URL,
} as const

export type PublicSiteConfig = typeof PUBLIC_SITE
