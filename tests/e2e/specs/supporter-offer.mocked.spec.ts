import { test, expect } from '../helpers/testFixtures.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CDPSession } from '@playwright/test'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * Packaged proof of the Supporter surface, plus captures of each state.
 *
 * The extension reads entitlement with an installation bearer credential and
 * never creates a Checkout session: `credentials: 'omit'` means it cannot hold
 * the browser session that billing mutations require. These tests assert the
 * page links out for purchase rather than attempting it.
 */
const CAPTURE_DIR = join('test-results', 'supporter-offer')

interface DomNode {
  nodeId: number
  nodeName: string
  attributes?: string[]
  children?: DomNode[]
  shadowRoots?: DomNode[]
}

function attribute(node: DomNode, name: string): string | undefined {
  const index = node.attributes?.indexOf(name) ?? -1
  return index < 0 ? undefined : node.attributes?.[index + 1]
}

function findNode(node: DomNode, predicate: (value: DomNode) => boolean): DomNode | undefined {
  if (predicate(node)) return node
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const found = findNode(child, predicate)
    if (found) return found
  }
}

// Store builds keep their shadow root closed. Inspect without changing that boundary.
async function expectBannerFinish(cdp: CDPSession, finish: string | null): Promise<void> {
  await expect.poll(async () => {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const host = findNode(root, node => attribute(node, 'id') === 'streamclone-pulse-root')
    const banner = host && findNode(host, node =>
      node.nodeName === 'HEADER' && (attribute(node, 'class') ?? '').split(/\s+/).includes('pulse-personal-banner'))
    if (!banner) return { visible: false, finish: null }
    try {
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: banner.nodeId })
      return { visible: model.width > 0 && model.height > 0, finish: attribute(banner, 'data-supporter-finish') ?? null }
    } catch {
      return { visible: false, finish: null }
    }
  }).toEqual({ visible: true, finish })
}

const LINKED_DEVICE = {
  token: 'a'.repeat(64),
  refreshToken: 'b'.repeat(64),
  accountId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
}

/**
 * Seed a linked account into the worker's private IndexedDB, then read it back.
 * Verifying the round trip matters: a silently failed seed would leave the
 * worker unlinked and every assertion below would pass for the wrong reason.
 */
async function linkDevice(extension: { serviceWorker: import('@playwright/test').Worker }) {
  const stored = await extension.serviceWorker.evaluate(async record => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('pulse-account-private-v1', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('account')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(new Error('open failed'))
    })
    const key = 'https://api.streampulse.stream'
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('account', 'readwrite')
      tx.objectStore('account').put({ kind: 'linked', ...record }, key)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(new Error('seed failed'))
    })
    const readBack = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('account', 'readonly')
      const request = tx.objectStore('account').get(key)
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = tx.onabort = () => reject(new Error('read failed'))
    })
    db.close()
    return (readBack as { kind?: string } | undefined)?.kind ?? 'missing'
  }, LINKED_DEVICE)
  expect(stored, 'linked credential was not seeded into the worker').toBe('linked')
}

function supporterBody(status: string, supportPeriods: number) {
  return {
    schemaVersion: 1,
    accountId: LINKED_DEVICE.accountId,
    environment: 'live',
    revision: 4,
    status,
    serverTime: new Date().toISOString(),
    accessFrom: new Date(Date.now() - 86_400_000).toISOString(),
    accessUntil: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    cacheUntil: new Date(Date.now() + 900_000).toISOString(),
    supportPeriods,
    features: {
      'supporter.banner.v1': status === 'active' || status === 'grace',
      'supporter.finish.v1': status === 'active' || status === 'grace',
      'supporter.recognition.v1': supportPeriods > 0,
      'supporter.chat_badge.v1': false,
    },
  }
}

