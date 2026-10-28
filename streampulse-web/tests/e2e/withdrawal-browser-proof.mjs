// Local-only browser proof. The caller supplies a real disposable backend and
// DB; the bot check is stubbed locally and every non-loopback request blocked.
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const output = process.env.WITHDRAWAL_PROOF_DIR
if (!output) throw new Error('Set WITHDRAWAL_PROOF_DIR to a local proof folder.')
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
let posts = 0
try {
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({ status: 200, contentType: 'text/javascript', body: `
      (() => { let callback; window.turnstile = {
        render(_host, options) { callback = options.callback; setTimeout(() => callback('synthetic-test-token'), 0); return 'local-widget' },
        reset() { setTimeout(() => callback('synthetic-test-token'), 0) }, remove() {}
      } })();` })
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue()
    return route.abort()
  })
  const page = await context.newPage()
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.pathname.includes('withdrawals')) console.log('Local request failed:', request.method(), url.pathname, request.failure()?.errorText)
  })
  page.on('pageerror', error => console.log('Page error:', error.message))
  page.on('console', message => { if (message.type() === 'error') console.log('Browser error:', message.text()) })
  await page.route('**/v1/portal/supporter/withdrawals', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    posts += 1
    if (posts === 1) {
      // Commit the first submission at the real backend, then simulate its
      // response being lost. The next click must replay the same request.
      const response = await route.fetch()
      if (!response.ok()) throw new Error(`First local submission failed: ${response.status()}`)
      return route.abort('failed')
    }
    return route.continue()
  })
  await page.goto('http://127.0.0.1:5173/withdraw')
  const backend = await page.evaluate(async () => (await import('/src/lib/auth.ts')).DEFAULT_BACKEND_URL)
  if (backend !== 'http://127.0.0.1:8099') throw new Error('The proof backend override is not active.')
  const probe = await page.evaluate(async () => {
    try { await (await import('/src/lib/apiClient.ts')).apiClient('/v1/portal/supporter/withdrawals', { method: 'GET', sensitive: true }) }
    catch (error) { return { status: error?.status, kind: error?.kind, message: error?.message } }
    return { status: 200 }
  })
  if (probe.status !== 400) throw new Error(`Local API probe failed: ${JSON.stringify(probe)}`)
  await page.getByLabel('Your name').fill('Sandbox Buyer')
  await page.getByLabel('Email for your acknowledgement').fill('withdraw-proof@example.test')
  await page.getByLabel('Details to identify the subscription').fill('Synthetic receipt in_withdrawal_test')
  await page.getByRole('button', { name: 'Review withdrawal' }).click()
  await expect(page.getByText('I wish to withdraw from my Pulse Supporter contract.')).toBeVisible()
  expect(posts).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: path.join(output, 'review.png'), fullPage: true })
  const confirm = page.getByRole('button', { name: 'Confirm withdrawal' })
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(page.getByText(/could not confirm whether your request was received/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0)
  expect(posts).toBe(1)
  await page.screenshot({ path: path.join(output, 'uncertain.png'), fullPage: true })
  await page.reload()
  await expect(page.getByText(/earlier request in this tab may have been received/i)).toBeVisible()
  await page.getByLabel('Your name').fill('Sandbox Buyer')
  await page.getByLabel('Email for your acknowledgement').fill('withdraw-proof@example.test')
  await page.getByLabel('Details to identify the subscription').fill('Synthetic receipt in_withdrawal_test')
  await page.getByRole('button', { name: 'Review withdrawal' }).click()
  await expect(page.getByRole('button', { name: 'Confirm withdrawal' })).toBeEnabled()
  await page.getByRole('button', { name: 'Confirm withdrawal' }).click()
  await expect(page.getByRole('heading', { name: 'Withdrawal request received' })).toBeVisible()
  await expect(page.getByText(/does not mean a refund has already been issued/i)).toBeVisible()
  expect(posts).toBe(2)
  expect(new URL(page.url()).search).toBe('')
  await page.screenshot({ path: path.join(output, 'received.png'), fullPage: true })
  // Desktop keyboard navigation reaches review without submitting a second case.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:5173/withdraw')
  await page.getByLabel('Your name').focus()
  await page.keyboard.type('Keyboard Buyer')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Email for your acknowledgement')).toBeFocused()
  await page.keyboard.type('keyboard@example.test')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Details to identify the subscription')).toBeFocused()
  await page.keyboard.type('Synthetic contract')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Review withdrawal' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Review your withdrawal' })).toBeVisible()
  expect(posts).toBe(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: path.join(output, 'keyboard-review.png'), fullPage: true })
  console.log('Browser request, refresh after lost response, idempotent retry and keyboard review passed.')
} finally {
  await context.close()
  await browser.close()
}
