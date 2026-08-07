#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, '..', 'dist')

const expected = [
  ['index.html', 'StreamPulse — Twitch reaction analytics', 'index,follow', 'https://streampulse.stream/'],
  ['analytics/index.html', 'StreamPulse Analytics', 'index,follow', 'https://streampulse.stream/analytics'],
  ['docs/index.html', 'Documentation — StreamPulse', 'index,follow', 'https://streampulse.stream/docs'],
  ['status/index.html', 'Service Status — StreamPulse', 'index,follow', 'https://streampulse.stream/status'],
  ['privacy/index.html', 'Privacy Policy — StreamPulse', 'index,follow', 'https://streampulse.stream/privacy'],
  ['support/index.html', 'Support — StreamPulse', 'index,follow', 'https://streampulse.stream/support'],
  ['changelog/index.html', 'Changelog — StreamPulse', 'index,follow', 'https://streampulse.stream/changelog'],
  ['404.html', 'Page not found — StreamPulse', 'noindex,nofollow', 'https://streampulse.stream/'],
]

const failures = []
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
  if (!html.includes('https://api.streampulse.stream')) failures.push(`${relativePath}: hosted API CSP missing`)
  if (/https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(html)) failures.push(`${relativePath}: local URL leaked into artifact`)
}

for (const relativePath of ['robots.txt', 'sitemap.xml']) {
  if (!existsSync(join(dist, relativePath))) failures.push(`${relativePath}: missing`)
}

if (failures.length > 0) {
  console.error('Public Pages artifact check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`check:public-pages OK (${expected.length} HTML artifacts + crawl files)`)
