import { defineConfig, devices } from '@playwright/test'

// Explicit, isolated two-app acceptance run. Never start/replace a user's server,
// publish a clip, or silently substitute a component fixture for the watch app.
const baseURL = process.env.PLAYWRIGHT_BASE_URL
const watchOrigin = process.env.WATCH_HANDOFF_TARGET_ORIGIN
for (const [name, value] of Object.entries({ PLAYWRIGHT_BASE_URL: baseURL, WATCH_HANDOFF_TARGET_ORIGIN: watchOrigin })) {
  if (!value) throw new Error(`${name} must name an existing isolated loopback preview`)
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be an http://127.0.0.1 origin`)
  }
}
if (new URL(watchOrigin!).port !== '8090') throw new Error('Watch preview must use the owning watch boundary port 8090')
if (new URL(baseURL!).origin === new URL(watchOrigin!).origin) throw new Error('Portal and watch previews must be separate apps')

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'watch-handoff.integration.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  outputDir: 'test-results/watch-handoff',
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
