import { test, expect } from '../helpers/testFixtures.ts'
import { linkDevice, serveMembership, supporterBody } from '../helpers/supporterMembership.ts'

test('packaged supporter settings stay local, accessible and responsive', async ({ extension, prepare }, info) => {
  await prepare()
  const page = extension.page
  const before = await extension.serviceWorker.evaluate(() => chrome.storage.sync.get(null))
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await expect(page.getByRole('heading', { name: 'Account & Supporter' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Account & Supporter' })).toHaveAttribute('aria-current', 'page')

  // Your card: the identity that exists (nobody, with Twitch sign-in off), the sample look, and the crest ladder.
  const card = page.getByRole('region', { name: 'Your Supporter card' })
  await expect(card.locator('.pulse-supporter-card-who strong')).toHaveText('Not signed in')
  await expect(card.getByText('Sample look', { exact: true })).toBeVisible()
  await expect(card).not.toContainText('Twitch')
  const ladder = card.getByRole('list', { name: 'Crest ladder' })
  await expect(ladder.getByRole('listitem')).toHaveText(['New', '3 mo', '6 mo', '1 year', '2 years'])
  // The real crest art, from the stylesheet, at ladder size.
  await expect(ladder.locator('.pulse-crest').first()).toHaveCSS('width', '22px')
  await expect(ladder.locator('.pulse-crest[data-tenure="24m"]')).toHaveCSS('background-image', /^url\("data:image\/svg\+xml/)
  // Emote rain across the card's top, on the card itself: no gradient layer.
  const top = card.locator('.pulse-supporter-card-banner')
  await expect(top).toHaveCSS('background-image', 'none')
  await expect(top.locator('.pulse-banner-art')).toHaveAttribute('data-mode', 'rain')
  await expect(card.locator('.pulse-journey')).toHaveAttribute('data-journey-state', 'unlinked')
  await expect(card.locator('.pulse-journey-primary')).toHaveText(['Become a Supporter'])

  // Who sees what: only you, a labelled concept, and normal chat for everyone else.
  const who = page.locator('.pulse-supporter-who > li')
  await expect(who.locator('strong')).toHaveText(['You', 'Other StreamPulse viewers', 'Everyone else on Twitch'])
  await expect(who.nth(1).getByText('Concept · not built')).toBeVisible()
  await expect(page.getByText('Shown with the sample look')).toBeVisible()
  await page.screenshot({ path: info.outputPath('supporter-settings.png'), fullPage: true, animations: 'disabled' })

  // Trying a paint previews it, and saves nothing.
  await page.getByRole('group', { name: 'Paint' }).getByRole('radio', { name: 'Halo', exact: true }).check()
  await expect(who.first().locator('.pulse-paint').first()).toHaveAttribute('data-finish', 'halo')
  await expect(page.getByText('Shown with the look you’re trying')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Emote rain' }).getByRole('button')).toHaveCount(3)
  for (const button of await page.getByRole('group', { name: 'Emote rain' }).getByRole('button').all()) await expect(button).toBeDisabled()
  await expect(page.getByText(/signature emote/i)).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('supporter-settings-halo.png'), fullPage: true, animations: 'disabled' })
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: info.outputPath(`supporter-settings-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.reload()
  await expect(page.getByRole('group', { name: 'Paint' }).getByRole('radio', { name: 'Etched', exact: true })).toBeChecked()
  const after = await extension.serviceWorker.evaluate(() => chrome.storage.sync.get(null))
  expect(after).toEqual(before)
  await page.getByRole('link', { name: 'Privacy & Data', exact: true }).click()
  await expect(page).toHaveURL(/#privacy$/)
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Account & Supporter' })).toBeVisible()
})

/** Record what the page asks the browser to open, then open it as usual. */
async function recordOpenedTabs(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const original = chrome.tabs.create.bind(chrome.tabs)
    const opened: string[] = []
    ;(window as unknown as { __openedTabs: string[] }).__openedTabs = opened
    chrome.tabs.create = ((properties: chrome.tabs.CreateProperties) => { opened.push(String(properties.url)); return original(properties) }) as typeof chrome.tabs.create
  })
  return () => page.evaluate(() => (window as unknown as { __openedTabs: string[] }).__openedTabs)
}

test('account settings connect through the packaged worker and disconnect', async ({ extension, prepare }) => {
  await prepare()
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({ json: { pollingSecret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600000).toISOString() }, status: 201 }))
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links/poll', route => route.fulfill({ json: {
    state: 'approved', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: '11111111-1111-1111-1111-111111111111', deviceId: '22222222-2222-2222-2222-222222222222', expiresAt: new Date(Date.now() + 86400000).toISOString(), refreshExpiresAt: new Date(Date.now() + 172800000).toISOString(),
  } }))
  await extension.context.route('https://api.streampulse.stream/v1/account/devices/disconnect', route => route.fulfill({ status: 204 }))
  // Opening the website must never reach the real site from a fixture run.
  await extension.context.route('https://streampulse.stream/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>portal fixture</title>' }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const openedTabs = await recordOpenedTabs(page)
  const opened = extension.context.waitForEvent('page')
  await page.getByRole('button', { name: 'Use a StreamPulse website account', exact: true }).click()
  await opened
  // The worker's code reaches the website in the fragment only; no second click is needed.
  expect(await openedTabs()).toEqual(['https://streampulse.stream/account/link-device#code=ABCDE12345'])
  await expect(page.getByText('ABCDE-12345', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reopen streampulse.stream' })).toHaveAttribute('href', 'https://streampulse.stream/account/link-device#code=ABCDE12345')
  expect(await page.locator('body').innerText()).not.toContain('c'.repeat(64))
  await expect(page.getByText('This extension is connected to your Pulse account.', { exact: false })).toBeVisible({ timeout: 12000 })
  await expect(page.getByText('Connecting does not link your Twitch identity.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Disconnect extension' }).click()
  await expect(page.getByRole('button', { name: 'Become a Supporter', exact: true })).toBeVisible()
})

test('unmounted account backend produces a clear unavailable state', async ({ extension, prepare }) => {
  await prepare()
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({ status: 404 }))
  await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await extension.page.getByRole('button', { name: 'Become a Supporter', exact: true }).click()
  await expect(extension.page.getByText('Account linking is not available on the server yet. Your free tools still work.')).toBeVisible()
  await expect(extension.page.getByRole('link', { name: 'Reopen streampulse.stream' })).toHaveCount(0)
  // UI-11: linking that is not deployed is explained, not offered again.
  await expect(extension.page.getByRole('button', { name: 'Become a Supporter', exact: true })).toHaveCount(0)
})

test('a Supporter’s emote rain choice keeps keyboard focus through its save', async ({ extension, prepare }) => {
  await prepare()
  await linkDevice(extension.serviceWorker)
  await serveMembership(extension.context, () => supporterBody('active', 2))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const rain = page.getByRole('group', { name: 'Emote rain' })
  await expect(rain).toHaveAttribute('data-supporter-perks', 'on')
  const status = rain.getByRole('status')
  await expect(status).toHaveText('')
  // Hold each write long enough for Chromium to run its focus fixup, as a slow sync write would.
  await page.evaluate(() => {
    const original = chrome.storage.sync.set.bind(chrome.storage.sync)
    chrome.storage.sync.set = ((items: Record<string, unknown>) => new Promise(resolve => setTimeout(resolve, 400)).then(() => original(items))) as typeof chrome.storage.sync.set
  })
  const focused = () => page.evaluate(() => document.activeElement?.tagName === 'BUTTON' ? document.activeElement.textContent : document.activeElement?.tagName)
  for (const [name, previous] of [['Still', 'Off'], ['Rain', 'Still']] as const) {
    await rain.getByRole('button', { name: previous, exact: true }).focus()
    await page.keyboard.press('Tab')
    expect(await focused()).toBe(name)
    await page.keyboard.press('Space')
    // While it saves: nothing is disabled, focus stays put, and the old result is cleared.
    await expect(rain).toHaveAttribute('aria-busy', 'true')
    await expect(status).toHaveText('')
    // Read at once, not retried: a row disabled for the save is enabled again once it ends.
    expect(await rain.evaluate(group => group.querySelectorAll('button:disabled').length)).toBe(0)
    expect(await focused()).toBe(name)
    await expect(status).toHaveText('Emote rain saved.')
    await expect(rain.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await focused()).toBe(name)
  }
  const stored = await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('pulseBanner'))
  expect(stored).toMatchObject({ pulseBanner: { mode: 'rain' } })
})
