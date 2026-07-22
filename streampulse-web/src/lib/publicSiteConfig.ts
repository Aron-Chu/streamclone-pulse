/**
 * Canonical public StreamPulse site + Chrome Web Store identifiers.
 * Website install CTAs must use CHROME_WEB_STORE_LISTING_URL only (never chrome://).
 */
export const STREAM_PULSE_HOSTED_API_URL = 'https://api.streampulse.stream' as const

export const STREAM_PULSE_ANALYTICS_URL = 'https://streampulse.stream/analytics/' as const
export const STREAM_PULSE_SUPPORT_URL = 'https://streampulse.stream/support' as const
export const STREAM_PULSE_PRIVACY_URL = 'https://streampulse.stream/privacy' as const

/** Published Chrome Web Store extension id. */
export const CHROME_WEB_STORE_EXTENSION_ID = 'nifgoonpcgmdhiffcpmhndjgkgahnelg' as const

/** Canonical public listing — sole install destination for website CTAs. */
export const CHROME_WEB_STORE_LISTING_URL =
  `https://chromewebstore.google.com/detail/streampulse/${CHROME_WEB_STORE_EXTENSION_ID}` as const

export const PUBLIC_SITE = {
  hostedApiUrl: STREAM_PULSE_HOSTED_API_URL,
  analyticsUrl: STREAM_PULSE_ANALYTICS_URL,
  supportUrl: STREAM_PULSE_SUPPORT_URL,
  privacyUrl: STREAM_PULSE_PRIVACY_URL,
  chromeWebStoreListingUrl: CHROME_WEB_STORE_LISTING_URL,
  chromeWebStoreExtensionId: CHROME_WEB_STORE_EXTENSION_ID,
} as const

export type PublicSiteConfig = typeof PUBLIC_SITE
