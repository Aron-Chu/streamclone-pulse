import { defineConfig } from '@playwright/test'

function localRoot(name: string) {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} must name an already-running local server.`)
  const url = new URL(raw)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be an explicit loopback root.`)
  return url.origin
}
const baseURL = localRoot('PLAYWRIGHT_BASE_URL')
localRoot('DISCOVERY_DATABASE_API_ORIGIN')

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'discovery-database.integration.ts',
  workers: 1, timeout: 30_000, expect: { timeout: 10_000 },
  use: { baseURL, browserName: 'chromium', serviceWorkers: 'block', screenshot: 'only-on-failure' },
  // The owning Go test manages its isolated database + actual HTTP handler.
  // Never start, replace, or reconfigure the user's portal here.
})
