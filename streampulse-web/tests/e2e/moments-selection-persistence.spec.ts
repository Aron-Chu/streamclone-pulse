import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('the next selected moment retains its evidence after the collection is replaced', async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ json: {} }))
  await installHubUxMock(page)
  await page.goto('/analytics/moments?view=recent')
  await expect(page.locator('.moments-result')).toHaveCount(2)
  await page.locator('[data-discovery-key]').first().click()
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(detail.getByRole('heading', { name: 'Twitch emote spike', exact: true })).toBeVisible()
  await detail.getByRole('button', { name: 'Next moment', exact: true }).click()
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=240/)
  await expect(detail.getByRole('heading', { name: 'Chat spike', exact: true })).toBeVisible()

  await installHubUxMock(page, { mode: 'empty' })
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sp:publicHub:v1:')) localStorage.removeItem(key)
    }
  })
  const replacement = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/public/hub')
  await page.reload()
  expect((await (await replacement).json()).livePulseMoments).toEqual([])
  await expect(page.getByRole('region', { name: 'Moment results', exact: true })).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.moments-result')).toHaveCount(0)
  await expect(detail.getByRole('heading', { name: 'Chat spike', exact: true })).toBeVisible()
  const measurement = detail.getByRole('region', { name: 'Moment measurement' })
  await expect(measurement.locator('dd').nth(0)).toHaveText('280')
  await expect(measurement.locator('dd').nth(1)).toHaveText('95')
  await expect(detail.getByText('OMEGALUL', { exact: true })).toBeVisible()
  await expect(detail.getByText('Selection outside loaded matches', { exact: true })).toBeVisible()
  await detail.getByRole('button', { name: /Back to results/ }).click()
  await expect(page).toHaveURL(/\/analytics\/moments\?view=recent$/)
  await expect(detail).toHaveCount(0)
})
