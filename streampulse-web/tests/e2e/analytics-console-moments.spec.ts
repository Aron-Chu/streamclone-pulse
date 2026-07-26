import { test, expect } from '@playwright/test'
import {
  attachHostedApiGuard,
  assertHostedApiOnly,
  clearBackendOverrides,
  waitForHostedApiTraffic,
} from './helpers/hostedApi'

const LOGIN = process.env.ANALYTICS_E2E_LOGIN?.trim() || 'xqc'
const STREAM_ID = process.env.ANALYTICS_E2E_STREAM_ID?.trim() || '319253683932'

test.describe('analytics console moments + emotes (hosted)', () => {
  test.beforeEach(async ({ page }) => {
    await clearBackendOverrides(page)
    await page.setViewportSize({ width: 1600, height: 1000 })
  })

  test('symmetric rails, amber moment hover, emote plotting', async ({ page }, testInfo) => {
    const violations = attachHostedApiGuard(page)
    const path = `/analytics/${LOGIN}/${STREAM_ID}`
    const consoleRoot = page.locator('.sc-analytics-console')

    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await waitForHostedApiTraffic(page)
    await page.getByRole('main', { name: new RegExp(`Analytics for ${LOGIN}`, 'i') }).waitFor({
      state: 'visible',
      timeout: 45_000,
    })
    await consoleRoot.waitFor({ state: 'visible', timeout: 45_000 })

    const rails = consoleRoot.locator('.analytics-console > div > div.grid.gap-4 > aside')
    await expect(rails).toHaveCount(2, { timeout: 15_000 })
    const streamsBox = await rails.nth(0).boundingBox()
    const rightBox = await rails.nth(1).boundingBox()
    expect(streamsBox).not.toBeNull()
    expect(rightBox).not.toBeNull()
    if (streamsBox && rightBox) {
      expect(Math.abs(streamsBox.width - rightBox.width)).toBeLessThan(6)
    }

    await consoleRoot.getByRole('button', { name: 'Moments', exact: true }).click()
    const pulseMomentsHeading = consoleRoot.getByText('Pulse Moments')
    const topMomentsHeading = consoleRoot.getByText('Top Moments')
    const hasPulseMoments = await pulseMomentsHeading.isVisible().catch(() => false)
    const hasTopMoments = await topMomentsHeading.isVisible().catch(() => false)
    expect(hasPulseMoments || hasTopMoments).toBe(true)
    expect(hasPulseMoments && hasTopMoments).toBe(false)

    const momentRows = (hasPulseMoments ? pulseMomentsHeading : topMomentsHeading)
      .locator('xpath=following::button[contains(@class,"grid-cols")]')
    await expect(momentRows.first()).toBeVisible({ timeout: 30_000 })
    const rowCount = await momentRows.count()
    test.skip(rowCount < 2, 'Need at least 2 ranked moments for hover test')

    const secondRow = momentRows.nth(1)
    await secondRow.hover()
    await expect(secondRow).toHaveClass(/amber-300/)
    await expect(secondRow).not.toHaveClass(/cyan/)

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return Array.from(document.querySelectorAll('svg line')).some((line) => {
            const stroke = line.getAttribute('stroke') ?? ''
            return /245,\s*158,\s*11|#f59e0b|f59e0b/i.test(stroke)
          })
        })
      }, { timeout: 8_000 })
      .toBe(true)

    await page.screenshot({
      path: testInfo.outputPath('moments-hover-amber.png'),
    })

    await secondRow.click()
    await expect(secondRow).toHaveClass(/amber-400/)

    const panelTabs = consoleRoot.locator('.flex.border-b.border-white\\/10 button')
    await panelTabs.filter({ hasText: /^Emotes$/ }).click()
    const chartViewTabs = consoleRoot.locator('button.rounded.px-3').filter({ hasText: /^Emotes$/ })
    await chartViewTabs.click()

    const emoteTableButtons = consoleRoot
      .getByText('Emote', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"overflow")]//button[contains(@class,"grid")]')
    await expect(emoteTableButtons.first()).toBeVisible({ timeout: 15_000 })

    const emoteCount = await emoteTableButtons.count()
    if (emoteCount >= 2) {
      await emoteTableButtons.nth(0).click()
      await emoteTableButtons.nth(1).click()
    }

    const emoteLegendChips = consoleRoot.locator('.sc-chart-root button[aria-pressed]')
    await consoleRoot.getByRole('button', { name: /Plot emotes/i }).click()
    await expect(emoteLegendChips.first()).toBeVisible({ timeout: 10_000 })

    await expect
      .poll(async () => {
        const borderColors = await emoteLegendChips.evaluateAll((buttons) =>
          buttons
            .map((btn) => getComputedStyle(btn).borderColor)
            .filter((color) => color && !/255,\s*255,\s*255/.test(color)),
        )
        return new Set(borderColors).size
      }, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(2)

    const legendChips = consoleRoot.locator('button').filter({ hasText: /max/i })
    await expect(legendChips.first()).toBeVisible({ timeout: 10_000 })

    await page.screenshot({
      path: testInfo.outputPath('emotes-plotted.png'),
      fullPage: true,
    })

    await testInfo.attach('moments-hover-amber', {
      path: testInfo.outputPath('moments-hover-amber.png'),
      contentType: 'image/png',
    })
    await testInfo.attach('emotes-plotted', {
      path: testInfo.outputPath('emotes-plotted.png'),
      contentType: 'image/png',
    })

    assertHostedApiOnly(violations)
  })
})
