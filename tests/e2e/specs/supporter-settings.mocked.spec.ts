import type { Locator } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { linkDevice, serveMembership, supporterBody } from '../helpers/supporterMembership.ts'

const WIDE_EMOTE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="106" height="32" viewBox="0 0 106 32"><rect width="106" height="32" rx="6" fill="#9146ff"/></svg>'

test('packaged supporter settings stay local, accessible and responsive', async ({ extension, prepare }, info) => {
  await prepare()
  const page = extension.page
  // Serve every 7TV emote locally at the widest real shape (wide emotes run about 3.1-3.3:1), so the
  // overflow checks below see loaded images on every run instead of depending on live CDN timing.
  await extension.context.route('https://cdn.7tv.app/emote/**', route => route.fulfill({ contentType: 'image/svg+xml', body: WIDE_EMOTE_SVG }))
  const before = await extension.serviceWorker.evaluate(() => chrome.storage.sync.get(null))
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await expect(page.getByRole('heading', { name: 'Account & Supporter' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Account & Supporter' })).toHaveAttribute('aria-current', 'page')

  // Your card: the identity that exists (nobody, with Twitch sign-in off), the sample look, and the crest ladder.
  const card = page.getByRole('region', { name: 'Your Supporter card' })
  // Heading navigation stops at the card (its h3 is visually hidden), between the page's h2 and "Who sees what".
  await expect(card.getByRole('heading', { level: 3, name: 'Your Supporter card', exact: true })).toHaveCount(1)
  await expect(page.locator('.pulse-supporter-settings').getByRole('heading')).toHaveText(['Account & Supporter', 'Your Supporter card', 'Who sees what', 'Your look', 'Account'])
  await expect(card.locator('.pulse-supporter-card-who strong')).toHaveText('Not signed in')
  await expect(card.getByText('Sample look', { exact: true })).toBeVisible()
  // The card names nobody: no Twitch name or picture while Twitch sign-in is off.
  await expect(card.locator('.pulse-supporter-card-who')).not.toContainText('Twitch')
  const ladder = card.getByRole('list', { name: 'Crest ladder' })
  await expect(ladder.getByRole('listitem')).toHaveText(['New', '3 mo', '6 mo', '1 year', '2 years'])
  // The real crest art, from the stylesheet, at ladder size.
  await expect(ladder.locator('.pulse-crest').first()).toHaveCSS('width', '22px')
  await expect(ladder.locator('.pulse-crest[data-tenure="24m"]')).toHaveCSS('background-image', /^url\("data:image\/svg\+xml/)
  // Emote rain across the card's top, on the card itself: no gradient layer.
  const top = card.locator('.pulse-supporter-card-banner')
  await expect(top).toHaveCSS('background-image', 'none')
  await expect(top.locator('.pulse-banner-art')).toHaveAttribute('data-mode', 'rain')
  await expect(card.locator('.pulse-journey')).toHaveAttribute('data-journey-state', 'signed-out')
  // Sign-ups are not open: the one action describes Supporter, it does not sell it.
  const primary = card.locator('.pulse-journey-primary')
  await expect(primary).toHaveText(['Supporter details'])
  await expect(card.locator('.pulse-journey')).toContainText('Supporter sign-ups are not open yet')
  await expect(page.getByRole('button', { name: /Become a Supporter|Restore my Supporter|Use a StreamPulse website account/ })).toHaveCount(0)
  // The price and that it renews come before the primary action, in reading and Tab order.
  const terms = card.locator('.pulse-supporter-terms')
  await expect(terms).toContainText('US$4.99 / month')
  await expect(terms).toContainText('renews monthly until you cancel')
  expect(await primary.evaluate(button => {
    const price = button.closest('.pulse-journey')?.querySelector('.pulse-supporter-terms')
    return price ? Boolean(price.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) : null
  })).toBe(true)

  // Who sees what: every perk is yours only, and normal chat for everyone else.
  const who = page.locator('.pulse-supporter-who > li')
  await expect(who.locator('strong')).toHaveText(['You', 'Everyone else on Twitch'])
  await expect(who.first().locator('[data-supporter-perk-names="true"]')).toHaveText('Title paint · Tenure crest · Emote rain · Supporter card')
  await expect(page.getByText('Concept · not built')).toHaveCount(0)
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
  for (const width of [320, 360, 390, 480, 768]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    // No Your look choice may spill its label past its own border, even where the page does not scroll.
    expect(await page.locator('.pulse-supporter-look-row :is(label, button)').evaluateAll(choices => choices.filter(choice => choice.scrollWidth > choice.clientWidth + 1).map(choice => choice.textContent))).toEqual([])
    if (width < 768) {
      // Narrow, the action wraps below its column: the price sits above it, never under it.
      // Where a short action fits beside the column, the price sits to its left.
      const [price, button] = await Promise.all([terms.boundingBox(), primary.boundingBox()])
      expect(price!.y + price!.height <= button!.y || price!.x + price!.width <= button!.x, `price before the primary action at ${width}px`).toBe(true)
    }
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

test('Your look tiles work from the keyboard and show where focus is', async ({ extension, prepare }) => {
  await prepare()
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  // Each tile's radio is a 1px transparent input: the tile's focus-within outline is the only focus indicator.
  const tile = (radio: Locator) => radio.locator('xpath=ancestor::label[contains(concat(" ", @class, " "), " pulse-supporter-tile ")][1]')
  const you = page.locator('.pulse-supporter-who > li').first()
  const paint = page.getByRole('group', { name: 'Paint' })
  const wave = page.getByRole('group', { name: 'Wave' })
  const sheen = page.getByRole('group', { name: 'Sheen' })
  const etched = paint.getByRole('radio', { name: 'Etched', exact: true })
  const smooth = wave.getByRole('radio', { name: 'Smooth wave', exact: true })
  await expect(etched).toBeChecked()
  await expect(smooth).toBeChecked()
  await expect(tile(etched)).toHaveCSS('outline-style', 'none')

  // Shift+Tab from Wave reaches the checked Paint tile: the hidden inputs stay in the tab order.
  await smooth.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(etched).toBeFocused()
  await expect(tile(etched)).toHaveCSS('outline-style', 'solid')
  // An arrow key moves the choice to the next tile, the outline follows it, and Who sees what previews it.
  await page.keyboard.press('ArrowRight')
  const halo = paint.getByRole('radio', { name: 'Halo', exact: true })
  await expect(halo).toBeChecked()
  await expect(halo).toBeFocused()
  await expect(tile(halo)).toHaveCSS('outline-style', 'solid')
  await expect(tile(etched)).toHaveCSS('outline-style', 'none')
  await expect(you.locator('.pulse-paint').first()).toHaveAttribute('data-finish', 'halo')
  await expect(page.getByText('Shown with the look you’re trying')).toBeVisible()

  // Tab goes on to the checked Wave tile, then the checked Sheen tile.
  await page.keyboard.press('Tab')
  await expect(smooth).toBeFocused()
  await expect(tile(smooth)).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Tab')
  const sweep = sheen.getByRole('radio', { name: 'Sweep sheen', exact: true })
  await expect(sweep).toBeChecked()
  await expect(sweep).toBeFocused()
  await expect(tile(sweep)).toHaveCSS('outline-style', 'solid')
  await expect(you.locator('.pulse-supporter-chat-line .pulse-paint')).toHaveAttribute('data-sheen', 'sweep')
  await page.keyboard.press('ArrowRight')
  const glint = sheen.getByRole('radio', { name: 'Glint sheen', exact: true })
  await expect(glint).toBeChecked()
  await expect(glint).toBeFocused()
  await expect(tile(glint)).toHaveCSS('outline-style', 'solid')
  await expect(tile(sweep)).toHaveCSS('outline-style', 'none')
  await expect(you.locator('.pulse-supporter-chat-line .pulse-paint')).toHaveAttribute('data-sheen', 'glint')
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
  // Invited testers only: the device link sits behind a closed disclosure.
  await page.getByText('Invited tester? Connect this extension', { exact: true }).click()
  await page.getByRole('button', { name: 'Connect this extension', exact: true }).click()
  await opened
  // The worker's code reaches the website in the fragment only; no second click is needed.
  expect(await openedTabs()).toEqual(['https://streampulse.stream/account/link-device#code=ABCDE12345'])
  await expect(page.getByText('ABCDE-12345', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reopen streampulse.stream' })).toHaveAttribute('href', 'https://streampulse.stream/account/link-device#code=ABCDE12345')
  expect(await page.locator('body').innerText()).not.toContain('c'.repeat(64))
  await expect(page.locator('[data-row="account"]')).toContainText('Connected to this extension', { timeout: 12000 })
  await expect(page.getByText('An invited tester’s StreamPulse account.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm sign out', exact: true }).click()
  await expect(page.locator('[data-journey-state="signed-out"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Become a Supporter', exact: true })).toHaveCount(0)
})

test('unmounted account backend produces a clear unavailable state', async ({ extension, prepare }) => {
  await prepare()
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({ status: 404 }))
  await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await extension.page.getByText('Invited tester? Connect this extension', { exact: true }).click()
  await extension.page.getByRole('button', { name: 'Connect this extension', exact: true }).click()
  await expect(extension.page.getByText('Account sign-in is not available on the server yet. Your free tools still work.')).toBeVisible()
  await expect(extension.page.getByRole('link', { name: 'Reopen streampulse.stream' })).toHaveCount(0)
  // UI-11: linking that is not deployed is explained, not offered again.
  await expect(extension.page.getByRole('button', { name: 'Connect this extension', exact: true })).toHaveCount(0)
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

test('the Account card’s Manage subscription keeps keyboard focus while it opens and reports a failure in the Account card', async ({ extension, prepare }) => {
  await prepare()
  await linkDevice(extension.serviceWorker)
  await serveMembership(extension.context, () => ({ ...supporterBody('active', 2), accountKind: 'installation', installationAccountsEnabled: true, restoreEligible: false }))
  let portals = 0
  await extension.context.route('https://api.streampulse.stream/v1/billing/portal', async route => {
    portals++
    // Long enough for Chromium's focus fixup to run, as a slow portal request would.
    await new Promise(resolve => setTimeout(resolve, 1_000))
    await route.fulfill({ status: 503, json: { error: 'unavailable' } })
  })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const account = page.locator('section').filter({ has: page.getByRole('heading', { level: 3, name: 'Account', exact: true }) })
  // The footer has its own Manage subscription; this is the one in the Account card's billing row.
  const manage = account.locator('[data-row="billing"]').getByRole('button', { name: 'Manage subscription', exact: true })
  const status = account.locator('[data-account-notice]')
  await expect(status).toHaveText('')
  await manage.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => portals).toBe(1)
  // While it opens: enabled, still focused, and busy. Read at once, not retried:
  // a button disabled for the request is enabled again once it ends.
  expect(await manage.isEnabled()).toBe(true)
  expect(await manage.evaluate(button => button === document.activeElement)).toBe(true)
  await expect(manage).toHaveAttribute('aria-busy', 'true')
  // A second press while it opens asks nothing more.
  await page.keyboard.press('Enter')
  await expect(status).toContainText('Could not open subscription management')
  await expect(manage).not.toHaveAttribute('aria-busy', 'true')
  await expect(manage).toBeFocused()
  expect(portals).toBe(1)
  // Reported beside the button, not in the card footer a screen above.
  await expect(page.locator('.pulse-journey-status')).not.toContainText('Could not open subscription management')
})