test.describe('packaged supporter offer', () => {
  test('equips all finishes, persists, resets and removes expired access', async ({ extension, prepare }) => {
    mkdirSync(CAPTURE_DIR, { recursive: true })
    await prepare({ scenario: 'live-ready' })
    await linkDevice(extension)
    let cosmetics = { enabled: false, finish: 'glass' }
    let status = 'active'
    await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: { ...supporterBody(status, 2), cosmetics } }))
    await extension.context.route('https://api.streampulse.stream/v1/billing/cosmetics', route => {
      expect(route.request().headers().authorization).toBe(`Bearer ${LINKED_DEVICE.token}`)
      cosmetics = route.request().postDataJSON()
      return route.fulfill({ json: cosmetics })
    })
    const settings = extension.page
    await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    const twitch = await extension.context.newPage()
    const cdp = await extension.context.newCDPSession(twitch)
    for (const finish of ['glass', 'etched', 'halo']) {
      await settings.getByRole('group', { name: 'Accent finish' }).getByRole('radio', { name: new RegExp(finish, 'i') }).check()
      await settings.getByRole('button', { name: 'Equip accent', exact: true }).click()
      await expect(settings.getByText(new RegExp(`${finish} accent equipped\\.`, 'i'))).toBeVisible()
      await openTwitchChannel(twitch)
      await expectBannerFinish(cdp, finish)
      await twitch.screenshot({ path: join(CAPTURE_DIR, `accent-${finish}.png`), animations: 'disabled' })
    }
    await settings.reload()
    await expect(settings.getByRole('group', { name: 'Accent finish' }).getByRole('radio', { name: 'Halo', exact: true })).toBeChecked()
    await settings.getByRole('group', { name: 'Accent finish' }).getByRole('radio', { name: 'Default', exact: true }).check()
    await settings.getByRole('button', { name: 'Use default', exact: true }).click()
    await expect(settings.getByText('Default accent restored.', { exact: true })).toBeVisible()
    await twitch.reload()
    await expectBannerFinish(cdp, null)
    await settings.getByRole('group', { name: 'Accent finish' }).getByRole('radio', { name: 'Halo', exact: true }).check()
    await settings.getByRole('button', { name: 'Equip accent', exact: true }).click()
    await expect(settings.getByText('Halo accent equipped.', { exact: true })).toBeVisible()
    status = 'expired'
    await settings.reload()
    await expect(settings.getByRole('button', { name: 'Default active', exact: true })).toBeDisabled()
    await twitch.reload()
    await expectBannerFinish(cdp, null)
    expect(cosmetics).toEqual({ enabled: true, finish: 'halo' })
    await cdp.detach()
    await twitch.close()
  })

  for (const [status, periods] of [['none', 0], ['active', 3], ['grace', 2], ['expired', 1], ['pending', 0], ['review', 1]] as const) {
    test(`renders the ${status} state and captures it`, async ({ extension, prepare }) => {
      mkdirSync(CAPTURE_DIR, { recursive: true })
      await prepare({ scenario: 'live-ready' })
      await linkDevice(extension)

      let sawBearer = ''
      await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => {
        sawBearer = route.request().headers().authorization ?? ''
        route.fulfill({ json: supporterBody(status, periods), status: 200 })
      })

      const page = extension.page
      await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
      const card = page.locator('[data-settings-section="supporter"], .pulse-supporter-settings').first()
      await expect(card).toBeVisible()

      // The worker must authenticate with the installation bearer, not a cookie.
      await expect.poll(() => sawBearer).toContain('Bearer ')
      expect(sawBearer).not.toContain('pulse_account=')

      const action = page.locator('a[data-supporter-action="billing"]')
      if (status === 'active' || status === 'grace') {
        await expect(action).toHaveText(/Manage your membership/)
        await expect(page.getByText('US$4.99 / month')).toHaveCount(0)
      } else if (status === 'none') {
        await expect(action).toHaveText(/Become a Supporter/)
        await expect(page.getByText('US$4.99 / month')).toBeVisible()
      } else {
        const label = status === 'pending' ? 'Check payment status on streampulse.stream'
          : status === 'review' ? 'Review membership on streampulse.stream'
            : 'Review your membership on streampulse.stream'
        await expect(action).toHaveText(label)
        if (status === 'expired') await expect(page.getByText('US$4.99 / month')).toBeVisible()
        else await expect(page.getByText('US$4.99 / month')).toHaveCount(0)
      }
      await expect(action).toHaveAttribute('href', `https://streampulse.stream${status === 'none' ? '/supporter' : '/account/billing'}`)
      for (const policy of ['/privacy', '/terms', '/refunds']) {
        await expect(page.locator(`a[href="https://streampulse.stream${policy}"]`).first()).toBeVisible()
      }

      // The unreleased chat badge must never read as included, and the caveat
      // is stated exactly once so the page cannot contradict itself.
      await expect(page.getByText('Not included yet')).toHaveCount(1)
      await expect(page.getByText(/chat badge/i).first()).toBeVisible()

      await page.screenshot({
        path: join(CAPTURE_DIR, `supporter-${status}.png`),
        animations: 'disabled',
        fullPage: true,
      })
    })
  }

  test('an unreachable billing service degrades honestly', async ({ extension, prepare }) => {
    mkdirSync(CAPTURE_DIR, { recursive: true })
    await prepare({ scenario: 'live-ready' })
    await linkDevice(extension)
    await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route =>
      route.fulfill({ status: 503, json: { error: 'billing_unavailable' } }))

    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    // An outage is not a missing deployment; say which one it is.
    await expect(page.getByText('temporarily unavailable')).toBeVisible()
    await expect(page.getByText('not available on the server yet')).toHaveCount(0)
    await expect(page.getByText('free tools are unaffected')).toBeVisible()
    // Never claim membership when the server could not answer.
    await expect(page.getByText('Supporter active')).toHaveCount(0)
    // An unknown status is not an offer (UI-1): no purchase or billing link, only a re-read.
    await expect(page.locator('a[data-supporter-action="billing"]')).toHaveCount(0)
    await expect(page.getByText('Become a Supporter')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible()
    await page.screenshot({
      path: join(CAPTURE_DIR, 'supporter-unavailable.png'),
      animations: 'disabled',
      fullPage: true,
    })
  })

  test('a billing service that is not deployed offers no purchase link', async ({ extension, prepare }) => {
    await prepare({ scenario: 'live-ready' })
    await linkDevice(extension)
    await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route =>
      route.fulfill({ status: 404, json: { error: 'not_found' } }))

    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await expect(page.getByText('Supporter is not available on the server yet.', { exact: false })).toBeVisible()
    await expect(page.locator('a[data-supporter-action="billing"]')).toHaveCount(0)
    await expect(page.getByText('Become a Supporter')).toHaveCount(0)
    await expect(page.getByText('US$4.99 / month')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible()
  })

  test('an unlinked install offers no purchase link', async ({ extension, prepare }) => {
    await prepare({ scenario: 'live-ready' })
    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await expect(page.getByText('Connect this extension to your Pulse account above to see Supporter status.', { exact: true })).toBeVisible()
    await expect(page.locator('a[data-supporter-action="billing"]')).toHaveCount(0)
    await expect(page.getByText('Become a Supporter')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Link extension', exact: true })).toBeVisible()
  })

  test('a remotely revoked device clears the connection and can link again', async ({ extension, prepare }) => {
    await prepare({ scenario: 'live-ready' })
    await linkDevice(extension)
    let revoked = false
    let entitlementRequests = 0
    await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => {
      entitlementRequests++
      expect(route.request().headers().authorization).toBe(`Bearer ${LINKED_DEVICE.token}`)
      return revoked
        ? route.fulfill({ status: 401, json: { error: 'unauthorized' } })
        : route.fulfill({ json: supporterBody('active', 3) })
    })
    await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({
      status: 201,
      json: { pollingSecret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600_000).toISOString(), intervalSeconds: 5 },
    }))
    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await expect(page.getByText('Supporter active', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Disconnect extension', exact: true })).toBeVisible()

    revoked = true
    const requestsBeforeRevocation = entitlementRequests
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Link extension', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Disconnect extension', exact: true })).toHaveCount(0)
    await expect(page.getByText('Supporter active', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Connect this extension to your Pulse account above to see Supporter status.', { exact: true })).toBeVisible()
    expect(entitlementRequests).toBeGreaterThan(requestsBeforeRevocation)

    const hasCredential = await extension.serviceWorker.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('pulse-account-private-v1', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error('open failed'))
      })
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const request = db.transaction('account').objectStore('account').get('https://api.streampulse.stream')
          request.onsuccess = () => resolve(request.result != null)
          request.onerror = () => reject(new Error('read failed'))
        })
      } finally { db.close() }
    })
    expect(hasCredential).toBe(false)
    const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'status' }))
    expect(status).toEqual({ type: 'SUPPORTER_ACCOUNT', account: { state: 'signed_out' } })

    await page.getByRole('button', { name: 'Link extension', exact: true }).click()
    await expect(page.getByText('ABCDE-12345', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open account page', exact: true }))
      .toHaveAttribute('href', 'https://streampulse.stream/account/link-device')
  })

  test('the page never creates a checkout session itself', async ({ extension, prepare }) => {
    await prepare({ scenario: 'live-ready' })
    await linkDevice(extension)
    const blocked: string[] = []
    for (const path of ['checkout', 'portal']) {
      await extension.context.route(`https://api.streampulse.stream/v1/billing/${path}`, route => {
        blocked.push(path)
        route.fulfill({ status: 500, json: {} })
      })
    }
    await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route =>
      route.fulfill({ json: supporterBody('none', 0), status: 200 }))

    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await expect(page.locator('a[data-supporter-action="billing"]')).toHaveText(/Become a Supporter/)
    // Purchase is a link out, so no mutation endpoint may be called from here.
    expect(blocked).toEqual([])
  })
})
