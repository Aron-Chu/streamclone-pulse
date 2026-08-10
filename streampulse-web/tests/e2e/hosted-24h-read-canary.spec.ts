/**
 * Hosted 24h READ canary browser E2E — live https://streampulse.stream/analytics
 * No hub mocks. Run after canary soak is green:
 *   PLAYWRIGHT_BASE_URL=https://streampulse.stream npx playwright test \
 *     tests/e2e/hosted-24h-read-canary.spec.ts --workers=1
 */
import { test, expect } from '@playwright/test'
import {
  attachHostedApiGuard,
  assertHostedApiOnly,
  clearBackendOverrides,
  waitForHostedApiTraffic,
  HOSTED_API_URL,
} from './helpers/hostedApi'

test.describe('hosted 24h READ canary', () => {
  test('24h chart select / Clear / styling / reload / live', async ({ page }) => {
    test.setTimeout(180_000)
    await clearBackendOverrides(page)
    const localHits = attachHostedApiGuard(page)

    const hub24h = page.waitForResponse(
      (r) =>
        r.url().startsWith(`${HOSTED_API_URL}/v1/public/hub`)
        && r.url().includes('activityWindow=24h')
        && r.ok(),
      { timeout: 60_000 },
    )

    await page.goto('/analytics')
    await waitForHostedApiTraffic(page)
    const hubRes = await hub24h
    const hubJson = await hubRes.json()
    const activity = hubJson.activity ?? {}
    expect(activity.source, JSON.stringify({ source: activity.source, state: activity.state, reason: activity.reason })).toBe(
      'historical_projection',
    )
    expect(activity.state).not.toBe('degraded')
    expect(activity.availableWindowMinutes).toBe(1440)
    const points = activity.points ?? []
    expect(points.length).toBeGreaterThanOrEqual(200)

    // Select 24h window control if present (may already be default)
    const win24 = page.getByRole('button', { name: /^24h$/i }).or(page.locator('[data-window="24h"], button:has-text("24h")'))
    if (await win24.first().isVisible().catch(() => false)) {
      await win24.first().click()
      await page.waitForTimeout(1500)
    }

    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.hx-chart2 .hx-chart-line--emotes').first()).toBeVisible()

    // Click a mid-chart bucket until selection sticks
    const box = await chart.boundingBox()
    expect(box).toBeTruthy()
    let selected = false
    for (const xFrac of [0.55, 0.45, 0.65, 0.35]) {
      await chart.click({ position: { x: box!.width * xFrac, y: box!.height * 0.5 } })
      await page.waitForTimeout(400)
      if (await page.locator('.pulse-moments-live__bucket-filter').isVisible().catch(() => false)) {
        selected = true
        break
      }
      if (await page.locator('.activity-bucket-inspector--selected, .activity-bucket-inspector--active').first().isVisible().catch(() => false)) {
        selected = true
        break
      }
    }
    expect(selected, 'expected chart bucket selection to stick').toBe(true)

    const bucketFilter = page.locator('.pulse-moments-live__bucket-filter')
    if (await bucketFilter.isVisible().catch(() => false)) {
      await expect(bucketFilter).toContainText(/Selected bucket/i)
      // Clear removes selection
      const clearBtn = bucketFilter.getByRole('button', { name: /clear/i }).or(page.getByRole('button', { name: /^clear$/i }))
      await expect(clearBtn.first()).toBeVisible()
      await clearBtn.first().click()
      await expect(bucketFilter).toHaveCount(0)
      await expect(page.locator('.activity-bucket-inspector--selected')).toHaveCount(0)
    } else {
      // Inspector-only clear path
      const clearBtn = page.getByRole('button', { name: /^clear$/i })
      if (await clearBtn.first().isVisible().catch(() => false)) {
        await clearBtn.first().click()
      }
      await expect(page.locator('.activity-bucket-inspector--selected')).toHaveCount(0)
    }

    // Reload — healthy 24h remains
    await page.reload()
    await waitForHostedApiTraffic(page)
    const hubAfter = await page.waitForResponse(
      (r) =>
        r.url().startsWith(`${HOSTED_API_URL}/v1/public/hub`)
        && r.url().includes('activityWindow=24h')
        && r.ok(),
      { timeout: 60_000 },
    )
    const after = (await hubAfter.json()).activity ?? {}
    expect(after.source).toBe('historical_projection')
    expect(after.availableWindowMinutes).toBe(1440)
    await expect(chart).toBeVisible()

    // Live updates: wait for a subsequent hub poll
    const live = await page.waitForResponse(
      (r) =>
        r.url().startsWith(`${HOSTED_API_URL}/v1/public/hub`)
        && r.url().includes('activityWindow=24h')
        && r.ok(),
      { timeout: 90_000 },
    )
    expect(live.ok()).toBe(true)

    assertHostedApiOnly(localHits)
  })
})
