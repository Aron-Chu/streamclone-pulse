/**
 * Post-build prerender: emit static HTML shells for public routes (WEB-002).
 * /admin stays SPA-only.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, loadConfigFromFile } from 'vite'
import { readPilot, writeRuntimeManifests, renderRecapDocument, recapRedirects, sitemapWithRecaps } from './recap-pilot.mjs'
import { sitemapWithStatedDates, statedUpdateDate } from './sitemap-lastmod.mjs'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
const indexPath = join(dist, 'index.html')
const indexHtml = readFileSync(indexPath, 'utf8')
const origin = 'https://streampulse.stream'
const pilotPages = readPilot(join(root, 'content', 'recap-pilot.json'))
writeRuntimeManifests(root, pilotPages)
const analyticsCriticalStyles = readdirSync(join(dist, 'assets'))
  .filter(name => /^figma-analytics-.+\.css$/.test(name))
  .map(name => `<link rel="stylesheet" href="/assets/${name}">`)
  .join('\n    ')
// Public pages load on demand (src/routes/index.tsx). Each prerendered page
// preloads its own chunks, so they download beside the entry, not after it.
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'))
const publicPageSources = {
  'tools/twitch-vod-timestamp-link': 'TwitchTimestampTool',
  'guides/find-twitch-moments': 'FindTwitchMomentsGuide',
  'guides/twitch-vod-timestamps': 'TwitchVodTimestampsGuide',
  docs: 'Docs', status: 'Status', privacy: 'Privacy', terms: 'Terms', refunds: 'Refunds', withdraw: 'Withdraw',
  supporter: 'Supporter', 'supporter/thanks': 'SupporterThanks', support: 'Support',
  feedback: 'Feedback', discord: 'Discord', changelog: 'Changelog', recaps: 'Recaps',
}
function chunkFiles(key, files = new Set()) {
  const chunk = manifest[key]
  if (!chunk || files.has(chunk.file)) return files
  files.add(chunk.file)
  for (const imported of chunk.imports ?? []) chunkFiles(imported, files)
  return files
}
const entryChunks = chunkFiles('index.html')
/** A chunk's styles in the order Vite's preload adds them: what it imports first, then its own. */
function chunkStyles(key, styles = new Set(), seen = new Set()) {
  const chunk = manifest[key]
  if (!chunk || seen.has(key)) return styles
  seen.add(key)
  for (const imported of chunk.imports ?? []) chunkStyles(imported, styles, seen)
  for (const file of chunk.css ?? []) styles.add(file)
  return styles
}
const entryStyles = chunkStyles('index.html')
function pagePreloads(path) {
  // The hub's first render is prerendered too (src/prerender.tsx), so its styles load with the document, not after it.
  const source = path === 'analytics' ? 'src/routes/analytics/AnalyticsHubV5Page.tsx'
    : publicPageSources[path] ? `src/routes/public/${publicPageSources[path]}.tsx` : null
  if (!source) return ''
  const styles = path === 'analytics'
    ? [...chunkStyles(source)].filter(file => !entryStyles.has(file) && !analyticsCriticalStyles.includes(`/${file}"`))
      .map(file => `<link rel="stylesheet" crossorigin href="/${file}">`)
    : []
  return [...styles, ...[...chunkFiles(source)]
    .filter(file => !entryChunks.has(file))
    .map(file => `<link rel="modulepreload" crossorigin href="/${file}">`)]
    .join('\n    ')
}
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
let prerenderPublicPage, GROWTH_PAGES, GITHUB_REPO_URL
try {
  ;({ prerenderPublicPage, GROWTH_PAGES } = await server.ssrLoadModule('/src/prerender.tsx'))
  ;({ GITHUB_REPO_URL } = await server.ssrLoadModule('/src/lib/externalLinks.ts'))
} catch (error) {
  await server.close()
  throw error
}

