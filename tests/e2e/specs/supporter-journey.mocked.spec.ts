import { test, expect } from '../helpers/testFixtures.ts'
import type { CDPSession } from '@playwright/test'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * The invited-tester Supporter journey with Twitch sign-in off (stage A),
 * packaged, with fixture APIs only: Connect this extension from the closed
 * tester disclosure → (website sign-in + one approval, simulated by the poll
 * fixture) → Continue to checkout on the website → delayed payment
 * confirmation → membership and a pre-chosen finish reach settings and an
 * already-open Twitch tab without any reload, then a remote revocation removes
 * the finish from that tab, again without reload. A signed-out page offers no
 * purchase of its own.
 *
 * Nothing here talks to Stripe or the real website; the portal half of the
 * journey has its own browser spec in streampulse-web.
 */

const ACCOUNT_ID = '11111111-1111-4111-8111-1111111a1b2c'
const APPROVED = {
  state: 'approved', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: ACCOUNT_ID,
  deviceId: '22222222-2222-4222-8222-222222222222',
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
}

interface DomNode { nodeId: number; nodeName: string; attributes?: string[]; children?: DomNode[]; shadowRoots?: DomNode[] }
const attribute = (node: DomNode, name: string) => { const index = node.attributes?.indexOf(name) ?? -1; return index < 0 ? undefined : node.attributes?.[index + 1] }
function findNode(node: DomNode, predicate: (value: DomNode) => boolean): DomNode | undefined {
  if (predicate(node)) return node
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const found = findNode(child, predicate)
    if (found) return found
  }
}
// Store builds keep their shadow root closed; inspect without changing that boundary.
async function bannerFinish(cdp: CDPSession): Promise<string | null | undefined> {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const host = findNode(root, node => attribute(node, 'id') === 'streamclone-pulse-root')
  const banner = host && findNode(host, node => node.nodeName === 'HEADER' && (attribute(node, 'class') ?? '').split(/\s+/).includes('pulse-personal-banner'))
  return banner ? attribute(banner, 'data-supporter-finish') ?? null : undefined
}

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

