import { test, expect } from '@playwright/test'
import {
  HOSTED_API_URL,
  attachHostedApiGuard,
  assertHostedApiOnly,
  clearBackendOverrides,
  waitForHostedApiTraffic,
} from './helpers/hostedApi'

const LOGIN = process.env.ANALYTICS_E2E_LOGIN?.trim() || 'jynxzi'
const STREAM_ID = process.env.ANALYTICS_E2E_STREAM_ID?.trim() || '319253683932'
const HASH_OFFSET = process.env.ANALYTICS_E2E_HASH?.trim() || 't=38527'

const VIEWPORTS = [
  { name: 'desktop-1600', width: 1600, height: 1000 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
] as const

type CaptureTarget = {
  slug: string
  path: string
  readySelector: string
  label: string
}

const TARGETS: CaptureTarget[] = [
  {
    slug: 'hub',
    path: '/analytics',
    readySelector: '.hub-command-header, .figma-global-activity',
    label: 'Analytics hub landing',
  },
  {
    slug: 'channel-console',
    path: `/analytics/${LOGIN}/${STREAM_ID}#${HASH_OFFSET}`,
    readySelector: 'main[aria-label*="Analytics for"]',
    label: 'Channel session console',
  },
]

test.describe('analytics visual capture (hosted API only)', () => {
  test.beforeEach(async ({ page }) => {
    await clearBackendOverrides(page)
  })

  for (const viewport of VIEWPORTS) {
    for (const target of TARGETS) {
      test(`${target.slug} @ ${viewport.name}`, async ({ page }, testInfo) => {
        const violations = attachHostedApiGuard(page)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })

        await page.goto(target.path, { waitUntil: 'domcontentloaded' })
        await waitForHostedApiTraffic(page)
        await page.locator(target.readySelector).first().waitFor({ state: 'visible', timeout: 45_000 })

        if (target.slug === 'channel-console') {
          await expect(page.getByRole('heading', { name: 'Stream Recap' })).toBeVisible({ timeout: 45_000 })
          await expect(page.getByText(/analytics db ready/i)).toHaveCount(0)
          await expect(page.getByRole('img', { name: 'Analytics timeline chart' })).toBeVisible({ timeout: 15_000 })
          await expect(page.getByText(/\d+% chat coverage/i)).toBeVisible({ timeout: 15_000 })
        } else {
          await expect(page.getByText(/Reading Hosted corpus/i).first()).toBeVisible({ timeout: 15_000 })
        }

        const outfile = testInfo.outputPath(`${viewport.name}-${target.slug}.png`)
        await page.screenshot({ path: outfile, fullPage: true })

        assertHostedApiOnly(violations)

        await testInfo.attach(`${viewport.name}-${target.slug}`, {
          path: outfile,
          contentType: 'image/png',
        })
      })
    }
  }

  test('backend default resolves to hosted API', async ({ page }) => {
    const violations = attachHostedApiGuard(page)
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' })
    await waitForHostedApiTraffic(page)

    const resolved = await page.evaluate(() => {
      const override = sessionStorage.getItem('sp.backendUrlOverride')
      return { override }
    })
    expect(resolved.override).toBeNull()

    assertHostedApiOnly(violations)
    expect(HOSTED_API_URL).toBe('https://api.streampulse.stream')
  })
})
