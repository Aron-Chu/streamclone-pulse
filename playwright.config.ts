import { defineConfig } from '@playwright/test'

/**
 * StreamPulse MV3 extension e2e.
 * Default project is fully mocked (PR gate). Live Twitch is a separate tagged project.
 *
 * Timing notes:
 * - globalTimeout 5m caps hung Chromium/SW from consuming the full CI job budget.
 * - per-test timeout 60s matches current suite (extension launch + SPA hops).
 * - expect timeout 20s covers Pulse root mount against mocked BFF.
 * Do not raise these without documenting a new timing requirement.
 */
export default defineConfig({
  testDir: 'tests/e2e/specs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  globalTimeout: 5 * 60 * 1000,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/extension' }]],
  outputDir: 'test-results/extension',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'extension-mocked',
      testMatch: /.*\.mocked\.spec\.ts/,
      use: {
        // Extensions require headed Chromium; CI uses xvfb-run.
        headless: false,
      },
    },
    {
      name: 'live-twitch',
      testMatch: /live-twitch\.canary\.spec\.ts/,
      grep: /@live-twitch/,
      use: {
        headless: false,
      },
    },
  ],
})
