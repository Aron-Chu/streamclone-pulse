import { test, expect } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
  assertNoWhiteAnalyticsSurfaces,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

test.describe('analytics hub UX (interaction)', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  test('hub search opens channel without metadata lookup', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let channelLookups = 0
    await page.route(/\/v1\/channels\/[^/]+/, async (route) => {
      channelLookups += 1
      await route.fulfill({ status: 404, body: '{}' })
    })
    await page.goto('/analytics')
    const search = page.getByPlaceholder(/search channels/i)
    await expect(search).toBeVisible()
    await page.locator('body').click({ position: { x: 8, y: 8 } })
    await page.keyboard.press('Control+KeyK')
    await expect(search).toBeFocused()
    await search.fill('newcreator')
    await page.getByRole('button', { name: /^open$/i }).click()
    await expect(page).toHaveURL(/\/analytics\/newcreator/)
    expect(channelLookups).toBe(0)
    await assertNoConsoleErrors(page, errors)
  })

  test('chart hover uses preview inspector styling without active fill', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    const inspector = page.locator('.activity-bucket-inspector')
    await expect(inspector).toBeVisible()
    await expect(inspector).not.toHaveClass(/activity-bucket-inspector--active/)
    const box = await chart.boundingBox()
    expect(box).toBeTruthy()
    await chart.hover({ position: { x: box!.width * 0.55, y: box!.height * 0.5 } })
    await expect(inspector).toHaveClass(/activity-bucket-inspector--preview/)
    await expect(inspector).not.toHaveClass(/activity-bucket-inspector--active/)
    await expect(inspector.getByText(/^Preview ·/)).toBeVisible()
    await assertNoWhiteAnalyticsSurfaces(page)
    await assertNoConsoleErrors(page, errors)
  })

  test('chart bucket selection shows diagnostics and loads historical corpus peaks', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let historicalRequests = 0
    await page.route(/\/v1\/public\/hub\/moments(\?.*)?$/, async (route) => {
      historicalRequests += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          moments: [
            {
              login: 'xqc',
              displayName: 'xQc',
              streamId: 'hist-1',
              offsetSeconds: 600,
              score: 88,
              label: 'Corpus peak',
              source: 'corpus',
              confidence: 90,
              vodState: 'vod_ready',
              chatPerMin: 220,
              viewerDelta: 90,
              at: Date.now() - 8 * 60 * 60 * 1000 + 120_000,
            },
          ],
        }),
      })
    })
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toHaveClass(/hx-chart2--selectable/)
    const box = await chart.boundingBox()
    expect(box).toBeTruthy()
    let selected = false
    for (const ratio of [0.82, 0.65, 0.45, 0.28, 0.15]) {
      await chart.click({ position: { x: Math.floor(box!.width * ratio), y: Math.floor(box!.height * 0.5) } })
      if (await page.locator('.pulse-moments-live__bucket-filter').isVisible()) {
        selected = true
        break
      }
    }
    expect(selected, 'expected an active chart bucket click to stick').toBe(true)
    const diagnostics = page.locator('.pulse-moments-live__diagnostics')
    await expect(diagnostics).toBeVisible()
    await expect(diagnostics).toContainText(/Bucket/i)
    if (historicalRequests > 0) {
      await expect(page.locator('.pulse-moments__peak-label', { hasText: 'Corpus peak' }).first()).toBeVisible({
        timeout: 20_000,
      })
      await expect(diagnostics).toContainText(/Stored moments:/i)
    }
    await assertNoConsoleErrors(page, errors)
  })

  test('featured rail shows movers strip and pool KPI uses poolSize', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.hub-live-rail-movers')).toBeVisible()
    await expect(page.getByRole('link', { name: /xQc/i }).first()).toBeVisible()
    await expect(page.getByText('96', { exact: true }).first()).toBeVisible()
    await assertNoWhiteAnalyticsSurfaces(page)
    await assertNoConsoleErrors(page, errors)
  })

  test('moment inspector top emote card layout after row select', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.pulse-moments-live')).toBeVisible()
    await page.locator('.pulse-moments__peak-row').first().click()

    const emoteCard = page.locator('.pulse-moments__inspector-emote-card')
    await expect(emoteCard).toBeVisible()
    await expect(emoteCard.getByText('Top emote this minute')).toBeVisible()
    await expect(emoteCard.locator('.pulse-moments__inspector-top-emote-name')).toHaveText('DinoDance')
    await expect(emoteCard.locator('.pulse-moments__inspector-provider')).toHaveText('Twitch')
    await expect(emoteCard.locator('.pulse-moments__inspector-emote-stat-row strong')).toHaveText('123')
    await expect(emoteCard.getByText('uses this minute')).toBeVisible()
    await expect(emoteCard.getByText('of emotes')).toBeVisible()

    const kpiRow = page.locator('.pulse-moments__inspector-kpi-row')
    await expect(kpiRow).toBeVisible()
    await expect(kpiRow.getByText('Total emote uses')).toBeVisible()
    await expect(kpiRow.getByText('Chat / min')).toBeVisible()
    await expect(kpiRow.getByText('Viewer change')).toBeVisible()
    await expect(kpiRow.getByText('no change')).toBeVisible()

    const analyticsBtn = page.locator('.hub-openbtn--accent', { hasText: 'Analytics' })
    await expect(analyticsBtn).toBeVisible()

    await expect(emoteCard).toHaveScreenshot('moment-inspector-top-emote-card.png', {
      maxDiffPixelRatio: 0.04,
    })
    await assertNoConsoleErrors(page, errors)
  })

  test('global activity shell visual baseline', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.figma-activity-hub')).toBeVisible()
    await expect(page.locator('.figma-global-activity')).toBeVisible()
    await expect(page.locator('.activity-bucket-inspector')).toBeVisible()
    await assertNoWhiteAnalyticsSurfaces(page)
    await expect(page.locator('.figma-global-activity')).toHaveScreenshot('hub-global-activity-shell.png', {
      maxDiffPixelRatio: 0.04,
    })
    await assertNoConsoleErrors(page, errors)
  })
})
