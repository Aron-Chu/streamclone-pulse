import { defineConfig, devices } from '@playwright/test'

const HOSTED_API_URL = process.env.VITE_BACKEND_URL?.trim() || 'https://api.streampulse.stream'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev:vite -- --host 127.0.0.1 --port 5174 --strictPort',
        url: 'http://127.0.0.1:5174',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          VITE_BACKEND_URL: HOSTED_API_URL,
          // E2E exercises the promoted Live Activity surface via mocks; production default remains off.
          VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED: 'true',
        },
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