const routes = [
  ...GROWTH_PAGES,
  {
    path: 'supporter/thanks',
    title: 'Return to your extension — StreamPulse',
    description: 'Return to StreamPulse to check your membership after Checkout.',
    canonicalPath: '/supporter/thanks',
    robots: 'noindex,nofollow',
  },
  {
    path: 'account/restore',
    title: 'Restore Supporter — StreamPulse',
    description: 'Confirm a requested Supporter restore for your extension.',
    canonicalPath: '/account/restore',
    robots: 'noindex,nofollow',
  },
  {
    path: '',
    title: 'StreamPulse: Twitch Chat Stats & Top Moments',
    description: 'Explore Twitch chat stats, top emotes and reaction moments for tracked streams. Add the free Chrome, Edge or Firefox extension beside Twitch chat.',
    canonicalPath: '/',
    robots: 'index,follow',
  },
  {
    path: 'analytics',
    title: 'Live Twitch Chat Stats & Top Emotes — StreamPulse',
    description: 'Live Twitch chat stats for the channels StreamPulse tracks: chat per minute, top Twitch and 7TV emotes, and the reaction moments when chat jumps.',
    canonicalPath: '/analytics',
    robots: 'index,follow',
  },
  {
    path: 'docs',
    title: 'Documentation — StreamPulse',
    description: 'Install the free StreamPulse extension for Chrome, Edge or Firefox, explore the Hub’s public Twitch chat stats, and read what each coverage state means.',
    canonicalPath: '/docs',
    robots: 'index,follow',
  },
  {
    path: 'status',
    title: 'Service Status — StreamPulse',
    description: 'Is StreamPulse working right now? Live status of the website, live Twitch chat tracking and the Twitch panel data, with when it was last checked.',
    canonicalPath: '/status',
    robots: 'index,follow',
  },
  {
    path: 'privacy',
    title: 'Privacy Policy — StreamPulse',
    description: 'How the StreamPulse browser extension and website observe, send, and store data.',
    canonicalPath: '/privacy',
    robots: 'index,follow',
  },
  {
    path: 'terms',
    title: 'Terms of Use — StreamPulse',
    description: 'Terms for the StreamPulse website, browser extension, and the Pulse Supporter subscription.',
    canonicalPath: '/terms',
    robots: 'index,follow',
  },
  {
    path: 'refunds',
    // "and", not "&": renderShell splices the title in raw, and the same string
    // is reused inside og:/twitter: content attributes.
    title: 'Cancellation and Refunds — StreamPulse',
    description: 'How cancelling the optional Pulse Supporter membership works: no fee or minimum term, access until the paid period ends, and when a charge is refunded.',
    canonicalPath: '/refunds',
    robots: 'index,follow',
  },
  {
    path: 'withdraw',
    title: 'Withdraw from your contract — StreamPulse',
    description: 'Send a withdrawal request for your Pulse Supporter subscription.',
    canonicalPath: '/withdraw',
    robots: 'noindex,nofollow',
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
    // The private feedback form. /support links here and the extension's
    // "Send feedback" opens it.
    path: 'feedback',
    title: 'Send Feedback — StreamPulse',
    description: 'Spotted a problem or have an idea? Send private feedback about the StreamPulse extension or website. No account needed, and nothing is posted publicly.',
    canonicalPath: '/feedback',
    robots: 'index,follow',
  },
  {
    // The extension's "Join Discord" opens this page. It only forwards to the
    // build-time invite (or says there is none), so it stays out of search and
    // out of public/sitemap.xml.
    path: 'discord',
    title: 'Discord — StreamPulse',
    description: 'Join the public StreamPulse community on Discord.',
    canonicalPath: '/discord',
    robots: 'noindex,nofollow',
  },
  {
    // The extension's "Release details" links open this page. It describes only
    // released versions, so it is indexed and listed in public/sitemap.xml.
    path: 'changelog',
    title: 'Release Notes — StreamPulse',
    description: 'What changed in each version of the StreamPulse extension.',
    canonicalPath: '/changelog',
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

// One shared 1200x630 card (public/og-default.png, source in scripts/og/) gives
// every page a large link preview; title and description stay per page.
const shareImage = {
  url: `${origin}/og-default.png`,
  type: 'image/png',
  width: '1200',
  height: '630',
  alt: 'StreamPulse: find the Twitch moments people actually reacted to.',
}

// The newest released version, from the release notes the extension and /changelog share. The manifest
// already names the version in development, which the stores do not have yet.
const releaseNotes = JSON.parse(readFileSync(join(root, '..', 'src', 'shared', 'release-notes.json'), 'utf8'))
const releasedVersion = releaseNotes.releases.find((release) => release.status === 'released')?.version
if (!releasedVersion) throw new Error('src/shared/release-notes.json names no released version')

// The extension's store listings, which the home page's structured data names as the same product.
const storeListings = [
  'https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg',
  'https://addons.mozilla.org/en-US/firefox/addon/streampulse/',
  'https://microsoftedge.microsoft.com/addons/detail/streampulse-twitch-chat-/cnakgkalmjbhelabgjkbinlgjeflebjd',
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
  // null for the 404, which is not a page of its own.
  const canonical = metadata.canonicalPath == null ? null : new URL(metadata.canonicalPath, origin).toString()
  let html = indexHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${metadata.title}</title>`)
  if (metadata.path === 'analytics' && analyticsCriticalStyles) {
    html = html.replace('</head>', `    ${analyticsCriticalStyles}\n  </head>`)
  }
  // Stream, channel and recap documents render the loading shell, not the hub (rootPath below).
  const preloads = metadata.rootPath ? '' : pagePreloads(metadata.path)
  if (preloads) html = html.replace('</head>', `    ${preloads}\n  </head>`)
  html = upsertMeta(html, 'name', 'description', metadata.description)
  html = upsertMeta(html, 'name', 'robots', metadata.robots)
  html = upsertMeta(html, 'property', 'og:title', metadata.title)
  html = upsertMeta(html, 'property', 'og:description', metadata.description)
  html = canonical ? upsertMeta(html, 'property', 'og:url', canonical) : html.replace(/\s*<meta\s+property="og:url"[^>]*>/i, '')
  html = upsertMeta(html, 'property', 'og:type', 'website')
  html = upsertMeta(html, 'property', 'og:site_name', 'StreamPulse')
  html = upsertMeta(html, 'property', 'og:image', shareImage.url)
  html = upsertMeta(html, 'property', 'og:image:type', shareImage.type)
  html = upsertMeta(html, 'property', 'og:image:width', shareImage.width)
  html = upsertMeta(html, 'property', 'og:image:height', shareImage.height)
  html = upsertMeta(html, 'property', 'og:image:alt', shareImage.alt)
  html = upsertMeta(html, 'name', 'twitter:card', 'summary_large_image')
  html = upsertMeta(html, 'name', 'twitter:title', metadata.title)
  html = upsertMeta(html, 'name', 'twitter:description', metadata.description)
  html = upsertMeta(html, 'name', 'twitter:image', shareImage.url)
  html = upsertMeta(html, 'name', 'twitter:image:alt', shareImage.alt)
  const canonicalTag = `<link rel="canonical" href="${canonical}" />`
  if (!canonical) html = html.replace(/\s*<link\s+rel="canonical"[^>]*>/i, '')
  else html = /<link\s+rel="canonical"[^>]*>/i.test(html)
    ? html.replace(/<link\s+rel="canonical"[^>]*>/i, canonicalTag)
    : html.replace('</head>', `    ${canonicalTag}\n  </head>`)
  if (metadata.path === '') {
    const software = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'StreamPulse: Twitch Chat Stats & Top Moments',
      applicationCategory: 'BrowserApplication',
      operatingSystem: ['Windows', 'macOS', 'Linux', 'ChromeOS'],
      softwareRequirements: 'A desktop version of Chrome, Edge or Firefox.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      url: origin,
      downloadUrl: storeListings[0],
      sameAs: storeListings,
      softwareVersion: releasedVersion,
      description: metadata.description,
      publisher: { '@id': `${origin}/#organization` },
    }
    // Who makes it and what the site is, for search results: the store listings and the public source code.
    const site = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': `${origin}/#organization`, name: 'StreamPulse', url: origin, sameAs: [...storeListings, GITHUB_REPO_URL] },
        { '@type': 'WebSite', '@id': `${origin}/#website`, name: 'StreamPulse', url: origin, inLanguage: 'en', publisher: { '@id': `${origin}/#organization` } },
      ],
    }
    for (const data of [software, site]) {
      html = html.replace('</head>', `    <script type="application/ld+json">${JSON.stringify(data)}</script>\n  </head>`)
    }
  }
  const path = metadata.rootPath ?? (metadata.path == null ? '/404' : `/${metadata.path}`)
  const markup = `<div id="root" data-prerendered>${prerenderPublicPage(path)}</div>`
  const boundary = /<!--public-root:start-->[\s\S]*?<!--public-root:end-->/
  if (!boundary.test(html)) throw new Error('Missing public root markers: run Vite build before prerender')
  return html.replace(boundary, () => `<!--public-root:start-->${markup}<!--public-root:end-->`)
}

