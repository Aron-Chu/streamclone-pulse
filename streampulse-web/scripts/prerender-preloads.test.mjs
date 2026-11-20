// Checks what scripts/prerender.mjs wrote into dist/: each document names the
// code and connections its first screen needs, and nothing it does not.
// It reads the last build, so it runs only when dist/ was prerendered after
// scripts/prerender.mjs last changed (npm run build:ci, then npm test).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '..')
const dist = join(webRoot, 'dist')
const marker = join(dist, 'analytics-console-fallback', 'index.html')
const fresh = existsSync(join(dist, '.vite', 'manifest.json')) && existsSync(marker)
  && statSync(marker).mtimeMs >= statSync(join(webRoot, 'scripts', 'prerender.mjs')).mtimeMs
const manifest = fresh ? JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8')) : {}

const read = (path) => readFileSync(join(dist, path), 'utf8')
const head = (html) => html.slice(0, html.indexOf('</head>'))
const root = (html) => html.slice(html.indexOf('<!--public-root:start-->'), html.indexOf('<!--public-root:end-->'))
const chunk = (source) => {
  expect(manifest[source], `manifest has ${source}`).toBeTruthy()
  return manifest[source]
}
const modulepreload = (file) => `<link rel="modulepreload" crossorigin href="/${file}">`
const imageHosts = ['https://static-cdn.jtvnw.net', 'https://cdn.7tv.app']

const accountShells = {
  'sign-in': 'AccountPage', confirm: 'AccountPage', 'link-device': 'AccountPage',
  settings: 'AccountSettings', restore: 'AccountRestore', billing: 'BillingPage', 'billing/return': 'BillingPage',
}

function htmlFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'assets' && name !== '.vite') htmlFiles(path, found)
    } else if (name.endsWith('.html')) found.push(path)
  }
  return found
}

describe.skipIf(!fresh)('prerendered documents (dist/)', () => {
  it('stream and channel documents preload the console, and the plain fallback does not', () => {
    const consoleDoc = head(read('analytics-console-fallback/index.html'))
    const plainDoc = head(read('analytics-fallback/index.html'))
    // What the console view imports on demand (the console package, once it
    // loads through import()) counts as the console's code too.
    const onDemand = chunk('src/routes/analytics/ConsoleChannelView.tsx').dynamicImports ?? []
    for (const source of ['src/routes/analytics/ChannelAnalyticsPage.tsx', 'src/routes/analytics/ConsoleChannelView.tsx', ...onDemand]) {
      const { file } = chunk(source)
      expect(consoleDoc, `console fallback preloads ${source}`).toContain(modulepreload(file))
      expect(plainDoc, `plain fallback leaves out ${source}`).not.toContain(modulepreload(file))
    }
    expect(consoleDoc).toMatch(/<meta name="robots" content="noindex,nofollow"/)
    // Same first screen as the plain fallback: the analytics loading shell.
    expect(root(read('analytics-console-fallback/index.html'))).toBe(root(read('analytics-fallback/index.html')))
  })

  it('only the analytics documents open the picture hosts, without crossorigin', () => {
    for (const path of ['analytics/index.html', 'analytics-fallback/index.html', 'analytics-console-fallback/index.html']) {
      const doc = head(read(path))
      for (const host of imageHosts) expect(doc, `${path} opens ${host}`).toContain(`<link rel="preconnect" href="${host}" />`)
    }
    for (const path of ['index.html', 'help/index.html', 'status/index.html', 'account-fallback/sign-in/index.html']) {
      const doc = head(read(path))
      for (const host of imageHosts) expect(doc, `${path} leaves out ${host}`).not.toContain(host)
    }
  })

  it('each account address has its own noindex card, with no account data', () => {
    for (const [slug, page] of Object.entries(accountShells)) {
      const html = read(`account-fallback/${slug}/index.html`)
      expect(head(html), slug).toMatch(/<meta name="robots" content="noindex,nofollow"/)
      expect(head(html), `${slug} preloads ${page}`).toContain(modulepreload(chunk(`src/routes/account/${page}.tsx`).file))
      const card = root(html)
      expect(card, `${slug} shows the account card`).toContain('class="pulse-account"')
      expect(card, `${slug} shows the waiting line`).toContain('pulse-account-waiting')
      expect(card, `${slug} shows no fields or pictures`).not.toMatch(/<(input|form|img)\b/)
      expect(card, `${slug} shows no address`).not.toContain('@')
      // Vite preview serves the same document at the account path.
      expect(read(`account/${slug}.html`)).toBe(html)
    }
  })

  it('the home document preloads its page and styles, and leaves the rain to the client', () => {
    const html = read('index.html')
    const landing = chunk('src/routes/public/Landing.tsx')
    expect(head(html), 'home preloads Landing').toContain(modulepreload(landing.file))
    for (const file of landing.css ?? []) {
      expect(head(html), `home links ${file}`).toContain(`<link rel="stylesheet" crossorigin href="/${file}">`)
    }
    expect(root(html)).not.toContain('sl-fx')
  })

  it('no prerendered document names a source path', () => {
    for (const path of htmlFiles(dist)) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/["'(\s,]\/src\//)
    }
  })
})
