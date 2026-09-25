import { test, expect } from '../helpers/testFixtures.ts'

test('packaged supporter settings stay local, accessible and responsive', async ({ extension, prepare }, info) => {
  await prepare()
  const page = extension.page
  const before = await extension.serviceWorker.evaluate(() => chrome.storage.sync.get(null))
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await expect(page.getByRole('heading', { name: 'Account & Supporter' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Account & Supporter' })).toHaveAttribute('aria-current', 'page')
  const choices = page.getByRole('group', { name: 'Tenure preview' })
  await expect(choices.getByRole('radio')).toHaveCount(5)
  const radio = choices.getByRole('radio', { name: '24 months', exact: true })
  await radio.check()
  const sample = page.getByLabel('Sample compatible StreamPulse chat message')
  await expect(sample.locator('[data-supporter-badge="24m"]')).toBeVisible()
  // Preview at native chat size, where small artwork must remain legible.
  await expect(sample.locator('svg')).toHaveCSS('width', '18px')
  await expect(page.getByText('Two-year pinnacle')).toBeVisible()
  await page.screenshot({ path: info.outputPath('supporter-settings-24m.png'), fullPage: true, animations: 'disabled' })
  await radio.press('ArrowRight')
  await expect(choices.getByRole('radio', { name: 'New', exact: true })).toBeChecked()
  await expect(sample.locator('[data-supporter-badge="new"]')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Show badge in this preview' }).uncheck()
  await expect(sample.locator('svg')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Show badge in this preview' }).check()
  await expect(sample.locator('[data-supporter-badge="new"]')).toBeVisible()
  await expect(page.getByText(/nothing is equipped, published, or injected into Twitch chat/)).toBeVisible()
  await page.screenshot({ path: info.outputPath('supporter-settings.png'), fullPage: true, animations: 'disabled' })
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: info.outputPath(`supporter-settings-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await radio.check()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'New', exact: true })).toBeChecked()
  const after = await extension.serviceWorker.evaluate(() => chrome.storage.sync.get(null))
  expect(after).toEqual(before)
  await page.getByRole('link', { name: 'Privacy & Data', exact: true }).click()
  await expect(page).toHaveURL(/#privacy$/)
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Account & Supporter' })).toBeVisible()
})

test('account settings connect through the packaged worker and disconnect', async ({ extension, prepare }) => {
  await prepare()
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({ json: { pollingSecret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600000).toISOString() }, status: 201 }))
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links/poll', route => route.fulfill({ json: {
    state: 'approved', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: '11111111-1111-1111-1111-111111111111', deviceId: '22222222-2222-2222-2222-222222222222', expiresAt: new Date(Date.now() + 86400000).toISOString(), refreshExpiresAt: new Date(Date.now() + 172800000).toISOString(),
  } }))
  await extension.context.route('https://api.streampulse.stream/v1/account/devices/disconnect', route => route.fulfill({ status: 204 }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await page.getByRole('button', { name: 'Link extension', exact: true }).click()
  await expect(page.getByText('ABCDE-12345', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open account page' })).toHaveAttribute('href', 'https://streampulse.stream/account/link-device')
  expect(await page.locator('body').innerText()).not.toContain('c'.repeat(64))
  await expect(page.getByText('This extension is connected.', { exact: true })).toBeVisible({ timeout: 12000 })
  await expect(page.getByText('This connection does not confirm a subscription or link your Twitch identity.')).toBeVisible()
  await page.getByRole('button', { name: 'Disconnect extension' }).click()
  await expect(page.getByRole('button', { name: 'Link extension', exact: true })).toBeVisible()
})

test('unmounted account backend produces a clear unavailable state', async ({ extension, prepare }) => {
  await prepare()
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({ status: 404 }))
  await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await extension.page.getByRole('button', { name: 'Link extension', exact: true }).click()
  await expect(extension.page.getByText('Account linking is not available on the server yet. Your free tools still work.')).toBeVisible()
  await expect(extension.page.getByRole('link', { name: 'Open account page' })).toHaveCount(0)
})