// Each prerendered page answers at one URL: Pages would also serve its folder's index.html at the
// trailing-slash URL, so that twin moves to the page, unless public/_redirects already sends it somewhere.
// Pages applies a redirect even where an asset matches; first match wins, so these go first.
function slashRedirects(source, paths) {
  const rules = paths.filter((path) => !source.split('\n').some((line) => line.startsWith(`/${path}/ `))).map((path) => `/${path}/ /${path} 301`)
  return rules.length ? `# Inserted at build time: one URL per prerendered page.\n${rules.join('\n')}\n\n${source}` : source
}

// The date each page states it was last updated (privacy, terms, refunds), for the sitemap's <lastmod>.
const statedDates = new Map()
for (const route of routes) {
  const html = renderShell(route)
  const stated = route.robots === 'index,follow' ? statedUpdateDate(html) : null
  if (stated) statedDates.set(new URL(route.canonicalPath, origin).toString(), stated)
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
    canonicalPath: null,
    robots: 'noindex,nofollow',
  }),
)

// A separate document prevents noindex on unreviewed paths from affecting the hub.
const fallback = renderShell({ path: 'analytics', rootPath: '/analytics-fallback', title: 'StreamPulse Analytics',
  description: 'Explore tracked Twitch streams. Coverage and replay availability load with the data.',
  canonicalPath: '/analytics-fallback', robots: 'noindex,nofollow' })
mkdirSync(join(dist, 'analytics-fallback'), { recursive: true })
writeFileSync(join(dist, 'analytics-fallback', 'index.html'), fallback)
writeFileSync(join(dist, 'analytics-fallback.html'), fallback)

for (const page of pilotPages) {
  const html = renderRecapDocument(renderShell({ ...routes.find(route => route.path === 'analytics'), rootPath: '/analytics-fallback' }), page, pilotPages)
  const asset = join(dist, '_recap-pages', page.login, ...(page.kind === 'stream' ? [page.streamId] : []))
  mkdirSync(asset, { recursive: true })
  writeFileSync(join(asset, 'index.html'), html)
}
writeFileSync(join(dist, '_redirects'), slashRedirects(recapRedirects(readFileSync(join(root, 'public', '_redirects'), 'utf8'), pilotPages), routes.map((route) => route.path).filter(Boolean)))
writeFileSync(join(dist, 'sitemap.xml'), sitemapWithStatedDates(sitemapWithRecaps(readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8'), pilotPages), statedDates))

await server.close()
console.log('prerender: wrote rendered public pages, analytics loading content, and 404 fallback')
