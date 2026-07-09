import { test, expect } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'

const SESSION_PATH = '/analytics/kato_junichi0817/2026-07-07'
const JYNXZI_SESSION_PATH = '/analytics/jynxzi/2026-07-08'
const CHANNEL_PATH = '/analytics/kato_junichi0817'
const JYNXZI_CHANNEL_PATH = '/analytics/jynxzi'

function filterBenignConsoleErrors(errors: string[]): string[] {
  return errors.filter(
    (entry) => !entry.includes('/watch') && !entry.includes('403 ()'),
  )
}

test.describe('analytics session pulse moments', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(({}, testInfo) => {
    testInfo.setTimeout(120_000)
  })

  test('single under-chart inspector with enriched right rail', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)

    await page.goto(SESSION_PATH, { waitUntil: 'domcontentloaded' })
    await page.getByRole('region', { name: 'Pulse moments recap' }).waitFor({
      state: 'visible',
      timeout: 60_000,
    })

    const rail = page.getByRole('region', { name: 'Pulse moments recap' })
    await expect(rail.getByText('Selected moment', { exact: false })).toHaveCount(0)

    const momentRows = rail.getByRole('button').filter({ hasText: /^#\d+/ })
    const rowCount = await momentRows.count()
    expect(rowCount).toBeGreaterThanOrEqual(3)
    await expect(rail.getByText(/viewers · .*\/min · .*emotes/i).first()).toBeVisible()

    await rail.getByRole('button').filter({ hasText: 'Viewer spike' }).first().click()
    await expect(rail.locator('.sc-moment-row-selected')).toHaveCount(1)

    const inspectors = page.locator('[aria-label*="Selected moment" i]')
    await expect(inspectors).toHaveCount(1)

    const panel = inspectors.first()
    await expect(panel.getByText('Selected Moment')).toBeVisible()
    await expect(panel.getByText(/Reason:/i)).toBeVisible()
    await expect(panel.getByText(/Viewers/i)).toBeVisible()
    await expect(panel.getByText(/Chat activity/i)).toBeVisible()
    await expect(panel.getByText(/Emotes:/i)).toBeVisible()

    expect(await panel.locator('img').count()).toBeGreaterThanOrEqual(1)

    await page.evaluate(() => window.scrollTo(0, 800))
    const burstChip = page.locator('section').filter({ hasText: 'Stream Recap' }).locator('.font-mono').first()
    if (await burstChip.count()) {
      const chipText = await burstChip.textContent()
      expect(chipText?.trim()).not.toBe('7')
    }

    await assertNoConsoleErrors(page, filterBenignConsoleErrors(errors))
  })

  test('deep link #t=6060 shows rail stats and under-chart emotes', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)

    await page.goto(`${SESSION_PATH}#t=6060`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('region', { name: 'Pulse moments recap' }).waitFor({
      state: 'visible',
      timeout: 60_000,
    })

    const rail = page.getByRole('region', { name: 'Pulse moments recap' })
    await expect(rail.getByText(/viewers · .*\/min · .*emotes/i).first()).toBeVisible()

    const panel = page.locator('[aria-label*="Selected moment" i]').first()
    await expect(panel).toBeVisible({ timeout: 30_000 })
    await expect(panel.getByText(/Chat activity/i)).toBeVisible()
    await expect(panel.getByText(/Emotes:/i)).toBeVisible()

    const railEmoteChips = rail.locator('img[alt]').first()
    if (await railEmoteChips.count()) {
      expect(await rail.locator('img[alt]').count()).toBeGreaterThanOrEqual(1)
    }

    expect(await panel.locator('img').count()).toBeGreaterThanOrEqual(1)

    await assertNoConsoleErrors(page, filterBenignConsoleErrors(errors))
  })

  test('jynxzi session shows CDN emote images in pulse moments and burst chip', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)

    await page.goto(JYNXZI_SESSION_PATH, { waitUntil: 'domcontentloaded' })
    await page.getByRole('region', { name: 'Pulse moments recap' }).waitFor({
      state: 'visible',
      timeout: 90_000,
    })

    const rail = page.getByRole('region', { name: 'Pulse moments recap' })
    const rowEmoteImg = rail.locator('button img[src]').first()
    await expect(rowEmoteImg).toBeVisible({ timeout: 30_000 })
    await expect(rowEmoteImg).toHaveAttribute('src', /cdn\.7tv\.app|static-cdn\.jtvnw\.net/)

    const recapSection = page.locator('section').filter({ hasText: 'Stream Recap' })
    if (await recapSection.filter({ hasText: 'Emote burst' }).count()) {
      const burstImg = recapSection.locator('img[src]').first()
      await expect(burstImg).toBeVisible({ timeout: 15_000 })
      await expect(burstImg).toHaveAttribute('src', /cdn\.7tv\.app|static-cdn\.jtvnw\.net/)
    }

    await assertNoConsoleErrors(page, filterBenignConsoleErrors(errors))
  })
})

test.describe('analytics channel live sidebar', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(({}, testInfo) => {
    testInfo.setTimeout(120_000)
  })

  test('offline channel redirects to newest synced session slug', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)

    await page.goto(CHANNEL_PATH, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/analytics\/kato_junichi0817\/\d{4}-\d{2}-\d{2}/, { timeout: 60_000 })

    await expect(page.getByRole('navigation', { name: 'Analytics sections' })).toHaveCount(0)
    await expect(page.getByText('Live — no VOD yet')).toHaveCount(0)
    await expect(page.getByText('Collecting first minutes')).toHaveCount(0)
    await expect(page.getByText('Live / Current')).toHaveCount(0)

    await page.getByRole('img', { name: 'Analytics timeline chart' }).waitFor({
      state: 'visible',
      timeout: 60_000,
    })

    await assertNoConsoleErrors(page, filterBenignConsoleErrors(errors))
  })

  test('jynxzi channel loads console without duplicate Live / Current row', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)

    await page.goto(JYNXZI_CHANNEL_PATH, { waitUntil: 'domcontentloaded' })
    await page.locator('.sc-stream-row').first().waitFor({ state: 'visible', timeout: 60_000 })

    await expect(page.getByText('Live / Current')).toHaveCount(0)

    const onSessionSlug = /\/analytics\/jynxzi\/(\d{4}-\d{2}-\d{2}|[0-9]+)/.test(page.url())
    if (onSessionSlug) {
      await expect(page.getByText('Live — no VOD yet')).toHaveCount(0)
    }

    await page.getByRole('img', { name: 'Analytics timeline chart' }).waitFor({
      state: 'visible',
      timeout: 60_000,
    })

    await assertNoConsoleErrors(page, filterBenignConsoleErrors(errors))
  })
})
