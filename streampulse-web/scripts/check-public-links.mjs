#!/usr/bin/env node
/**
 * Every internal link on a prerendered public page must resolve.
 *
 * This exists because the extension shipped a Supporter card linking to
 * `/account/billing`, a path that was in neither the router, `_redirects`, nor
 * `sitemap.xml`. Nothing caught it: the build was green and the link 404'd. A
 * page can also be "reachable" and still cost a redirect hop on every click, so
 * trailing-slash forms are rejected too.
 *
 * A path resolves if it is:
 *   - a prerendered artifact (`dist/<path>/index.html`), or
 *   - an SPA path rewritten to the shell with a 200 in `public/_redirects`, or
 *   - covered by a `_redirects` 301, or
 *   - a dynamic analytics route, which the SPA resolves at runtime.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..')
const dist = join(webRoot, 'dist')

/** Dynamic routes resolved by the SPA from a path parameter. */
const DYNAMIC_PREFIXES = ['/analytics/', '/s/']

function htmlFiles(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === 'assets') continue
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) htmlFiles(full, found)
    else if (entry.endsWith('.html')) found.push(full)
  }
  return found
}

const redirects = existsSync(join(webRoot, 'public', '_redirects'))
  ? readFileSync(join(webRoot, 'public', '_redirects'), 'utf8')
  : ''
const redirectSources = new Set(
  redirects
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => line.trim().split(/\s+/)[0]),
)

function resolves(path) {
  if (path === '/') return existsSync(join(dist, 'index.html'))
  if (redirectSources.has(path)) return true
  if (DYNAMIC_PREFIXES.some(prefix => path.startsWith(prefix))) return true
  const clean = path.replace(/^\//, '')
  return existsSync(join(dist, clean, 'index.html')) || existsSync(join(dist, `${clean}.html`))
}

const failures = []
const seen = new Set()

if (!existsSync(dist)) {
  console.error('check:public-links — dist/ is missing; run the build first')
  process.exit(1)
}

for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, 'utf8')
  for (const match of html.matchAll(/href="(\/[^"#?]*)(?:[#?][^"]*)?"/g)) {
    const path = match[1]
    // Asset and crawl-policy references are not navigations.
    if (path.startsWith('/assets/') || /\.(?:css|js|svg|png|ico|xml|txt|webmanifest)$/.test(path)) continue
    const key = `${file}|${path}`
    if (seen.has(key)) continue
    seen.add(key)
    if (path !== '/' && path.endsWith('/')) {
      failures.push(`${path} (in ${file}): trailing slash costs a redirect hop; use the canonical form`)
      continue
    }
    if (!resolves(path)) failures.push(`${path} (in ${file}): does not resolve to any artifact, rewrite or dynamic route`)
  }
}

/** Paths the extension and the sign-in email publish. These must exist too. */
const EXTERNALLY_PUBLISHED = ['/privacy', '/terms', '/refunds', '/support', '/supporter', '/status', '/docs']
for (const path of EXTERNALLY_PUBLISHED) {
  if (!resolves(path)) failures.push(`${path}: published by the extension or sign-in email but does not resolve`)
}

if (failures.length > 0) {
  console.error('check:public-links FAILED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`check:public-links OK (${seen.size} internal links, ${EXTERNALLY_PUBLISHED.length} published paths)`)
