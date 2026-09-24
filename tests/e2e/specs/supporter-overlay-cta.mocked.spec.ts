import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The overlay's Supporter entry point, packaged.
 *
 * The content script cannot read entitlement — SUPPORTER_ENTITLEMENT is scoped
 * to extension pages — so this surface must open the extension's own Supporter
 * section rather than assert a status or carry a purchase link. These tests hold
 * that boundary and capture what it looks like in the real rail.
 */
const CAPTURE_DIR = join('test-results', 'supporter-overlay')

test('the overlay offers Supporter as a destination and opens that section', async ({ extension, prepare }) => {
  mkdirSync(CAPTURE_DIR, { recursive: true })
  await prepare({ storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse' } })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)

  const page = extension.page
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Quick settings' })).toBeVisible()

  const cta = page.locator('[data-settings-host-cta="supporter"]')
  await expect(cta).toBeVisible()
  await expect(cta).toContainText('Pulse Supporter')
  await expect(cta).toContainText('Core tools stay free')

  // The destination stays available after the controls people use on stream.
  const box = await cta.boundingBox()
  expect(box!.width).toBeGreaterThan(120)
  expect(box!.height).toBeGreaterThanOrEqual(36)
  const preferences = await page.getByRole('region', { name: 'Extension preferences' }).boundingBox()
  expect(preferences!.y + preferences!.height).toBeLessThanOrEqual(box!.y)

  await page.screenshot({
    animations: 'disabled',
    path: join(CAPTURE_DIR, 'overlay-supporter-cta.png'),
  })

  // Clicking opens the packaged options page at the Supporter section. A new
  // extension page is the honest destination: it is the only surface that can
  // read entitlement.
  const opened = page.context().waitForEvent('page')
  await cta.click()
  const settings = await opened
  await settings.waitForLoadState('domcontentloaded')
  expect(new URL(settings.url()).protocol).toBe('chrome-extension:')
  expect(settings.url()).toContain('#supporter')
  await expect(settings.locator('[data-settings-section="supporter"], .pulse-supporter-settings').first()).toBeVisible()
  await settings.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: join(CAPTURE_DIR, 'overlay-supporter-destination.png'),
  })
})

test('the overlay never states a price or links out for purchase', async ({ extension, prepare }) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse' } })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)

  const page = extension.page
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Quick settings' })).toBeVisible()

  const panel = page.locator('.pulse-settings-panel')
  const markup = await panel.innerHTML()
  // A reader who already pays must not be shown a sales pitch, and a reader who
  // does not must not be shown a price with no status beside it.
  for (const forbidden of ['4.99', 'Become a Supporter', 'Subscribe', 'streampulse.stream']) {
    expect(markup, `overlay panel must not contain ${forbidden}`).not.toContain(forbidden)
  }
  await expect(panel.locator('a[href]')).toHaveCount(0)
})
