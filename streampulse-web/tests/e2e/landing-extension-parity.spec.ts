import { test, expect } from '@playwright/test'
import { installMockApi } from './helpers/mockApi'
import { seedBetaKey } from './helpers/auth'
import {
  assertAnimatedTourHidesPanelScrollbar,
  assertPanelHasNoHorizontalOverflow,
  scrollSceneToProgress,
  scrollTourToStep,
} from './helpers/scrollTour'

const TOUR_BEATS = [1, 2, 3, 4] as const
const SCROLL_THROUGH_STEPS = 8

test.describe('landing extension showcase parity', () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page)
    await seedBetaKey(page)
  })

  for (const beat of TOUR_BEATS) {
    test(`pulse panel tour beat ${beat}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/#demo', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /pulse tab, feature by feature/i })).toBeVisible({
        timeout: 15_000,
      })

      await scrollTourToStep(page, beat)

      const panel = page.locator('.sl-xtour__panel .pulse-landing-panel')
      await expect(panel).toBeVisible()
      await expect(panel.getByRole('tab', { name: 'Pulse' })).toBeVisible()
      await expect(panel.getByRole('heading', { name: 'Stream Pulse' })).toBeVisible()

      if (beat === 1) {
        await expect(panel.getByText('Live now')).toBeVisible()
        await expect(panel.locator('svg[aria-label="Stream overview chart"]')).toBeVisible()
      }
      if (beat === 2) {
        await expect(panel.getByText('Data coverage')).toBeVisible()
      }
      if (beat === 3) {
        await expect(panel.locator('[data-tour-step="3"].is-live')).toBeVisible()
      }
      if (beat === 4) {
        await expect(panel.getByText(/Past streams/i)).toBeVisible()
      }

      await assertPanelHasNoHorizontalOverflow(page)
      await assertAnimatedTourHidesPanelScrollbar(page)

      await expect(panel).toHaveScreenshot(`landing-extension-beat-${beat}.png`, {
        maxDiffPixelRatio: 0.03,
      })
    })
  }

  for (let i = 0; i < SCROLL_THROUGH_STEPS; i++) {
    test(`full panel scroll-through step ${i}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/#demo', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /pulse tab, feature by feature/i })).toBeVisible({
        timeout: 15_000,
      })

      const progress = i / (SCROLL_THROUGH_STEPS - 1)
      await scrollSceneToProgress(page, progress)

      const panel = page.locator('.sl-xtour__panel .pulse-landing-panel')
      await expect(panel).toBeVisible()
      await expect(panel.getByRole('tab', { name: 'Pulse' })).toBeVisible()
      await expect(panel.getByRole('heading', { name: 'Stream Pulse' })).toBeVisible()
      await expect(panel.locator('[data-tour-step="1"]')).toBeAttached()
      await expect(panel.locator('[data-tour-step="2"]')).toBeAttached()
      await expect(panel.locator('[data-tour-step="3"]')).toBeAttached()
      await expect(panel.locator('[data-tour-step="4"]')).toBeAttached()

      const emoteImg = panel.locator('.pulse-emote-img').first()
      if (await emoteImg.count()) {
        const src = await emoteImg.getAttribute('src')
        expect(src?.startsWith('https://')).toBe(true)
      }

      await assertPanelHasNoHorizontalOverflow(page)
      await assertAnimatedTourHidesPanelScrollbar(page)

      await expect(panel).toHaveScreenshot(`landing-extension-scroll-${i}.png`, {
        maxDiffPixelRatio: 0.03,
      })
    })
  }

  test('reduced motion renders static scrollable panel', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#demo', { waitUntil: 'domcontentloaded' })

    const tour = page.locator('.sl-xtour')
    await expect(tour).toHaveAttribute('data-static', '')
    const panel = tour.locator('.pulse-landing-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-tour-step="4"]')).toBeVisible()
    await expect(panel.getByRole('tab', { name: 'Pulse' })).toBeVisible()

    await expect(panel).toHaveScreenshot('landing-extension-static-full.png', {
      maxDiffPixelRatio: 0.03,
    })
  })
})
