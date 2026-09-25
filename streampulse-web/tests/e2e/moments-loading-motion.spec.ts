import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

test('slow first load reserves cards and reveals arrivals without replaying filters', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.animate
    const log: { key: string; opacityAtStart: number }[] = []
    ;(window as unknown as { arrivalLog: typeof log }).arrivalLog = log
    Element.prototype.animate = function(...args) {
      const animation = original.apply(this, args)
      if (this.hasAttribute('data-arrival-key')) {
        animation.pause()
        animation.currentTime = 0
        log.push({ key: this.getAttribute('data-arrival-key')!, opacityAtStart: Number(getComputedStyle(this).opacity) })
        animation.play()
      }
      return animation
    }
  })
  await installHubUxMock(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/public/hub?**', async route => { await held; await route.fallback() })
  await page.goto('/analytics/moments?view=recent')
  await expect(page.locator('.moments-loading__card')).toHaveCount(6)
  await expect(page.getByRole('region', { name: 'Moment results' })).toHaveAttribute('aria-busy','true')
  release()
  await expect(page.locator('.moments-result').first()).toBeVisible()
  await expect(page.locator('.moments-loading')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Moment results' })).toHaveAttribute('aria-busy','false')
  const arrivals = await page.evaluate(() => (window as unknown as { arrivalLog: string[] }).arrivalLog.length)
  expect(arrivals).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as unknown as { arrivalLog: { opacityAtStart: number }[] }).arrivalLog.every(entry => entry.opacityAtStart === 1))).toBe(true)
  await page.getByRole('searchbox').fill('no-such-creator')
  await expect(page.locator('.moments-result')).toHaveCount(0)
  await page.getByRole('searchbox').fill('')
  await expect(page.locator('.moments-result').first()).toBeVisible()
  expect(await page.locator('.moments-result').first().evaluate(el => el.getAnimations().length)).toBe(0)
  expect(await page.evaluate(() => (window as unknown as { arrivalLog: string[] }).arrivalLog.length)).toBe(arrivals)
})

test('reduced motion leaves loaded cards immediately readable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  await page.goto('/analytics/moments?view=recent')
  await expect(page.locator('.moments-result').first()).toBeVisible()
  expect(await page.locator('.moments-result').first().evaluate(el => ({ opacity: getComputedStyle(el).opacity, animations: el.getAnimations().length }))).toEqual({ opacity: '1', animations: 0 })
})
