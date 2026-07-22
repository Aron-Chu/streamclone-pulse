/**
 * Post-build prerender: emit static HTML shells for public routes (WEB-002).
 * Dashboard/admin remain SPA-only chunks.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
const indexPath = join(dist, 'index.html')
const indexHtml = readFileSync(indexPath, 'utf8')
const origin = 'https://streampulse.stream'

const routes = [
  {
    path: '',
    title: 'StreamPulse — Twitch reaction analytics',
    description: 'StreamPulse finds Twitch moments through coverage-honest chat, emote, viewer, and VOD analytics.',
    canonicalPath: '/',
    robots: 'index,follow',
  },
  {
    path: 'analytics',
    title: 'StreamPulse Analytics',
    description: 'Explore aggregate live Twitch activity, Pulse moments, emote signals, and tracked channels.',
    canonicalPath: '/analytics',
    robots: 'index,follow',
  },
  {
    path: 'docs',
    title: 'Documentation — StreamPulse',
    description: 'Install StreamPulse, understand coverage states, and open public Twitch analytics.',
    canonicalPath: '/docs',
    robots: 'index,follow',
  },
  {
    path: 'status',
    title: 'Service Status — StreamPulse',
    description: 'Current StreamPulse portal, API, coverage, and corpus status.',
    canonicalPath: '/status',
    robots: 'index,follow',
  },
  {
    path: 'privacy',
    title: 'Privacy Policy — StreamPulse',
    description: 'How the StreamPulse Chrome extension and website observe, send, and store data.',
    canonicalPath: '/privacy',
    robots: 'index,follow',
  },
  {
    path: 'support',
    title: 'Support — StreamPulse',
    description: 'Troubleshoot the StreamPulse Twitch extension and public analytics portal.',
    canonicalPath: '/support',
    robots: 'index,follow',
  },
  {
    path: 'setup',
    title: 'StreamPulse Analytics',
    description: 'This legacy StreamPulse route redirects to public analytics.',
    canonicalPath: '/analytics',
    robots: 'noindex,nofollow',
  },
  {
    path: 'login',
    title: 'StreamPulse Analytics',
    description: 'This legacy StreamPulse route redirects to public analytics.',
    canonicalPath: '/analytics',
    robots: 'noindex,nofollow',
  },
]

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function upsertMeta(html, attribute, key, content) {
  const tag = `<meta ${attribute}="${key}" content="${escapeAttribute(content)}" />`
  const pattern = new RegExp(`<meta\\s+${attribute}="${key}"[^>]*>`, 'i')
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

function renderShell(metadata) {
  const canonical = new URL(metadata.canonicalPath, origin).toString()
  let html = indexHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${metadata.title}</title>`)
  html = upsertMeta(html, 'name', 'description', metadata.description)
  html = upsertMeta(html, 'name', 'robots', metadata.robots)
  html = upsertMeta(html, 'property', 'og:title', metadata.title)
  html = upsertMeta(html, 'property', 'og:description', metadata.description)
  html = upsertMeta(html, 'property', 'og:url', canonical)
  html = upsertMeta(html, 'name', 'twitter:title', metadata.title)
  html = upsertMeta(html, 'name', 'twitter:description', metadata.description)
  const canonicalTag = `<link rel="canonical" href="${canonical}" />`
  html = /<link\s+rel="canonical"[^>]*>/i.test(html)
    ? html.replace(/<link\s+rel="canonical"[^>]*>/i, canonicalTag)
    : html.replace('</head>', `    ${canonicalTag}\n  </head>`)
  return html
}

for (const route of routes) {
  const html = renderShell(route)
  if (!route.path) {
    writeFileSync(indexPath, html)
    continue
  }
  const dir = join(dist, route.path)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), html)
}

mkdirSync(join(dist, 'docs', 'getting-started'), { recursive: true })
writeFileSync(join(dist, 'docs', 'getting-started', 'index.html'), renderShell(routes.find((route) => route.path === 'docs')))
writeFileSync(
  join(dist, '404.html'),
  renderShell({
    title: 'Page not found — StreamPulse',
    description: 'The requested URL is not a public StreamPulse page.',
    canonicalPath: '/',
    robots: 'noindex,nofollow',
  }),
)

console.log('prerender: wrote metadata-specific public route shells and 404 fallback')
