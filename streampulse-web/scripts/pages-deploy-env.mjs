/**
 * Production build inputs that pages:deploy:prod refuses to ship without.
 *
 * Vite inlines these at build time, and the app silently drops each feature when
 * its value is missing or malformed, so a deploy from a fresh shell would quietly
 * remove error reporting, analytics, the feedback form's bot check or every
 * Discord link. Each one therefore has to be present and well formed, or be
 * waived on purpose with its own PAGES_DEPLOY_ALLOW_NO_* flag set to exactly 1.
 *
 * Only variable NAMES are ever reported here; values are never printed.
 */

// Mirrors parseDiscordInviteUrl in src/lib/discord.ts, which hides every Discord
// link for anything else (tests/pagesDeployEnv.test.ts keeps the two in step).
function isDiscordInvite(value) {
  if (/\s/.test(value) || value.includes('?') || value.includes('#')) return false
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false
  const segments = url.pathname.split('/').slice(1)
  let code
  if (url.hostname === 'discord.gg' && segments.length === 1) code = segments[0]
  else if (url.hostname === 'discord.com' && segments.length === 2 && segments[0] === 'invite') code = segments[1]
  return Boolean(code) && /^[A-Za-z0-9-]{2,64}$/.test(code)
}

function isSentryDsn(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.username) && /^\/\d+$/.test(url.pathname)
  } catch {
    return false
  }
}

export const REQUIRED_PRODUCTION_INPUTS = Object.freeze([
  {
    name: 'VITE_SENTRY_DSN',
    optOut: 'PAGES_DEPLOY_ALLOW_NO_SENTRY',
    feature: 'website error reporting (Sentry)',
    valid: isSentryDsn,
    format: 'an https Sentry DSN with a public key and a numeric project id',
  },
  {
    name: 'VITE_POSTHOG_PROJECT_TOKEN',
    optOut: 'PAGES_DEPLOY_ALLOW_NO_POSTHOG',
    feature: 'opt-in product analytics (PostHog)',
    // Same rule as src/lib/productAnalytics.ts, which ignores anything else.
    valid: value => /^phc_[A-Za-z0-9]+$/.test(value),
    format: 'a phc_ project token',
  },
  {
    name: 'VITE_TURNSTILE_SITE_KEY',
    optOut: 'PAGES_DEPLOY_ALLOW_NO_TURNSTILE',
    feature: 'the private feedback form bot check (Turnstile)',
    valid: value => /^[A-Za-z0-9_-]{8,128}$/.test(value),
    format: 'a Turnstile site key',
  },
  {
    name: 'VITE_PUBLIC_DISCORD_INVITE_URL',
    optOut: 'PAGES_DEPLOY_ALLOW_NO_DISCORD',
    feature: 'every Discord button and the /discord page',
    valid: isDiscordInvite,
    format: 'https://discord.gg/<code> or https://discord.com/invite/<code>',
  },
])

/**
 * Check the production build environment. `env` is the merged environment the
 * Vite build will see (process.env plus any .env.production files).
 * Returns { errors, waived }: errors block the deploy; waived inputs must be
 * announced loudly by the caller.
 */
export function checkProductionBuildEnv(env) {
  const errors = []
  const waived = []
  for (const input of REQUIRED_PRODUCTION_INPUTS) {
    const value = typeof env[input.name] === 'string' ? env[input.name].trim() : ''
    const optOut = typeof env[input.optOut] === 'string' ? env[input.optOut].trim() : ''
    if (optOut && optOut !== '1') {
      errors.push(`${input.optOut} must be exactly 1 to waive ${input.name}`)
      continue
    }
    if (value) {
      if (!input.valid(value)) errors.push(`${input.name} is set but is not ${input.format}; the build would drop ${input.feature}`)
      else if (optOut === '1') errors.push(`${input.optOut}=1 is set while ${input.name} is also set; remove one`)
      continue
    }
    if (optOut === '1') {
      waived.push(input)
      continue
    }
    errors.push(`${input.name} is not set; the build would ship without ${input.feature}. Set it, or set ${input.optOut}=1 to deploy without it on purpose`)
  }
  const dsn = typeof env.VITE_SENTRY_DSN === 'string' ? env.VITE_SENTRY_DSN.trim() : ''
  const auth = typeof env.SENTRY_AUTH_TOKEN === 'string' ? env.SENTRY_AUTH_TOKEN.trim() : ''
  if (dsn && !auth) errors.push('VITE_SENTRY_DSN is set but SENTRY_AUTH_TOKEN is missing (source maps could not be uploaded)')
  return { errors, waived }
}

/** Loud, unmissable banner lines for each waived input (names only). */
export function describeWaivedInputs(waived) {
  if (waived.length === 0) return []
  const bar = '!'.repeat(78)
  return [
    bar,
    `!! pages:deploy:prod: deploying WITHOUT ${waived.length} production input(s) on purpose:`,
    ...waived.map(input => `!!   ${input.name} waived by ${input.optOut}=1: this build ships without ${input.feature}`),
    bar,
  ]
}
