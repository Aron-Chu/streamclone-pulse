import { test, expect } from '../helpers/testFixtures.ts'
import type { Worker } from '@playwright/test'

/**
 * Packaged proof of Sign out everywhere in Account & Supporter
 * (POST /v1/account/sessions/revoke-all, backend #162).
 *
 * The build stage comes from PULSE_EXTENSION_TWITCH_SIGNIN at build time, so
 * each test runs only against the build it describes:
 *   - Twitch sign-in off (the default and every store build): not offered, and
 *     the worker refuses the message without a request.
 *   - `tester` or `public`: offered to a Twitch sign-in; a 404 is "not
 *     available yet" and keeps the sign-in; a 204 signs this extension out
 *     too, and silent sign-in stays off.
 * The Twitch check after `recent_auth_required` needs the Twitch window, so it
 * is covered by unit tests (tests/twitchSignIn.test.ts, supporterJourney).
 */
const STAGE = process.env.PULSE_EXTENSION_TWITCH_SIGNIN === 'tester' || process.env.PULSE_EXTENSION_TWITCH_SIGNIN === 'public'
  ? process.env.PULSE_EXTENSION_TWITCH_SIGNIN : 'off'
const API = 'https://api.streampulse.stream'
const REVOKE_ALL = `${API}/v1/account/sessions/revoke-all`
const LINKED_DEVICE = {
  token: 'a'.repeat(64),
  refreshToken: 'b'.repeat(64),
  accountId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
}

/** Seed a linked device into the worker's private store and read it back. */
async function linkDevice(serviceWorker: Worker) {
  const stored = await serviceWorker.evaluate(async record => {
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

async function hasCredential(serviceWorker: Worker): Promise<boolean> {
  return serviceWorker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pulse-account-private-v1', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('open failed'))
    })
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const request = db.transaction('account').objectStore('account').get('https://api.streampulse.stream')
        request.onsuccess = () => resolve(Boolean(request.result?.token || request.result?.refreshToken))
        request.onerror = () => reject(new Error('read failed'))
      })
    } finally { db.close() }
  })
}

function supporterBody(accountKind: 'twitch' | 'email') {
  return {
    schemaVersion: 1, accountId: LINKED_DEVICE.accountId, accountKind, environment: 'live', revision: 4, status: 'none', checkoutEnabled: false,
    serverTime: new Date().toISOString(), cacheUntil: new Date(Date.now() + 900_000).toISOString(), supportPeriods: 0,
    features: { 'supporter.banner.v1': false, 'supporter.finish.v1': false, 'supporter.recognition.v1': false, 'supporter.chat_badge.v1': false },
  }
}

test.describe('packaged Sign out everywhere', () => {
  test('is not offered with Twitch sign-in off, and the worker refuses it without a request', async ({ extension, prepare }) => {
    test.skip(STAGE !== 'off', 'describes the Twitch-off build')
    await prepare({ scenario: 'live-ready' })
    await linkDevice(extension.serviceWorker)
    const revokes: string[] = []
    await extension.context.route(REVOKE_ALL, route => { revokes.push(route.request().method()); return route.fulfill({ status: 204, body: '' }) })
    await extension.context.route(`${API}/v1/billing/supporter`, route => route.fulfill({ json: supporterBody('email') }))
    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out everywhere', exact: true })).toHaveCount(0)
    await expect(page.getByText('Sign out everywhere')).toHaveCount(0)
    const reply = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'TWITCH_SIGN_IN', action: 'sign_out_everywhere' }))
    expect(reply).toMatchObject({ type: 'TWITCH_SIGN_IN', everywhere: 'disabled' })
    expect(revokes).toEqual([])
    expect(await hasCredential(extension.serviceWorker)).toBe(true)
  })

  test('asks first, is honest while unavailable, then signs this extension out with silent sign-in kept off', async ({ extension, prepare }) => {
    test.skip(STAGE === 'off', 'needs a PULSE_EXTENSION_TWITCH_SIGNIN=tester or public build')
    await prepare({ scenario: 'live-ready' })
    await linkDevice(extension.serviceWorker)
    const answers = [404, 204]
    const revokes: Array<{ authorization?: string; body: unknown }> = []
    const twitchStarts: string[] = []
    await extension.context.route(REVOKE_ALL, route => {
      revokes.push({ authorization: route.request().headers().authorization, body: route.request().postDataJSON() })
      const status = answers.length > 1 ? answers.shift()! : answers[0]!
      return status === 204 ? route.fulfill({ status: 204, body: '' }) : route.fulfill({ status, json: { error: 'not_found' } })
    })
    await extension.context.route(`${API}/v1/account/auth/twitch/**`, route => { twitchStarts.push(route.request().url()); return route.fulfill({ status: 500, json: {} }) })
    await extension.context.route(`${API}/v1/billing/supporter`, route => route.request().headers().authorization
      ? route.fulfill({ json: supporterBody('twitch') })
      : route.fulfill({ status: 401, json: { error: 'sign_in_required' } }))
    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    const everywhere = page.getByRole('button', { name: 'Sign out everywhere', exact: true })
    await expect(everywhere).toBeVisible()
    await everywhere.click()
    const ask = page.locator('[data-sign-out-everywhere="ask"]')
    await expect(ask).toContainText('Nothing is deleted from your account, and it does not cancel your subscription.')
    expect(revokes).toEqual([])
    await page.screenshot({ path: test.info().outputPath('sign-out-everywhere-ask.png'), fullPage: true })

    await ask.getByRole('button', { name: 'Confirm sign out everywhere', exact: true }).click()
    const notice = page.locator('[data-account-notice]')
    await expect(notice).toHaveText('Sign out everywhere isn’t available yet. Nothing was signed out. Sign out here still ends this extension’s access.')
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
    expect(await hasCredential(extension.serviceWorker)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('sign-out-everywhere-not-available.png'), fullPage: true })

    await everywhere.click()
    await page.locator('[data-sign-out-everywhere="ask"]').getByRole('button', { name: 'Confirm sign out everywhere', exact: true }).click()
    await expect(notice).toContainText('You’re signed out everywhere.')
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continue with Twitch', exact: true })).toBeVisible()
    await expect(page.getByText('You were signed out on this browser', { exact: false })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('sign-out-everywhere-done.png'), fullPage: true })

    expect(revokes).toEqual([
      { authorization: `Bearer ${LINKED_DEVICE.token}`, body: {} },
      { authorization: `Bearer ${LINKED_DEVICE.token}`, body: {} },
    ])
    expect(await hasCredential(extension.serviceWorker)).toBe(false)
    const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'TWITCH_SIGN_IN', action: 'status' }))
    expect(status).toMatchObject({ account: { state: 'signed_out' }, status: { silentEligible: false, profile: null } })
    // Silent sign-in stays blocked: it answers without any Twitch request.
    const silent = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'TWITCH_SIGN_IN', action: 'sign_in', mode: 'silent' }))
    expect(silent).toMatchObject({ outcome: 'interaction_required', account: { state: 'signed_out' } })
    expect(twitchStarts).toEqual([])
  })
})
