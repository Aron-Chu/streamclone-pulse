import { expect, test, type Page } from './helpers/portalMockedTest'

/**
 * Privacy and Terms fold into headed sections (Aron's 10-09 ask): every section
 * after the summary block is a closed <details> under its own <h2>, the legal text
 * is all in the page, and a link to a heading opens its section.
 */

async function guardNetwork(page: Page) {
  await page.route('**/v1/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }))
}

const folds = (page: Page) => page.locator('details[data-fold]')
const openFolds = (page: Page) => page.locator('details[data-fold][open]')

for (const route of ['/privacy', '/terms']) {
  test(`${route}: the summary stays open above closed sections, one heading each`, async ({ page }) => {
    await guardNetwork(page)
    await page.goto(route)
    await expect(page.locator('h1').first()).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Summary' })).toBeVisible()
    expect(await folds(page).count()).toBeGreaterThan(8)
    await expect(openFolds(page)).toHaveCount(0)
    // Every section heading is visible and is the summary of its section; the text under it is not shown.
    const summaries = page.locator('details[data-fold] > summary > h2')
    expect(await summaries.count()).toBe(await folds(page).count())
    await expect(summaries.first()).toBeVisible()
    await expect(folds(page).first().locator('.public-fold__body')).toBeHidden()
  })

  test(`${route}: a heading opens and closes its own section only`, async ({ page }) => {
    await guardNetwork(page)
    await page.goto(route)
    const first = folds(page).first()
    const second = folds(page).nth(1)
    await first.locator('summary').click()
    await expect(first).toHaveAttribute('open', '')
    await expect(first.locator('.public-fold__body')).toBeVisible()
    await expect(second).not.toHaveAttribute('open', '')
    await first.locator('summary').click()
    await expect(first).not.toHaveAttribute('open', '')
  })

  test(`${route}: keyboard users open a section with Enter on its heading`, async ({ page }) => {
    await guardNetwork(page)
    await page.goto(route)
    const first = folds(page).first()
    await first.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(first).toHaveAttribute('open', '')
    await page.keyboard.press('Enter')
    await expect(first).not.toHaveAttribute('open', '')
  })

  test(`${route}: a print opens every section, then puts each back`, async ({ page }) => {
    await guardNetwork(page)
    await page.goto(route)
    await folds(page).nth(2).locator('summary').click()
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await expect(openFolds(page)).toHaveCount(await folds(page).count())
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await expect(openFolds(page)).toHaveCount(1)
    await expect(folds(page).nth(2)).toHaveAttribute('open', '')
  })
}

test('/terms#supporter lands on the Pulse Supporter heading with its section open', async ({ page }) => {
  await guardNetwork(page)
  await page.goto('/terms#supporter')
  const fold = page.locator('details[data-fold]:has(h2#supporter)')
  await expect(fold).toHaveAttribute('open', '')
  await expect(page.locator('h2#supporter')).toBeInViewport()
  await expect(fold.getByTestId('terms-supporter-benefits')).toBeVisible()
  await expect(openFolds(page)).toHaveCount(1)
})

test('/privacy#feedback-form lands on the Feedback form heading with its section open', async ({ page }) => {
  await guardNetwork(page)
  await page.goto('/privacy#feedback-form')
  const fold = page.locator('details[data-fold]:has(h2#feedback-form)')
  await expect(fold).toHaveAttribute('open', '')
  await expect(page.locator('h2#feedback-form')).toBeInViewport()
  await expect(fold.getByTestId('privacy-feedback-sent')).toBeVisible()
  await expect(openFolds(page)).toHaveCount(1)
})

test('the Supporter page link to the Supporter terms opens that section in the Terms', async ({ page }) => {
  await guardNetwork(page)
  await page.goto('/supporter')
  await page.getByRole('link', { name: 'Supporter terms' }).click()
  await expect(page).toHaveURL(/\/terms#supporter$/)
  await expect(page.locator('details[data-fold]:has(h2#supporter)')).toHaveAttribute('open', '')
  await expect(page.locator('h2#supporter')).toBeInViewport()
})

test('the folded Privacy page is much shorter than its text: the sections start closed', async ({ page }) => {
  await guardNetwork(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/privacy')
  await expect(page.locator('h1').first()).toBeVisible()
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  // The audit measured 19,600 px of text on a phone before folding.
  expect(height).toBeLessThan(5_000)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
