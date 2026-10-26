/** Public repository for StreamPulse extension + portal. */
export const GITHUB_REPO_URL = 'https://github.com/Aron-Chu/streamclone-pulse'

/** Where upcoming and in-progress work is tracked. */
export const ROADMAP_URL = `${GITHUB_REPO_URL}/issues`

/** Public, non-sensitive bug reports only. Never send vulnerability details here. */
export const PUBLIC_SUPPORT_URL = `${GITHUB_REPO_URL}/issues`

/**
 * GitHub private vulnerability reporting for this repository (enabled; only
 * the maintainers see a report). Needs a GitHub account.
 */
export const SECURITY_REPORT_URL = `${GITHUB_REPO_URL}/security/advisories/new`

/** Verified public live portal login: billing management only, never Checkout or access recovery. */
export const STRIPE_CUSTOMER_PORTAL_LOGIN_URL =
  'https://billing.stripe.com/p/login/fZueVd91paK85MAgKt8AE00' as const

/**
 * First-party policy and offer routes, as in-app paths.
 *
 * Held here so the footer, the legal pages and the Supporter offer cannot drift
 * apart, and so the extension's `src/shared/portalLinks.ts` has one set of paths
 * to mirror. No trailing slashes: these are the canonical forms used by
 * `public/sitemap.xml` and every `<link rel="canonical">`.
 */
export const PRIVACY_PATH = '/privacy'
export const TERMS_PATH = '/terms'
/** The Pulse Supporter section of the terms (the h2 in Terms.tsx carries id="supporter"). */
export const SUPPORTER_TERMS_PATH = '/terms#supporter'
export const REFUNDS_PATH = '/refunds'
export const SUPPORTER_PATH = '/supporter'

/**
 * The private feedback form. Only the StreamPulse team reads what is sent
 * there; the extension's "Send feedback" opens this page. /support keeps an
 * element with id `send-feedback` that links here, so older links still land.
 */
export const FEEDBACK_PATH = '/feedback'
