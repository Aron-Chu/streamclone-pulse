import { expect, test } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('independent Live Wire keeps creator imagery without duplicating the Newsroom board', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')
  const rail = page.locator('.analytics-discovery-layout__wire')
  await expect(rail.locator('.hub-live-wire')).toHaveCount(1)
  await expect(rail.locator('.newsroom-lead--compact')).toHaveCount(0)
  await expect(rail.locator('.newsroom-lead--feature, .newsroom-lead--tile, .newsroom-sparkline')).toHaveCount(0)
  const avatar = rail.locator('.hub-live-wire__rail-av img').first()
  await expect(avatar).toBeVisible()
  await expect.poll(() => avatar.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  const surface = await rail.evaluate(element => ({ background: getComputedStyle(element).backgroundImage, overflow: getComputedStyle(element).overflowY }))
  expect(surface.background).toBe('none')
  expect(surface.overflow).not.toMatch(/auto|scroll/)
})
