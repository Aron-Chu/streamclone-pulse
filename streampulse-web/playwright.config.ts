import { defineConfig, devices } from '@playwright/test'

const HOSTED_API_URL = process.env.VITE_BACKEND_URL?.trim() || 'https://api.streampulse.stream'
const MOCKED = process.env.PORTAL_E2E_MOCKED === '1'
const MOCKED_BASE_URL = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: MOCKED ? 120_000 : 90_000,
  expect: { timeout: MOCKED ? 20_000 : 15_000 },
  // Platform-agnostic snapshots so Windows-generated baselines match ubuntu CI.
  ...(MOCKED
    ? {
        // Platform-agnostic path; keep projectName so baselines match
        // portal-*-{desktop|narrow}-portal-mocked.png committed names.
        snapshotPathTemplate:
          '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
      }
    : {}),
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? (MOCKED ? MOCKED_BASE_URL : 'http://127.0.0.1:5173'),
    trace: 'on-first-retry',
    ...(MOCKED
      ? {
          screenshot: 'only-on-failure' as const,
          video: 'retain-on-failure' as const,
        }
      : {}),
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : MOCKED
      ? {
          // Production-like Vite build + preview; all API/media intercepted in-test.
          command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
          url: MOCKED_BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          env: {
            ...process.env,
            VITE_BACKEND_URL: HOSTED_API_URL,
            // Keep analytics polling short for clock-controlled tests without changing prod defaults.
            VITE_PORTAL_E2E_POLL_MS: '1000',
          },
        }
      : {
          command: 'npm run dev:vite -- --host 127.0.0.1 --port 5173',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...process.env,
            VITE_BACKEND_URL: HOSTED_API_URL,
          },
        },
  projects: MOCKED
    ? [
        {
          name: 'portal-mocked',
          testMatch: /.*\.portal-mocked\.spec\.ts$/,
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1440, height: 900 },
          },
        },
      ]
    : [
        {
          name: 'chromium',
          testMatch: /^(?!.*\.portal-mocked\.spec\.ts$).*\.spec\.ts$/,
          use: { ...devices['Desktop Chrome'] },
        },
      ],
})
