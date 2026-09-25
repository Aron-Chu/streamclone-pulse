import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'
import { installNewsroomMock } from './helpers/newsroomMock'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installHubUxMock(page)
  await installNewsroomMock(page)
})

test('mobile discovery puts results before secondary filters', async ({ page }) => {
  await page.goto('/analytics/moments')
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Open moment', exact: false }).first()).toBeVisible()
  const result = await page.locator('.moments-result').first().boundingBox()
  expect(result!.y).toBeLessThan(600)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toBeVisible()
})

test('empty Saved leads straight back to discovery', async ({ page }) => {
  await page.goto('/analytics/moments?view=saved')
  await expect(page.getByRole('searchbox')).toBeHidden()
  await page.getByRole('button', { name: 'Find moments to save' }).click()
  await expect(page.getByRole('tab', { name: 'Latest', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.moments-result').first()).toBeVisible()
})

test('single-result review prioritizes its exact external replay', async ({ page }) => {
  await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => route.fulfill({ json: {
    channel: 'xqc', stream: { streamId: 's1', vodId: '123456' }, vodTiming: { state: 'verified' }, vodAlignSeconds: 0, vodDurationSeconds: 18000,
  } }))
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=120&q=xqc')
  const watch = page.getByRole('link', { name: 'Watch on Twitch at 2:00' })
  await expect(watch).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  // Chromium can round a CSS 48px minimum to 47.99997px at this viewport.
  expect((await watch.boundingBox())!.height).toBeGreaterThanOrEqual(47.99)
  await expect(page.getByRole('navigation', { name: 'Review loaded moments' })).toHaveCount(0)
})
