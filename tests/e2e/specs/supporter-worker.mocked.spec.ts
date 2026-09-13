import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

test('packaged worker stores a link privately and returns only the human code', async ({ extension, prepare }) => {
  await prepare()
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({ pollingSecret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600_000).toISOString(), intervalSeconds: 5 }),
  }))
  await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const start = await extension.page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'start' }))
  expect(start).toMatchObject({ type: 'SUPPORTER_ACCOUNT', account: { state: 'pending', code: 'ABCDE-12345' } })
  expect(JSON.stringify(start)).not.toContain('c'.repeat(64))
  const stored = await extension.serviceWorker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pulse-account-private-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject })
    try { return await new Promise<boolean>((resolve, reject) => { const r = db.transaction('account').objectStore('account').get('https://api.streampulse.stream'); r.onsuccess = () => resolve(r.result?.secret?.length === 64); r.onerror = reject }) } finally { db.close() }
  })
  expect(stored).toBe(true)
  await extension.page.reload()
  const status = await extension.page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'status' }))
  expect(status.account.code).toBe('ABCDE-12345')
  const invalid = await extension.page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'start', token: 'injected' }))
  expect(invalid.error).toBeTruthy()
  const canceled = await extension.page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'cancel' }))
  expect(canceled.account.state).toBe('signed_out')
})

test('Twitch content scripts cannot invoke the account transport', async ({ extension, prepare }) => {
  await prepare()
  await openTwitchChannel(extension.page)
  const response = await extension.serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' })
    const tabId = tabs[0]?.id
    if (tabId == null) throw new Error('fixture Twitch tab missing')
    const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: async () => ({
      account: await chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'status' }),
      entitlement: await chrome.runtime.sendMessage({ type: 'SUPPORTER_ENTITLEMENT' }),
      equip: await chrome.runtime.sendMessage({ type: 'SUPPORTER_COSMETICS', enabled: true, finish: 'halo' }),
      appearance: await chrome.runtime.sendMessage({ type: 'SUPPORTER_APPEARANCE' }),
    }) })
    return results[0]?.result
  })
  expect(response).toEqual({ account: { error: 'unauthorized_sender' }, entitlement: { error: 'unauthorized_sender' }, equip: { error: 'unauthorized_sender' }, appearance: { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0 } })
})

test('packaged disconnect keeps private retry authority across settings reload', async ({ extension, prepare }) => {
  await prepare()
  let available = false
  await extension.context.route('https://api.streampulse.stream/v1/account/devices/disconnect', route => route.fulfill({ status: available ? 204 : 503, body: '' }))
  await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await extension.page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'status' }))
  await extension.serviceWorker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pulse-account-private-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('account', 'readwrite')
        tx.objectStore('account').put({ kind: 'linked', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: '11111111-1111-4111-8111-111111111111', deviceId: '22222222-2222-4222-8222-222222222222', expiresAt: new Date(Date.now()+3600000).toISOString(), refreshExpiresAt: new Date(Date.now()+86400000).toISOString() }, 'https://api.streampulse.stream')
        tx.oncomplete = () => resolve(); tx.onerror = reject
      })
    } finally { db.close() }
  })
  await extension.page.reload()
  await extension.page.getByRole('button', { name: 'Disconnect extension', exact: true }).click()
  await expect(extension.page.getByRole('button', { name: 'Retry disconnect', exact: true })).toBeVisible()
  await extension.page.reload()
  await expect(extension.page.getByRole('button', { name: 'Retry disconnect', exact: true })).toBeVisible()
  const status = await extension.page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'status' }))
  expect(status.account).toEqual({ state: 'error', revocationPending: true })
  expect(JSON.stringify(status)).not.toContain('a'.repeat(64))
  available = true
  await extension.page.getByRole('button', { name: 'Retry disconnect', exact: true }).click()
  await expect(extension.page.getByRole('button', { name: 'Link extension', exact: true })).toBeVisible()
})
