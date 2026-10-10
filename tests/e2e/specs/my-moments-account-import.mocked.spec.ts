import { test, expect } from '../helpers/testFixtures.ts'
import type { Worker } from '@playwright/test'

/**
 * Packaged proof of two account rules for My Moments:
 *   - saves made without an account join the signed-in account only after an
 *     explicit "Add to account" confirm, and leave the device only after the
 *     account confirms each one (notes never leave the device);
 *   - Sign out removes this browser's copy of the account's history and
 *     notes, while saves made without an account stay.
 */
const API = 'https://api.streampulse.stream'
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const LINKED = {
  token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: ACCOUNT_ID, deviceId: '22222222-2222-4222-8222-222222222222',
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
}
const LOCAL_SCOPE = `${API}|local`
const ACCOUNT_SCOPE = `${API}|account:${ACCOUNT_ID}`

async function idb(worker: Worker, name: string, store: string, op: 'put' | 'get', key: string, value?: unknown): Promise<unknown> {
  return worker.evaluate(async ({ name, store, op, key, value }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(store)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(new Error('open failed'))
    })
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(store, op === 'put' ? 'readwrite' : 'readonly')
        const request = op === 'put' ? tx.objectStore(store).put(value, key) : tx.objectStore(store).get(key)
        tx.oncomplete = () => resolve(op === 'get' ? (request as IDBRequest).result ?? null : null)
        tx.onerror = tx.onabort = () => reject(new Error('transaction failed'))
      })
    } finally { db.close() }
  }, { name, store, op, key, value })
}

const at = new Date(Date.now() - 3_600_000).toISOString()
const deviceSave = (id: string, offsetSeconds: number, label: string) => ({ id, login: 'fixturechan', streamId: '123456789', vodId: '2806037629', offsetSeconds,
  label, notes: '', source: 'extension', createdAt: at, updatedAt: at })
const personal = (extra: object) => ({ preferences: { captureHistory: true, retentionDays: 30 }, epoch: 0, history: [], notes: {}, bookmarks: [], ...extra })

test.describe('packaged My Moments with an account', () => {
  test('adds saves made on this device to the account after a confirm, then Sign out removes the account copy only', async ({ extension, prepare }) => {
    await prepare({ scenario: 'live-ready' })
    const worker = extension.serviceWorker
    await idb(worker, 'pulse-account-private-v1', 'account', 'put', API, { kind: 'linked', ...LINKED })
    await idb(worker, 'pulse-my-moments-v1', 'personal', 'put', LOCAL_SCOPE, personal({
      bookmarks: [deviceSave('local:a', 100, 'Already in account'), deviceSave('local:b', 200, 'Only on device')],
      notes: { 'local:b': 'device-only note' },
    }))
    const jumped = Date.now() - 60_000
    await idb(worker, 'pulse-my-moments-v1', 'personal', 'put', ACCOUNT_SCOPE, personal({
      history: [{ id: 'fixturechan:123456789:300', channel: 'fixturechan', title: 'Watched while signed in', vodId: '2806037629', streamId: '123456789',
        offsetSeconds: 300, availability: 'available', note: '', jumpedAt: jumped, historyExpiresAt: jumped + 86_400_000 }],
    }))

    const inAccount = { id: 'acct-100', login: 'fixturechan', streamId: '123456789', vodId: '2806037629', offsetSeconds: 100, label: 'Already in account',
      notes: '', source: 'extension', createdAt: at, updatedAt: at }
    let items = [inAccount]
    const posts: unknown[] = []
    await extension.context.route(`${API}/v1/pulse/bookmarks**`, async route => {
      expect(route.request().headers().authorization).toBe(`Bearer ${LINKED.token}`)
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON()
        posts.push(input)
        const saved = { ...inAccount, ...input, id: 'acct-200', notes: '' }
        items = [...items, saved]
        await route.fulfill({ status: 201, json: saved })
        return
      }
      await route.fulfill({ json: { items } })
    })
    const disconnects: unknown[] = []
    await extension.context.route(`${API}/v1/account/devices/disconnect`, async route => { disconnects.push(route.request().postDataJSON()); await route.fulfill({ status: 204, body: '' }) })

    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
    await expect(page.getByRole('heading', { name: 'My Moments', exact: true })).toBeVisible()
    const deviceSection = page.locator('.pl-device-saves')
    await expect(deviceSection).toContainText('2 bookmarks saved without an account are kept on this device')
    await deviceSection.getByRole('button', { name: 'Add all to account', exact: true }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toContainText('Add 2 bookmarks to your account?')
    await expect(dialog).toContainText('Notes stay on this device.')
    expect(posts).toEqual([])
    await page.screenshot({ path: test.info().outputPath('add-to-account-confirm.png'), fullPage: true })
    await dialog.getByRole('button', { name: 'Add to account', exact: true }).click()
    await expect(page.getByText('Added to your account.', { exact: true })).toBeVisible()
    await expect(deviceSection).toHaveCount(0)
    // Only the save the account lacked was posted, without its note.
    expect(posts).toEqual([{ login: 'fixturechan', streamId: '123456789', vodId: '2806037629', offsetSeconds: 200, label: 'Only on device', source: 'extension' }])
    expect(await idb(worker, 'pulse-my-moments-v1', 'personal', 'get', LOCAL_SCOPE)).toMatchObject({ bookmarks: [], notes: {} })
    expect(await idb(worker, 'pulse-my-moments-v1', 'personal', 'get', ACCOUNT_SCOPE)).toMatchObject({ notes: { 'acct-200': 'device-only note' } })
    await page.screenshot({ path: test.info().outputPath('add-to-account-done.png'), fullPage: true })

    // Sign out: the account copy (history and notes) goes; the |local record stays.
    await idb(worker, 'pulse-my-moments-v1', 'personal', 'put', LOCAL_SCOPE, personal({ bookmarks: [deviceSave('local:c', 400, 'Saved later')] }))
    const out = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'disconnect' }))
    expect(out.account).toEqual({ state: 'signed_out' })
    expect(disconnects).toEqual([{ token: LINKED.token }])
    await expect.poll(() => idb(worker, 'pulse-my-moments-v1', 'personal', 'get', ACCOUNT_SCOPE)).toBeNull()
    expect(await idb(worker, 'pulse-my-moments-v1', 'personal', 'get', LOCAL_SCOPE)).toMatchObject({ bookmarks: [{ id: 'local:c' }] })
  })
})
