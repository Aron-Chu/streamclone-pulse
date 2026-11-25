/**
 * A Moment's own page (/analytics/moments/<stream id>/<minute>) ships behind the build switch
 * VITE_PUBLIC_MOMENT_PAGE. public/_redirects carries its two rewrite lines; a build with the switch off
 * leaves them out of dist/_redirects, so the address answers 404 as it did before the page instead of
 * the noindex fallback with 200.
 */

/** The two rule sources, each once in public/_redirects. */
export const MOMENT_PAGE_RULES = Object.freeze([
  '/analytics/moments/:streamId/:momentAt',
  '/analytics/moments/:streamId/:momentAt/',
])

/** The same "on" spellings as momentPageEnabled() in src/lib/momentPageFlag.ts. */
export function momentPageOn(env) {
  const value = env?.VITE_PUBLIC_MOMENT_PAGE
  return value === 'on' || value === '1'
}

/**
 * `source` (the text of public/_redirects) for this build: unchanged with the switch on, without the
 * Moment page's two lines with it off. Throws when either line is not there exactly once, so a renamed
 * rule can never stay behind in a build that is off.
 */
export function momentPageRedirects(source, env) {
  const lines = source.split('\n')
  const ruleOf = (line) => line.trim().split(/\s+/)[0]
  for (const rule of MOMENT_PAGE_RULES) {
    const count = lines.filter((line) => ruleOf(line) === rule).length
    if (count !== 1) throw new Error(`public/_redirects: expected the Moment page rule ${rule} once, found ${count}`)
  }
  if (momentPageOn(env)) return source
  return lines.filter((line) => !MOMENT_PAGE_RULES.includes(ruleOf(line))).join('\n')
}
