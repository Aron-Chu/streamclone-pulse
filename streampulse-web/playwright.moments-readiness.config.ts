import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.MOMENTS_READINESS_PORTAL_URL || 'http://127.0.0.1:5173'
const origin = new URL(baseURL)
if (!['localhost', '127.0.0.1'].includes(origin.hostname) || origin.protocol !== 'http:') {
  throw new Error('Readiness requires an explicitly isolated local portal')
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'moments-readiness.integration.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  outputDir: 'test-results-moments-readiness',
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'retain-on-failure' },
  globalSetup: './tests/e2e/moments-readiness.global-setup.ts',
  // Never start, replace or reconfigure an existing server from this acceptance.
})
