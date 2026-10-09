#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { textContainsHostedApiOrigin } from '../../scripts/lib/hosted-api-origin.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, '..', 'dist')

const expected = [
  ['index.html', 'StreamPulse — Twitch reaction analytics', 'index,follow', 'https://streampulse.stream/'],
  ['analytics/index.html', 'StreamPulse Analytics', 'index,follow', 'https://streampulse.stream/analytics'],
  ['docs/index.html', 'Documentation — StreamPulse', 'index,follow', 'https://streampulse.stream/docs'],
  ['status/index.html', 'Service Status — StreamPulse', 'index,follow', 'https://streampulse.stream/status'],
  ['privacy/index.html', 'Privacy Policy — StreamPulse', 'index,follow', 'https://streampulse.stream/privacy'],
  ['terms/index.html', 'Terms of Use — StreamPulse', 'index,follow', 'https://streampulse.stream/terms'],
  ['refunds/index.html', 'Cancellation and Refunds — StreamPulse', 'index,follow', 'https://streampulse.stream/refunds'],
  ['supporter/index.html', 'Pulse Supporter — StreamPulse', 'index,follow', 'https://streampulse.stream/supporter'],
  ['supporter/thanks/index.html', 'Return to your extension — StreamPulse', 'noindex,nofollow', 'https://streampulse.stream/supporter/thanks'],
  ['account/restore/index.html', 'Restore Supporter — StreamPulse', 'noindex,nofollow', 'https://streampulse.stream/account/restore'],
  ['support/index.html', 'Support — StreamPulse', 'index,follow', 'https://streampulse.stream/support'],
  ['discord/index.html', 'Discord — StreamPulse', 'noindex,nofollow', 'https://streampulse.stream/discord'],
  ['changelog/index.html', 'Release Notes — StreamPulse', 'noindex,nofollow', 'https://streampulse.stream/changelog'],
  ['404.html', 'Page not found — StreamPulse', 'noindex,nofollow', 'https://streampulse.stream/'],
]

const SHARE_IMAGE = 'https://streampulse.stream/og-default.png'

function metaContent(html, attribute, key) {
  // Keys are fixed literals of letters, '_' and ':', so they need no regex escaping.
  const tags = html.match(new RegExp(`<meta\\s+${attribute}="${key}"[^>]*>`, 'gi')) ?? []
  if (tags.length !== 1) return tags.length === 0 ? undefined : null
  return /content="([^"]*)"/.exec(tags[0])?.[1]
}

/** Link previews: every page names the shared 1200x630 card and its own title/description. */
function linkPreviewFailures(relativePath, html, title, canonical) {
  const out = []
  const description = metaContent(html, 'name', 'description')
  if (!description) out.push(`${relativePath}: missing description`)
  const expectTag = (attribute, key, value) => {
    const actual = metaContent(html, attribute, key)
    if (actual === null) out.push(`${relativePath}: duplicate ${key}`)
    else if (actual !== value) out.push(`${relativePath}: ${key} is ${actual === undefined ? 'missing' : 'incorrect'}`)
  }
  expectTag('property', 'og:type', 'website')
  expectTag('property', 'og:site_name', 'StreamPulse')
  expectTag('property', 'og:title', title)
  expectTag('property', 'og:description', description)
  expectTag('property', 'og:url', canonical)
  expectTag('property', 'og:image', SHARE_IMAGE)
  expectTag('property', 'og:image:type', 'image/png')
  expectTag('property', 'og:image:width', '1200')
  expectTag('property', 'og:image:height', '630')
  if (!metaContent(html, 'property', 'og:image:alt')) out.push(`${relativePath}: og:image:alt is missing`)
  expectTag('name', 'twitter:card', 'summary_large_image')
  expectTag('name', 'twitter:title', title)
  expectTag('name', 'twitter:description', description)
  expectTag('name', 'twitter:image', SHARE_IMAGE)
  if (!metaContent(html, 'name', 'twitter:image:alt')) out.push(`${relativePath}: twitter:image:alt is missing`)
  return out
}

