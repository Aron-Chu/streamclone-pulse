import type { Page } from '@playwright/test'

export async function seedBetaKey(page: Page, key = 'test-beta-key'): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('sp.betaKey', value)
  }, key)
}