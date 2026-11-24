/**
 * Post-build prerender: emit static HTML shells for public routes (WEB-002).
 * /admin stays SPA-only.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, loadConfigFromFile, loadEnv } from 'vite'
import { readPilot, writeRuntimeManifests, renderRecapDocument, recapRedirects, sitemapWithRecaps } from './recap-pilot.mjs'
import { sitemapWithStatedDates, statedUpdateDate } from './sitemap-lastmod.mjs'
import { accountMomentsOn, accountRedirects } from './account-redirects.mjs'
import { momentPageRedirects } from './moment-page-redirects.mjs'

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
  '': 'Landing',
  'tools/twitch-vod-timestamp-link': 'TwitchVodTimestampsGuide',
  'guides/find-twitch-moments': 'FindTwitchMomentsGuide',
  'guides/twitch-vod-timestamps': 'TwitchVodTimestampsGuide',
  help: 'Help', docs: 'Help', status: 'Status', privacy: 'Privacy', terms: 'Terms', refunds: 'Refunds', withdraw: 'Withdraw',
  supporter: 'Supporter', 'supporter/thanks': 'SupporterThanks', support: 'Help',
  feedback: 'Help', discord: 'Discord', changelog: 'Changelog', recaps: 'Recaps', brainchat: 'BrainChat',
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
function pageSource(path) {
  return path === 'analytics' ? 'src/routes/analytics/AnalyticsHubV5Page.tsx'
    : publicPageSources[path] != null ? `src/routes/public/${publicPageSources[path]}.tsx` : null
}
/**
 * The page's own chunks, beside the entry. Its styles that are not in the
 * first stylesheet come with the document too, so a prerendered page (the hub,
 * the home page) paints styled; Vite's loader finds them there and adds none.
 */
function pagePreloads(sources, { styles: withStyles = true } = {}) {
  const styles = new Set()
  const scripts = new Set()
  for (const source of sources) {
    if (withStyles) for (const file of chunkStyles(source)) styles.add(file)
    for (const file of chunkFiles(source)) scripts.add(file)
  }
  return [
    ...[...styles].filter(file => !entryStyles.has(file) && !analyticsCriticalStyles.includes(`/${file}"`))
      .map(file => `<link rel="stylesheet" crossorigin href="/${file}">`),
    ...[...scripts].filter(file => !entryChunks.has(file)).map(file => `<link rel="modulepreload" crossorigin href="/${file}">`),
  ].join('\n    ')
}
// Stream and channel pages: their document preloads the console's code, so it
// downloads beside the entry instead of after the first render asks for it.
// That includes what the console view imports on demand (one level): when the
// console package loads through import(), it is a dynamic import of the view,
// which the static walk above does not follow.
// Scripts only: the loading shell paints with the analytics styles it already has.
const consoleView = 'src/routes/analytics/ConsoleChannelView.tsx'
const consolePreloads = pagePreloads(['src/routes/analytics/ChannelAnalyticsPage.tsx', consoleView,
  ...(manifest[consoleView]?.dynamicImports ?? [])], { styles: false })
// Hub and stream pages show Twitch and 7TV pictures; open those connections
// with the document. No crossorigin: the pictures load as plain images.
const imagePreconnects = ['https://static-cdn.jtvnw.net', 'https://cdn.7tv.app']
  .map(href => `<link rel="preconnect" href="${href}" />`).join('\n    ')
// No preload for the page font (Geist): the size-matched stand-in in portal-fonts.css already keeps its swap from
// moving text. A preload (tried 11-23) took bandwidth from the stylesheets, and Geist then often landed before the app
// mounted; the app's fresh headline, a little larger in Geist than the stand-in, became a second largest paint about
// 0.5 s after the first on phones and tablets.
// Pictures a prerendered page imports render with their source paths on the
// server; the document must name the files the build emitted.
function builtAssetPaths(markup) {
  return markup.replace(/(?<=["'(\s,])\/src\/[^"'\s)?#,]+/g, (path) => {
    const file = manifest[path.slice(1)]?.file
    if (!file) throw new Error(`prerender: no built asset for ${path}`)
    return `/${file}`
  })
}
// Reuse the Vite source aliases/shims; no second page copy and no browser/network fetch.
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'production' }, undefined, root)
if (!loaded) throw new Error('Missing Vite configuration for public prerender')
const nativePackages = ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'zustand']
const aliases = Object.fromEntries(Object.entries(loaded.config.resolve?.alias ?? {})
  .filter(([name]) => !nativePackages.includes(name)))