const failures = []
const sharePath = join(dist, 'og-default.png')
if (!existsSync(sharePath)) failures.push('og-default.png: missing link-preview image')
else {
  const png = readFileSync(sharePath)
  const isPng = png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (!isPng || png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) failures.push('og-default.png: not a 1200x630 PNG')
}
const manifestPath = join(dist, '.vite', 'manifest.json')
if (!existsSync(manifestPath)) failures.push('Missing emitted Vite manifest')
else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const name of ['AccountPage', 'AccountSettings', 'BillingPage', 'AccountRestore']) {
    const chunk = manifest[`src/routes/account/${name}.tsx`]
    if (!chunk?.file || !existsSync(join(dist, chunk.file))) failures.push(`${name}: missing emitted account route`)
  }
}
for (const [relativePath, title, robots, canonical] of expected) {
  const absolutePath = join(dist, relativePath)
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: missing`)
    continue
  }
  const html = readFileSync(absolutePath, 'utf8')
  if (!html.includes(`<title>${title}</title>`)) failures.push(`${relativePath}: incorrect title`)
  if (!html.includes(`<meta name="robots" content="${robots}" />`)) failures.push(`${relativePath}: incorrect robots policy`)
  if (!html.includes(`<link rel="canonical" href="${canonical}" />`)) failures.push(`${relativePath}: incorrect canonical URL`)
  failures.push(...linkPreviewFailures(relativePath, html, title, canonical))
  if (!textContainsHostedApiOrigin(html)) failures.push(`${relativePath}: hosted API CSP missing`)
  if (!/<div id="root"[^>]*>[\s\S]*?<h1\b/.test(html)) failures.push(`${relativePath}: missing meaningful prerendered heading`)
  if (/https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(html)) failures.push(`${relativePath}: local URL leaked into artifact`)
}

for (const relativePath of ['robots.txt', 'sitemap.xml', '_headers', '_redirects']) {
  if (!existsSync(join(dist, relativePath))) failures.push(`${relativePath}: missing`)
}

for (const route of ['analytics', 'docs', 'status', 'privacy', 'terms', 'refunds', 'supporter', 'support', 'discord', 'changelog']) {
  const aliasPath = join(dist, `${route}.html`)
  if (!existsSync(aliasPath)) failures.push(`${route}.html: missing clean-route Vite fallback alias`)
}

if (existsSync(join(dist, 'robots.txt'))) {
  const robots = readFileSync(join(dist, 'robots.txt'), 'utf8')
  if (!robots.includes('Content-signal: search=yes, ai-input=no, ai-train=no, use=reference')) {
    failures.push('robots.txt: missing AI content-use policy')
  }
  for (const agent of ['CCBot', 'ClaudeBot', 'GPTBot', 'Google-Extended', 'meta-externalagent']) {
    const escapedAgent = agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const agentBlock = new RegExp(`User-agent: ${escapedAgent}\\s+Disallow: /`, 'i')
    if (!agentBlock.test(robots)) failures.push(`robots.txt: ${agent} is not disallowed`)
  }
}

if (existsSync(join(dist, '_headers'))) {
  const headers = readFileSync(join(dist, '_headers'), 'utf8')
  const enforced = headers.split(/\r?\n/).find(line => /^\s+Content-Security-Policy:/.test(line))
  if (!enforced || !enforced.includes("object-src 'none'") || !enforced.includes("frame-ancestors 'none'") || enforced.includes("'unsafe-eval'")) {
    failures.push('_headers: missing or weakened enforcing Content-Security-Policy')
  }
  if (!headers.includes('Content-Signal: search=yes, ai-input=no, ai-train=no, use=reference')) {
    failures.push('_headers: missing AI content-use policy')
  }
}

if (existsSync(join(dist, '_redirects'))) {
  const redirects = readFileSync(join(dist, '_redirects'), 'utf8')
  for (const rule of [
    '/analytics/streams /analytics 301',
    '/analytics/hub /analytics 301',
    '/atlas /analytics 301',
    '/docs/getting-started /docs#extension 301',
    '/docs/coverage /docs#coverage 301',
    '/docs/api /docs#api 301',
    '/analytics/:login/:streamId /analytics/ 200',
    '/s/:login /analytics/ 200',
  ]) {
    if (!redirects.includes(rule)) failures.push(`_redirects: missing ${rule}`)
  }
}

if (failures.length > 0) {
  console.error('Public Pages artifact check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`check:public-pages OK (${expected.length} HTML artifacts + crawl policy files)`)
