import { expect, test } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

test.describe('analytics truth v1 end-to-end', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page, { truthV1: true })
  })

  test('desktop renders backend-qualified comparisons, evidence, Live Wire, and market preview', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/analytics?marketPreview=fixture')

    const matrix = page.locator('.live-channels-matrix')
    await expect(matrix).toBeVisible()
    await matrix.getByRole('tab', { name: 'Activity change', exact: true }).click()
    await expect(matrix.locator('.metric-comparison').first()).toBeVisible()
    await expect(matrix.getByText('New activity', { exact: true }).first()).toBeVisible()
    await expect(matrix.getByText('Warming', { exact: true }).first()).toBeVisible()
    await expect(matrix.getByText('Partial', { exact: true }).first()).toBeVisible()
    await expect(matrix.getByText('Unavailable', { exact: true }).first()).toBeVisible()

    await matrix.getByRole('tab', { name: 'Coverage evidence', exact: true }).click()
    await expect(matrix.locator('.live-channels-matrix__covbar')).toHaveCount(0)
    const evidence = matrix.locator('.evidence-summary').first()
    await expect(evidence).toContainText('Bound')
    await expect(evidence).toContainText('5/5 min')
    await expect(evidence).toContainText('60/60 min')

    const market = page.locator('.emote-market')
    await expect(market.getByText('Rising channels', { exact: true })).toBeVisible()
    await expect(market.getByText('Highest emote rate', { exact: true })).toHaveCount(0)
    await expect(market.getByText(/median lift \+57\/min/i)).toBeVisible()

    const wire = page.locator('.hub-live-wire')
    const comparedWireChip = wire.locator('.hub-live-wire__chip').filter({ hasText: 'xQc' })
    await expect(comparedWireChip).toContainText(/Emotes reached 133\/min/i)
    await expect(comparedWireChip).toContainText(/this stream's earlier average/i)
    await expect(comparedWireChip).toContainText(/Breakout strength 92\/100/i)
    await expect(comparedWireChip).toContainText(/60\/63 earlier minutes/i)

    const breadthTab = market.getByRole('tab', { name: 'Breadth', exact: true })
    if ((await breadthTab.count()) > 0) {
      // Vite development/test exposes the deterministic fixture for design QA.
      await breadthTab.focus()
      await breadthTab.press('Enter')
      await expect(market.getByRole('columnheader', { name: 'Channel share' })).toBeVisible()
      await breadthTab.press('ArrowRight')
      const concentrationTab = market.getByRole('tab', { name: 'Concentration', exact: true })
      await expect(concentrationTab).toHaveAttribute('aria-selected', 'true')
      await expect(market.getByText('Reaction concentration', { exact: true })).toBeVisible()
      await concentrationTab.press('ArrowRight')
      const rotationTab = market.getByRole('tab', { name: 'Rotation', exact: true })
      await expect(rotationTab).toHaveAttribute('aria-selected', 'true')
      await expect(market.getByRole('columnheader', { name: 'Rank' })).toBeVisible()
      await rotationTab.press('End')
      await expect(market.getByRole('heading', { name: 'Provider regime', exact: true })).toBeVisible()
    } else {
      // Production builds must ignore ?marketPreview=fixture and hide unavailable panels.
      await expect(market.getByText(/internal deterministic design preview/i)).toHaveCount(0)
      await expect(market.getByRole('tab', { name: 'Rotation', exact: true })).toHaveCount(0)
    }

    const interactiveTargets = page.locator([
      '.live-channels-matrix__tab',
      '.live-channels-matrix__view-tab',
      '.live-channels-matrix__sort-btn',
      '.live-channels-matrix__expand',
      '.emote-market__view-tab',
    ].join(', '))
    const targetSizes = await interactiveTargets.evaluateAll((elements) => elements
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return { className: element.className, width: rect.width, height: rect.height }
      }))
    expect(targetSizes.length).toBeGreaterThan(0)
    expect(targetSizes.filter(({ width, height }) => width < 44 || height < 44)).toEqual([])

    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(noOverflow).toBe(true)
    await assertNoConsoleErrors(page, errors)
  })

  test('mobile uses one card tree with keyboard-accessible views and no horizontal overflow', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/analytics?marketPreview=fixture')

    const matrix = page.locator('.live-channels-matrix')
    await expect(matrix.locator('table')).toHaveCount(0)
    await expect(matrix.locator('.live-channels-matrix__card')).toHaveCount(14)
    const activityTab = matrix.getByRole('tab', { name: 'Activity change', exact: true })
    await activityTab.focus()
    await activityTab.press('Enter')
    await expect(activityTab).toHaveAttribute('aria-selected', 'true')
    await expect(matrix.locator('.paired-rate-bars').first()).toBeVisible()
    await activityTab.press('ArrowRight')
    const evidenceTab = matrix.getByRole('tab', { name: 'Coverage evidence', exact: true })
    await expect(evidenceTab).toHaveAttribute('aria-selected', 'true')
    await evidenceTab.press('ArrowLeft')
    await expect(activityTab).toHaveAttribute('aria-selected', 'true')

    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(noOverflow).toBe(true)
    await assertNoConsoleErrors(page, errors)
  })
})
