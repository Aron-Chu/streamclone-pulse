import { expect, test } from '@playwright/test'
import {
  assertNoUnexpected,
  installPortalAcceptanceHarness,
  PORTAL_LOGIN,
} from './helpers/portalAcceptanceHarness'

// OP1-RES-001 / CX-RES-002: failed channel reads are reported as failures with a
// retry, never as "No past streams indexed yet" / "No recent data".

const STREAMS = new RegExp(`/channels/${PORTAL_LOGIN}/streams`)
const LIVE = new RegExp(`/channels/${PORTAL_LOGIN}/live`)

test.describe('channel page load states (mocked)', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'narrow', width: 390, height: 844 },
  ] as const) {
    test(`failed reads show errors with retry, then recover (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      const harness = await installPortalAcceptanceHarness(page, { clock: false })
      const failed = { status: 500, contentType: 'application/json', body: '{"error":"stream_unavailable"}' }
      await page.route(STREAMS, route => route.fulfill(failed))
      await page.route(LIVE, route => route.fulfill(failed))

      await page.goto(`/analytics/${PORTAL_LOGIN}`, { waitUntil: 'domcontentloaded' })
      const column = page.locator('[data-analytics-stream-column]')
      await expect(column.getByText("Couldn't load streams.")).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('No past streams indexed yet.')).toHaveCount(0)
      await expect(page.getByText(`Unable to load the latest session for ${PORTAL_LOGIN}`, { exact: false })).toBeVisible()
      await expect(page.getByText('No recent data')).toHaveCount(0)

      // The list recovers on its own retry without a page reload.
      await page.unroute(STREAMS)
      await column.getByRole('button', { name: 'Try again' }).click()
      await expect(column.getByText("Couldn't load streams.")).toHaveCount(0)
      await expect(column.getByText('Deterministic portal acceptance fixture')).toBeVisible()
      await assertNoUnexpected(harness)
    })
  }
})
