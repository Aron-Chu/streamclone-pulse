import { expect, test, type Page } from '@playwright/test'

import { installExplorerMock, payload } from './helpers/explorerMock'
import { installHubUxMock } from './helpers/hubUxMock'

/**
 * Retry-After on a history window the API is still preparing, read the way a
 * browser reads it. The portal calls the API cross-origin, so Retry-After
 * reaches the page only when the API lists it in Access-Control-Expose-Headers.
 * streampulse-backend's CORS layer (internal/httpx/cors.go) exposes only
 * X-Correlation-ID today; the first case is the exposure the portal needs.
 */
const EXPOSES_RETRY_AFTER = 'X-Correlation-ID, Retry-After'
const EXPOSES_TODAY = 'X-Correlation-ID'

/** Every 7d list read answers 503 snapshot_warming with Retry-After: 60. */
async function installWarmingList(page: Page, exposeHeaders: string): Promise<number[]> {
  const reads: number[] = []
  await page.route(/\/v1\/public\/explorer(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    reads.push(Date.now())
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': exposeHeaders,
        'Retry-After': '60',
        'X-Correlation-ID': 'e2e-warming',
      },
      body: JSON.stringify({ ...payload('unavailable', undefined, url), reason: 'snapshot_warming' }),
    })
  })
  return reads
}

test.describe('a 7d window that is still being prepared', () => {
  test('holds the next read and Try again until Retry-After ends, once the API exposes it', async ({ page }) => {
    await page.clock.install()
    await installHubUxMock(page)
    const reads = await installWarmingList(page, EXPOSES_RETRY_AFTER)
    await page.goto('/analytics/explore?window=7d')

    await expect(page.getByText('This range is not ready yet')).toBeVisible()
    await expect(page.getByText('This history range is still being prepared.')).toBeVisible()
    await expect(page.getByText('Pulse Explorer checks again automatically.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)

    // Nothing reads again before Retry-After ends: no quick transport retry, no poll.
    await page.clock.fastForward(59_000)
    await page.waitForTimeout(500)
    expect(reads).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)

    await page.clock.fastForward(2_000)
    await expect.poll(() => reads.length).toBe(2)
  })

  test('with the API\'s current CORS exposure the page cannot see Retry-After and offers Try again', async ({ page }) => {
    await installHubUxMock(page)
    const reads = await installWarmingList(page, EXPOSES_TODAY)
    await page.goto('/analytics/explore?window=7d')

    await expect(page.getByText('This range is not ready yet')).toBeVisible()
    await expect.poll(() => reads.length).toBeGreaterThan(0)
    // No hold is claimed that the page cannot honour.
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByText('You can try again in a moment.')).toHaveCount(0)
  })

  test('with the API\'s current CORS exposure the inspector checks a warming broadcast again once, 30 s later', async ({ page }) => {
    await page.clock.install()
    await installHubUxMock(page)
    // The 7d list is ready; only the selected broadcast's details are still being prepared.
    await installExplorerMock(page)
    const reads: number[] = []
    await page.route(/\/v1\/public\/explorer\/pulse-xqc-session-1(\?.*)?$/, async (route) => {
      reads.push(Date.now())
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': EXPOSES_TODAY,
          'Retry-After': '60',
          'X-Correlation-ID': 'e2e-warming-detail',
        },
        body: JSON.stringify({ ...payload('unavailable', undefined, new URL(route.request().url())), reason: 'snapshot_warming' }),
      })
    })
    await page.goto('/analytics/explore/pulse-xqc-session-1?window=7d')

    const inspector = page.locator('.explorer-inspector')
    await expect(inspector.getByText('Broadcast details are not ready yet')).toBeVisible()
    await expect(inspector.getByText('Pulse Explorer checks again automatically.')).toBeVisible()
    // The page cannot see Retry-After, so it claims no pause and Try again stays offered.
    await expect(inspector.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(inspector.getByText('You can try again in a moment.')).toHaveCount(0)
    // apiClient repeats a 5xx once when it names no Retry-After; that is the whole first read.
    await expect.poll(() => reads.length).toBe(2)

    // Short of 30 s (the clock also runs on its own meanwhile), nothing reads again.
    await page.clock.fastForward(25_000)
    await page.waitForTimeout(500)
    expect(reads).toHaveLength(2)
    await page.clock.fastForward(6_000)
    await expect.poll(() => reads.length).toBe(4)
    // One automatic check only: afterwards the reader decides.
    await expect(inspector.getByText('Pulse Explorer checks again automatically.')).toHaveCount(0)
    await expect(inspector.getByRole('button', { name: 'Try again' })).toBeVisible()
    await page.clock.fastForward(120_000)
    await page.waitForTimeout(500)
    expect(reads).toHaveLength(4)
  })
})
