// Bare /account depends on the build. With My Moments off (VITE_ACCOUNT_MOMENTS) it has no page, so
// public/_redirects sends it to Settings. With My Moments on, /account is Account Home, so a direct visit
// has to load the app there too, the same page in-app navigation opens.
export const ACCOUNT_SETTINGS_ALIASES = Object.freeze(['/account /account/settings 302', '/account/ /account/settings 302'])
export const ACCOUNT_HOME_RULES = Object.freeze(['/account/ /account 301', '/account / 200'])

/** Whether a build's env turns My Moments on, read as src/lib/accountMoments.ts reads it: only '1' does. */
export function accountMomentsOn(env) {
  return env.VITE_ACCOUNT_MOMENTS === '1'
}

/** public/_redirects for this build: the Settings alias with My Moments off, Account Home with it on. */
export function accountRedirects(source, momentsOn) {
  // A Windows checkout carries CRLF; compare without it and keep the file's own line ending.
  const lines = source.split('\n')
  const bare = lines.map((line) => line.replace(/\r$/, ''))
  const at = ACCOUNT_SETTINGS_ALIASES.map((rule) => bare.indexOf(rule))
  if (at.some((index) => index < 0) || at[1] !== at[0] + 1) {
    throw new Error(`public/_redirects must carry ${ACCOUNT_SETTINGS_ALIASES.join(' and ')} as two adjacent lines`)
  }
  if (!momentsOn) return source
  const eol = lines[at[0]].endsWith('\r') ? '\r' : ''
  lines.splice(at[0], 2, ...ACCOUNT_HOME_RULES.map((rule) => rule + eol))
  return lines.join('\n')
}
