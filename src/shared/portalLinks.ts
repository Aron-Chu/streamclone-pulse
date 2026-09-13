import { safeWebAnalyticsOrigin } from './analyticsLinks.ts'

/**
 * Every streampulse.stream link the extension publishes, in one place.
 *
 * Two classes of link, deliberately different:
 *
 *   - **Policy links are always canonical production.** A local dev portal has no
 *     privacy policy, and the published policy is a single canonical document, so
 *     a configured dev origin must never rewrite where it points.
 *   - **Product links follow the configured portal origin**, so `/supporter` and
 *     the account pages resolve against a local portal during development instead
 *     of sending a developer to production.
 *
 * No trailing slashes anywhere. `public/sitemap.xml` and every
 * `<link rel="canonical">` use the bare path, so a trailing slash costs a
 * redirect hop on every click.
 *
 * This module must stay out of the content bundle — the content-script gzip
 * budget has three figures of headroom. `tests/portalLinks.test.ts` asserts it.
 */
export const CANONICAL_PORTAL_ORIGIN = 'https://streampulse.stream'

/** Legal and help destinations. Always production, never a configured origin. */
export const POLICY_LINKS = {
  privacy: `${CANONICAL_PORTAL_ORIGIN}/privacy`,
  terms: `${CANONICAL_PORTAL_ORIGIN}/terms`,
  refunds: `${CANONICAL_PORTAL_ORIGIN}/refunds`,
  support: `${CANONICAL_PORTAL_ORIGIN}/support`,
} as const

const PRODUCT_PATHS = {
  supporter: '/supporter',
  billing: '/account/billing',
  signIn: '/account/sign-in',
  linkDevice: '/account/link-device',
} as const

export type ProductLinkName = keyof typeof PRODUCT_PATHS

/**
 * An unrecognized origin falls back to production rather than being emitted:
 * a link is a place we send the user, so an unvalidated origin must never
 * become an `href`.
 */
export function portalOriginOrCanonical(portalOrigin?: string | null): string {
  if (!portalOrigin) return CANONICAL_PORTAL_ORIGIN
  return safeWebAnalyticsOrigin(portalOrigin) ?? CANONICAL_PORTAL_ORIGIN
}

export function productLink(name: ProductLinkName, portalOrigin?: string | null): string {
  return `${portalOriginOrCanonical(portalOrigin)}${PRODUCT_PATHS[name]}`
}