test('tester purchase journey needs no codes, refreshes or reloads, and revocation reaches an open Twitch tab', async ({ extension, prepare }, info) => {
  test.setTimeout(150_000)
  await prepare({ scenario: 'live-ready' })
  const context = extension.context
  const website: string[] = []
  await context.route('https://streampulse.stream/**', route => {
    if (route.request().resourceType() === 'document') website.push(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>portal fixture</title>' })
  })
  let approved = false
  let status: 'none' | 'pending' | 'active' = 'none'
  let revoked = false
  let cosmetics = { enabled: false, finish: 'glass' }
  const cosmeticWrites: unknown[] = []
  const checkoutWrites: string[] = []
  await context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({ status: 201, json: { pollingSecret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600_000).toISOString(), intervalSeconds: 5 } }))
  await context.route('https://api.streampulse.stream/v1/account/device-links/poll', route => route.fulfill({ json: approved ? APPROVED : { state: 'pending' } }))
  await context.route('https://api.streampulse.stream/v1/billing/supporter', route => {
    if (revoked) return route.fulfill({ status: 401, json: { error: 'sign_in_required' } })
    const paid = status === 'active'
    return route.fulfill({ json: {
      schemaVersion: 1, accountId: ACCOUNT_ID, environment: 'live', revision: 4, status, checkoutEnabled: true,
      serverTime: new Date().toISOString(), accessFrom: new Date(Date.now() - 60_000).toISOString(),
      accessUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(), cacheUntil: new Date(Date.now() + 900_000).toISOString(),
      supportPeriods: paid ? 1 : 0,
      features: { 'supporter.banner.v1': paid, 'supporter.finish.v1': paid, 'supporter.recognition.v1': paid, 'supporter.chat_badge.v1': false },
      cosmetics,
    } })
  })
  await context.route('https://api.streampulse.stream/v1/billing/cosmetics', route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${APPROVED.token}`)
    cosmetics = route.request().postDataJSON()
    cosmeticWrites.push(cosmetics)
    return route.fulfill({ json: cosmetics })
  })
  for (const path of ['checkout', 'portal']) {
    await context.route(`https://api.streampulse.stream/v1/billing/${path}`, route => { checkoutWrites.push(path); return route.fulfill({ status: 500, json: {} }) })
  }

  const settings = extension.page
  await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  // An already-open Twitch tab, so the outcome must arrive without a reload.
  const twitch = await context.newPage()
  const cdp = await context.newCDPSession(twitch)
  await openTwitchChannel(twitch)
  await expect.poll(() => bannerFinish(cdp)).toBe(null)
  await settings.bringToFront()

  // Optional explicit finish choice before purchase: a preview, nothing equipped.
  await settings.getByRole('group', { name: 'Paint' }).getByRole('radio', { name: 'Halo', exact: true }).check()
  await settings.getByRole('button', { name: 'Save for when Supporter opens', exact: true }).click()
  await expect(settings.locator('[data-supporter-finish-intent="halo"]')).toBeVisible()
  expect(cosmeticWrites).toEqual([])

  // Signed out, the page sells nothing; an invited tester connects from the closed disclosure.
  await expect(settings.getByRole('button', { name: 'Become a Supporter', exact: true })).toHaveCount(0)
  const openedTabs = await recordOpenedTabs(settings)
  const opened = context.waitForEvent('page')
  await settings.getByText('Invited tester? Connect this extension', { exact: true }).click()
  await settings.getByRole('button', { name: 'Connect this extension', exact: true }).click()
  const portal = await opened
  expect(await openedTabs()).toEqual(['https://streampulse.stream/account/link-device#code=ABCDE12345'])
  await expect(settings.locator('[data-journey-state="link-pending"]')).toBeVisible()
  await settings.screenshot({ path: info.outputPath('journey-1-link-pending.png'), fullPage: true, animations: 'disabled' })

  // The user signs in and approves on the website; the settings page finishes
  // connecting by itself, then offers the website checkout.
  approved = true
  await portal.bringToFront()
  await expect(settings.locator('[data-journey-state="offer"]')).toBeVisible({ timeout: 20_000 })
  await expect(settings.getByText('··1a1b2c', { exact: true })).toBeVisible()
  await settings.bringToFront()
  const checkout = context.waitForEvent('page')
  await settings.locator('a[data-supporter-action="billing"]').click()
  await checkout
  await expect(settings.locator('[data-journey-state="purchase-continuing"]')).toBeVisible()

  // Stripe's webhook is delayed: pending, then active. No refresh button is pressed.
  status = 'pending'
  await expect(settings.locator('[data-journey-state="payment-pending"]')).toBeVisible({ timeout: 20_000 })
  await expect(settings.getByText('you do not need to pay again', { exact: false })).toBeVisible()
  await settings.screenshot({ path: info.outputPath('journey-2-payment-pending.png'), fullPage: true, animations: 'disabled' })
  status = 'active'
  await expect(settings.locator('[data-journey-state="active"]')).toBeVisible({ timeout: 30_000 })
  await expect(settings.getByText('You are a Supporter', { exact: true })).toBeVisible()

  // The worker applied the explicit choice once access was verified.
  await expect.poll(() => cosmeticWrites).toEqual([{ enabled: true, finish: 'halo' }])
  await expect(settings.getByText('Halo active', { exact: true })).toBeVisible()
  await settings.screenshot({ path: info.outputPath('journey-3-active.png'), fullPage: true, animations: 'disabled' })
  // …and the open Twitch tab shows it without a reload.
  await twitch.bringToFront()
  await expect.poll(() => bannerFinish(cdp), { timeout: 20_000 }).toBe('halo')
  await twitch.screenshot({ path: info.outputPath('journey-4-twitch-halo.png'), animations: 'disabled' })

  // Remote revocation: noticed on the next read, removed from the open tab.
  revoked = true
  await settings.bringToFront()
  await settings.waitForTimeout(5_200)
  await settings.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(settings.getByText('was disconnected from your StreamPulse account', { exact: false })).toBeVisible({ timeout: 15_000 })
  await twitch.bringToFront()
  await expect.poll(() => bannerFinish(cdp), { timeout: 20_000 }).toBe(null)

  // The extension never created a checkout or portal session itself, and the
  // fixture run never reached the real website: the opened tab is either
  // stubbed by the route or, when it navigates before routing attaches,
  // refused by the harness resolver rule (see extensionContext.ts).
  expect(checkoutWrites).toEqual([])
  expect(website.every(url => url === 'https://streampulse.stream/account/link-device' || url === 'https://streampulse.stream/account/billing')).toBe(true)
  expect(await portal.title()).not.toMatch(/Twitch reaction analytics/)
  expect(await settings.locator('body').innerText()).not.toContain('c'.repeat(64))
  await cdp.detach()
})
