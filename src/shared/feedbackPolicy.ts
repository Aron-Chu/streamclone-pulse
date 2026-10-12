/**
 * The website's private feedback form may stay off at launch (owner decision
 * D19). Until it opens, the website's /feedback page lists only public places to
 * ask (Discord and GitHub), so the settings "Send feedback" link must make no
 * privacy promise: its subline stays neutral.
 *
 * Set FEEDBACK_FORM_LIVE to true only in a release built after the form is on
 * (support cases with a private delivery adapter, Turnstile key in the deployed
 * portal). The subline then reads "Private to the team". The release checklist
 * (docs/pulse-extension/release.md) and the store review checklist say the same.
 *
 * Its own module so tests can flip it (vi.mock) and keep both states covered.
 */
export const FEEDBACK_FORM_LIVE: boolean = false

/** The visible subline under "Send feedback" in the settings Community card. */
export const FEEDBACK_DETAIL_NEUTRAL = 'Ideas or problems'
export const FEEDBACK_DETAIL_PRIVATE = 'Private to the team'
