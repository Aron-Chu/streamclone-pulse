import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('hub chart keeps a viewer foreground with truthful chat bars and an external hover readout', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toBeVisible()
  // Viewers and emotes use independent line scales; tracked chat is the only
  // bar series. Unlike units are never stacked into one contribution bar.
  await expect(chart.locator('.hx-chart-line--viewers')).not.toHaveCount(0)
  await expect(chart.locator('.hx-chart-line--emotes')).not.toHaveCount(0)
  await expect(chart.locator('[data-component="HubActivityBarSeries"] .hx-chat-bar')).not.toHaveCount(0)
  await expect(chart.locator('.hx-bar-segment--viewers, .hx-bar-segment--emotes')).toHaveCount(0)
  await expect(page.locator('.hx-moment-marker')).toHaveCount(0)
  await expect(chart.locator('.hdot')).toHaveCount(0)
  await expect(chart.locator('.hx-bucket-cue__node, .hx-bucket-cue__ring')).toHaveCount(0)
  await expect(chart.locator('.hx-chart-line--chat-detail')).toHaveCount(0)
  await expect(chart.locator('.hx-chart-tip-slot .tip')).toHaveCount(0)
  await expect(page.locator('.hx-chart-header__readout')).toHaveCount(1)
})

test('hub chart updates the external readout on hover and fades back to calm', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const readout = page.locator('.figma-global-activity__hub-chart .hx-chart-header__readout')

  await expect(chart).toBeVisible()
  await expect(chart).not.toHaveAttribute('data-hover')
  await expect(chart.locator('.hx-chart-detail-layer')).toHaveCount(0)

  const box = await chart.boundingBox()
  expect(box).toBeTruthy()
  await chart.hover({ position: { x: box!.width * 0.55, y: box!.height * 0.5 } })

  await expect(chart).toHaveAttribute('data-hover', 'true')
  await expect(readout).toContainText('Viewers')
  await expect(chart.locator('.hx-detail-readout')).toHaveCount(0)
  await expect(page.locator('.hx-moment-marker')).toHaveCount(0)

  await page.mouse.move(4, 4)
  await expect(chart).not.toHaveAttribute('data-hover')
  await expect(readout).not.toContainText('Viewers')
})

test('Live Wire explains the detected event and keeps chat plus emote from the same channel', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  await expect(liveWire).toBeVisible()
  const first = liveWire.getByRole('button', { name: /xQc, Emote breakout/i })
  await expect(first).toContainText('xQc')
  await expect(first).toContainText('Emote breakout')
  await expect(first).toContainText('133')
  await expect(first).toContainText('393 /min')
  await expect(first).toHaveAttribute('aria-label', /IRC measured/i)
  await expect(first).toHaveAttribute('aria-label', /Inspect this activity bucket/i)
})

test('Live Wire inspection selects the matching chart bucket and Escape clears it', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  const selectedCard = liveWire.getByRole('button', { name: /Inspect this activity bucket/i }).first()
  await selectedCard.click()
  const retainedSelectedCard = page.locator('.activity-context-rail__pane--wire .hub-live-wire__event-card.is-selected').first()
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toHaveAttribute('data-selected', 'true')
  await expect(retainedSelectedCard).toHaveClass(/is-selected/)
  await expect(retainedSelectedCard).toHaveCSS('animation-name', 'hub-live-wire-selection-settle')
  await expect(retainedSelectedCard).toHaveCSS('outline-style', 'solid')
  await expect(retainedSelectedCard).toHaveCSS('border-left-width', '1px')
  await expect(retainedSelectedCard).toHaveCSS('border-right-width', '1px')
  await expect(retainedSelectedCard).toHaveCSS('box-shadow', 'none')
  await expect(page.locator('.hx-bucket-cue--selected .hx-bucket-cue__node')).toHaveCount(1)
  await expect(page.locator('.hx-bucket-cue--selected .hx-bucket-cue__ring')).toHaveCount(1)
  await expect(page.locator('.hx-bucket-cue--selected .hx-bucket-cue__line')).toHaveCSS('animation-name', 'hx-bucket-cue-line-enter')
  await chart.focus()
  await page.keyboard.press('Escape')
  await expect(chart).not.toHaveAttribute('data-selected', 'true')
})

test('a fresh Live Wire story locks the nearest completed bucket without navigating away', async ({ page }) => {
  await installHubUxMock(page, { freshMomentNeedsRollup: true })
  await page.goto('/analytics')

  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  const story = liveWire.getByRole('button', { name: /xQc.*Inspect this activity bucket/i })
  await expect(liveWire.locator('a.hub-live-wire__event-card')).toHaveCount(0)
  await story.click()

  await expect(page).toHaveURL(/\/analytics$/)
  const rail = page.locator('[data-activity-rail-view="locked"]')
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Back to Live Wire' })).toBeFocused()
  const linked = rail.getByTestId('bucket-inspector-linked-moment')
  await expect(linked).toHaveAttribute('data-bucket-relation', 'nearest_completed')
  await expect(linked).toContainText('Fresh detection')
  await expect(linked).toContainText('nearest completed bucket')
  await expect(rail.getByText('Emote breakdown')).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Clear' })).toHaveCount(0)

  const geometry = await rail.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const rows = [...element.querySelectorAll<HTMLElement>('.activity-bucket-inspector__emote-list > li')]
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      rowsInside: rows.every((row) => {
        const rect = row.getBoundingClientRect()
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
      }),
    }
  })
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
  expect(geometry.rowsInside).toBe(true)

  await rail.getByRole('button', { name: 'Back to Live Wire' }).click()
  await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
})

test('reduced motion leaves Live Wire without entrance animation class churn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const liveWire = page.getByRole('region', { name: 'Live Wire' })
  await expect(liveWire).toBeVisible()
  await expect(page.locator('.hub-live-wire__event-card.is-entering')).toHaveCount(0)
  const selectedCard = liveWire.getByRole('button', { name: /Inspect this activity bucket/i }).first()
  await selectedCard.click()
  await expect(page.locator('.activity-context-rail__pane--wire .hub-live-wire__event-card.is-selected').first())
    .toHaveCSS('animation-name', 'none')
  await expect(page.locator('.hx-bucket-cue--selected')).not.toHaveClass(/hx-bucket-cue--motion/)
})
