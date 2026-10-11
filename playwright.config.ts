import { defineConfig } from '@playwright/test'

/**
 * StreamPulse MV3 extension e2e.
 * Default project is fully mocked (PR gate). Live Twitch is a separate tagged project.
 *
 * Timing notes:
 * - globalTimeout 25m caps hung Chromium/SW inside the 40m CI extension job.
 *   Timing requirement (2026-10-07): the mocked suite is 33 specs / 188 tests,
 *   one worker. Headed under xvfb, CI ran 160 tests in 13.9m with no failures
 *   (master 9a7d205, run 37416118429) and 168 tests in 13.0m (cf88a16, run
 *   37144450281); 188 tests project to ~14.5-16m, so the old 15m cap could
 *   abort states.* and every later file (all supporter-* specs) on runner
 *   variance alone. 25m leaves ~9m for variance plus CI retries, and
 *   ~2.7m setup + 25m + ~0.7m store-target/Firefox steps stays inside 40m.
 *   History: the 5m cap left 60 tests unrun; 15m held while the suite was
 *   ~117 tests. Check the CI summary for "did not run"/"interrupted" when the
 *   suite grows, and raise this (or split the suite) before it gets close.
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
  globalTimeout: 25 * 60 * 1000,
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