// The account documents' card: the route fallback's account variant, rendered
// in the same module graph as the public pages so React and the router match.
const accountShellId = 'virtual:streampulse-account-shell'
const accountShellPlugin = {
  name: 'streampulse-prerender-account-shell',
  resolveId: (id) => (id === accountShellId ? `\0${accountShellId}` : undefined),
  load: (id) => (id === `\0${accountShellId}` ? [
    "import { createElement } from 'react'",
    "import { renderToString } from 'react-dom/server'",
    "import { StaticRouter } from 'react-router-dom'",
    "import { AnalyticsRouteFallback } from '/src/routes/AnalyticsRouteFallback.tsx'",
    'export function renderAccountShell(location) {',
    "  return renderToString(createElement(StaticRouter, { location }, createElement(AnalyticsRouteFallback, { variant: 'account' })))",
    '}',
  ].join('\n') : undefined),
}
const server = await createServer({
  ...loaded.config, configFile: false, root, mode: 'production',
  plugins: [...(loaded.config.plugins ?? []), accountShellPlugin],
  // This middleware server must not rewrite a running dev server's optimizer
  // metadata. Concurrent builds otherwise invalidate already-served imports.
  cacheDir: join(root, 'node_modules/.cache/streampulse-prerender'),
  resolve: { ...loaded.config.resolve, alias: aliases },
  ssr: { external: nativePackages },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null }, appType: 'custom',
})
let prerenderPublicPage, GROWTH_PAGES, GITHUB_REPO_URL, renderAccountShell, resolvePageMetadata
try {
  ;({ prerenderPublicPage, GROWTH_PAGES } = await server.ssrLoadModule('/src/prerender.tsx'))
  ;({ GITHUB_REPO_URL } = await server.ssrLoadModule('/src/lib/externalLinks.ts'))
  ;({ renderAccountShell } = await server.ssrLoadModule(accountShellId))
  ;({ resolvePageMetadata } = await server.ssrLoadModule('/src/lib/pageMetadata.ts'))
} catch (error) {
  await server.close()
  throw error
}

