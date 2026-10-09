import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * Twitch tabs share the worker's Supporter read: every visible tab's
 * appearance check (about once a minute, plus every mount) used to make its
 * own GET /v1/billing/supporter. Now they are served from one read while it is
 * fresh, and a settings read stays fresh.
 */
const API = 'https://api.streampulse.stream'
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const LINKED = {
  kind: 'linked', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: ACCOUNT_ID, deviceId: '22222222-2222-4222-8222-222222222222',
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
}

test('Twitch tabs share one Supporter read; settings still reads fresh', async ({ extension, prepare }) => {
  await prepare({ scenario: 'live-ready' })
  await extension.serviceWorker.evaluate(async record => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('pulse-account-private-v1', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('account')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(new Error('open failed'))
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('account', 'readwrite')
      tx.objectStore('account').put(record, 'https://api.streampulse.stream')
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(new Error('seed failed'))
    })
    db.close()
  }, LINKED)
  let reads = 0
  await extension.context.route(`${API}/v1/billing/supporter`, route => {
    reads++
    const serverTime = new Date().toISOString()
    return route.fulfill({ json: { schemaVersion: 1, accountId: ACCOUNT_ID, accountKind: 'twitch', environment: 'live', revision: 4, status: 'active', checkoutEnabled: false,
      serverTime, accessFrom: new Date(Date.now() - 86_400_000).toISOString(), accessUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      cacheUntil: new Date(Date.now() + 900_000).toISOString(), supportPeriods: 1, cosmetics: { enabled: true, finish: 'halo' },
      features: { 'supporter.banner.v1': true, 'supporter.finish.v1': true, 'supporter.recognition.v1': true, 'supporter.chat_badge.v1': false } } })
  })

  await openTwitchChannel(extension.page)
  const second = await extension.context.newPage()
  await openTwitchChannel(second)
  const appearances = await extension.serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' })
    const out: unknown[] = []
    for (const tab of tabs) {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: async () => [
        await chrome.runtime.sendMessage({ type: 'SUPPORTER_APPEARANCE' }),
        await chrome.runtime.sendMessage({ type: 'SUPPORTER_APPEARANCE' }),
      ] })
      out.push(...(results[0]?.result as unknown[]))
    }
    return out as Array<{ type: string; finish: string | null; validForMs: number }>
  })
  expect(appearances).toHaveLength(4)
  for (const appearance of appearances) {
    expect(appearance).toMatchObject({ type: 'SUPPORTER_APPEARANCE', finish: 'halo' })
    expect(appearance.validForMs).toBeGreaterThan(20_000)
    expect(appearance.validForMs).toBeLessThanOrEqual(60_000)
  }
  // Two tabs mounting plus four explicit checks: one network read.
  expect(reads).toBe(1)

  // Settings asks fresh.
  const settings = await extension.context.newPage()
  await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const fresh = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ENTITLEMENT' }))
  expect(fresh).toMatchObject({ type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'ready', status: 'active' } })
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2)
})
