import { HELP_PATH, PRIVACY_PATH, TERMS_PATH } from './externalLinks'

export interface SiteNavItem {
  label: string
  to: string
  /** Active only on this exact path (the Hub link stays off on Moments). */
  end?: boolean
}

/**
 * The site's main destinations, in every header and footer: the home page,
 * the site pages and the analytics pages all list these, under these names.
 */
export const SITE_NAV_ITEMS: readonly SiteNavItem[] = [
  { label: 'Hub', to: '/analytics', end: true },
  { label: 'Moments', to: '/analytics/moments' },
  { label: 'Help', to: HELP_PATH },
]

/** Site information: the footer's second row, and the analytics bar's menu. */
export const SITE_FOOTER_ITEMS: readonly SiteNavItem[] = [
  { label: 'Status', to: '/status' },
  { label: 'Changelog', to: '/changelog' },
  { label: 'Privacy', to: PRIVACY_PATH },
  { label: 'Terms', to: TERMS_PATH },
]