// The help pages that became sections of /help, and the timestamp builder's old
// address. Each still answers, since the extension and other sites link them,
// and opens the new page; search is pointed there and they stay out of the sitemap.
const helpPage = {
  title: 'Help — StreamPulse',
  description: 'Install the free StreamPulse extension, fix common problems, or ask us on Discord, on GitHub or with the private feedback form.',
  canonicalPath: '/help',
}
const timestampGuide = GROWTH_PAGES.find((page) => page.path === 'guides/twitch-vod-timestamps')
const routes = [
  ...GROWTH_PAGES,
  { ...timestampGuide, path: 'tools/twitch-vod-timestamp-link', robots: 'noindex,nofollow' },
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
  { path: 'help', ...helpPage, robots: 'index,follow' },
  { path: 'docs', ...helpPage, robots: 'noindex,nofollow' },
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
  // The extension's "Send feedback" opens /feedback, and its billing help opens /support.
  { path: 'support', ...helpPage, robots: 'noindex,nofollow' },
  { path: 'feedback', ...helpPage, robots: 'noindex,nofollow' },
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
    // The extension's BrainChat card links here. BrainChat is not out, so the
    // page stays out of search and out of public/sitemap.xml until it is.
    path: 'brainchat',
    title: 'BrainChat — StreamPulse',
    description: 'BrainChat reads Twitch chat around a moment and says what it was about. Coming later.',
    canonicalPath: '/brainchat',
    robots: 'noindex,nofollow',
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
  if (metadata.path === 'analytics') {
    const apiPreconnect = /<link rel="preconnect" href="https:\/\/api\.streampulse\.stream" crossorigin \/>/
    html = apiPreconnect.test(html)
      ? html.replace(apiPreconnect, (tag) => `${tag}\n    ${imagePreconnects}`)
      : html.replace('</head>', `    ${imagePreconnects}\n  </head>`)
  }
  if (metadata.path === 'analytics' && analyticsCriticalStyles) {
    html = html.replace('</head>', `    ${analyticsCriticalStyles}\n  </head>`)
  }
  // Stream, channel, recap and account documents render a loading shell, not
  // the page (rootPath, markup below), and name their own preloads.
  const source = pageSource(metadata.path)
  const preloads = metadata.preloads ?? (metadata.rootPath || !source ? '' : pagePreloads([source]))
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
  const markup = `<div id="root" data-prerendered>${builtAssetPaths(metadata.markup ?? prerenderPublicPage(path))}</div>`
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

// Stream and channel pages (public/_redirects): the same loading shell, with
// the console's code preloaded. Moments, explore and recap pages keep the one above.
const consoleFallback = renderShell({ path: 'analytics', rootPath: '/analytics-fallback', preloads: consolePreloads,
  title: 'StreamPulse Analytics', description: 'Explore tracked Twitch streams. Coverage and replay availability load with the data.',
  canonicalPath: '/analytics-console-fallback', robots: 'noindex,nofollow' })
mkdirSync(join(dist, 'analytics-console-fallback'), { recursive: true })
writeFileSync(join(dist, 'analytics-console-fallback', 'index.html'), consoleFallback)
writeFileSync(join(dist, 'analytics-console-fallback.html'), consoleFallback)

// Checked at build time, because CI runs the unit tests before it builds and
// scripts/prerender-preloads.test.mjs never sees a fresh dist there. The
// console fallback preloads the console view, all it imports and what it
// imports on demand; the plain fallback preloads none of it.
{
  const preloaded = (html) => new Set([...html.slice(0, html.indexOf('</head>'))
    .matchAll(/<link rel="modulepreload"[^>]*\shref="\/([^"]+)"/g)].map(match => match[1]))
  const view = manifest[consoleView]
  const consoleCode = new Set()
  for (const key of view ? [consoleView, ...(view.dynamicImports ?? [])] : []) {
    for (const file of chunkFiles(key)) if (!entryChunks.has(file)) consoleCode.add(file)
  }
  const inConsole = preloaded(consoleFallback)
  const inPlain = preloaded(fallback)
  const missing = view ? [...consoleCode].filter(file => !inConsole.has(file)) : [consoleView]
  const leaked = [...consoleCode].filter(file => inPlain.has(file))
  if (!view || !inConsole.has(view.file) || missing.length || leaked.length) {
    await server.close()
    throw new Error(`prerender: the console fallback must preload the console's code and the plain fallback must not (missing: ${missing.join(', ') || 'none'}; in the plain fallback: ${leaked.join(', ') || 'none'})`)
  }
}

// Each account address (public/_redirects) opens on the account card, with its
// page's code preloaded and its own title; noindex, and no account data.
const accountShells = {
  'sign-in': 'AccountPage', confirm: 'AccountPage', 'link-device': 'AccountPage',
  settings: 'AccountSettings', restore: 'AccountRestore', billing: 'BillingPage', 'billing/return': 'BillingPage',
}
for (const [slug, page] of Object.entries(accountShells)) {
  const location = `/account/${slug}`
  const metadata = resolvePageMetadata(location)
  const html = renderShell({ ...metadata, path: `account-fallback/${slug}`, robots: 'noindex,nofollow',
    preloads: pagePreloads([`src/routes/account/${page}.tsx`]), markup: renderAccountShell(location) })
  mkdirSync(join(dist, 'account-fallback', slug), { recursive: true })
  writeFileSync(join(dist, 'account-fallback', slug, 'index.html'), html)
  // Vite preview serves /account/<slug> from here; Pages takes the rewrite first.
  mkdirSync(dirname(join(dist, `${location.slice(1)}.html`)), { recursive: true })
  writeFileSync(join(dist, `${location.slice(1)}.html`), html)
}

for (const page of pilotPages) {
  const html = renderRecapDocument(renderShell({ ...routes.find(route => route.path === 'analytics'), rootPath: '/analytics-fallback' }), page, pilotPages)
  const asset = join(dist, '_recap-pages', page.login, ...(page.kind === 'stream' ? [page.streamId] : []))
  mkdirSync(asset, { recursive: true })
  writeFileSync(join(asset, 'index.html'), html)
}
// A Moment's own page keeps its rewrite lines only in a build with its switch on (the env vite build read).
const buildEnv = { ...process.env, ...loadEnv('production', root, ['VITE_']) }
// Bare /account then follows the My Moments switch this build read (scripts/account-redirects.mjs).
const redirects = accountRedirects(momentPageRedirects(readFileSync(join(root, 'public', '_redirects'), 'utf8'), buildEnv), accountMomentsOn(loadEnv('production', root, ['VITE_'])))
writeFileSync(join(dist, '_redirects'), slashRedirects(recapRedirects(redirects, pilotPages), routes.map((route) => route.path).filter(Boolean)))
writeFileSync(join(dist, 'sitemap.xml'), sitemapWithStatedDates(sitemapWithRecaps(readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8'), pilotPages), statedDates))

await server.close()
console.log('prerender: wrote rendered public pages, analytics loading content, and 404 fallback')
