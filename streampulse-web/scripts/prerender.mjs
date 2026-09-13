/**
 * Post-build prerender: emit static HTML shells for public routes (WEB-002).
 * Dashboard/admin remain SPA-only chunks.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, loadConfigFromFile } from 'vite'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
const indexPath = join(dist, 'index.html')
const indexHtml = readFileSync(indexPath, 'utf8')
const origin = 'https://streampulse.stream'
const analyticsCriticalStyles = readdirSync(join(dist, 'assets'))
  .filter(name => /^(AnalyticsLandingPage|figma-analytics)-.+\.css$/.test(name))
  .map(name => `<link rel="stylesheet" href="/assets/${name}">`)
  .join('\n    ')
// Reuse the Vite source aliases/shims; no second page copy and no browser/network fetch.
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'production' }, undefined, root)
if (!loaded) throw new Error('Missing Vite configuration for public prerender')
const nativePackages = ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'zustand']
const aliases = Object.fromEntries(Object.entries(loaded.config.resolve?.alias ?? {})
  .filter(([name]) => !nativePackages.includes(name)))
const server = await createServer({
  ...loaded.config, configFile: false, root, mode: 'production',
  // This middleware server must not rewrite a running dev server's optimizer
  // metadata. Concurrent builds otherwise invalidate already-served imports.
  cacheDir: join(root, 'node_modules/.cache/streampulse-prerender'),
  resolve: { ...loaded.config.resolve, alias: aliases },
  ssr: { external: nativePackages },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null }, appType: 'custom',
})
let prerenderPublicPage
try {
  ;({ prerenderPublicPage } = await server.ssrLoadModule('/src/prerender.tsx'))
} catch (error) {
  await server.close()
  throw error
}

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
    path: 'terms',
    title: 'Terms of Use — StreamPulse',
    description: 'Terms for the StreamPulse website, Chrome extension, and the Pulse Supporter subscription.',
    canonicalPath: '/terms',
    robots: 'index,follow',
  },
  {
    path: 'refunds',
    // "and", not "&": renderShell splices the title in raw, and the same string
    // is reused inside og:/twitter: content attributes.
    title: 'Cancellation and Refunds — StreamPulse',
    description: 'How to cancel Pulse Supporter and when a charge is refunded.',
    canonicalPath: '/refunds',
    robots: 'index,follow',
  },
  {
    path: 'supporter',
    title: 'Pulse Supporter — StreamPulse',
    description: 'The optional Pulse Supporter membership: price, renewal, cancellation, and what it includes.',
    canonicalPath: '/supporter',
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
  if (metadata.path === 'analytics' && analyticsCriticalStyles) {
    html = html.replace('</head>', `    ${analyticsCriticalStyles}\n  </head>`)
  }
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
  const path = metadata.path == null ? '/404' : `/${metadata.path}`
  const markup = `<div id="root" data-prerendered>${prerenderPublicPage(path)}</div>`
  const boundary = /<!--public-root:start-->[\s\S]*?<!--public-root:end-->/
  if (!boundary.test(html)) throw new Error('Missing public root markers: run Vite build before prerender')
  return html.replace(boundary, () => `<!--public-root:start-->${markup}<!--public-root:end-->`)
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
  // Vite preview's HTML fallback resolves clean `/route` requests as
  // `/route.html`, while static hosts generally resolve `/route/index.html`.
  // Emit both so cold documents receive the same route-specific prerender.
  writeFileSync(join(dist, `${route.path}.html`), html)
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

await server.close()
console.log('prerender: wrote rendered public pages, analytics loading content, and 404 fallback')
