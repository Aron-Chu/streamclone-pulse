import { expect, type BrowserContext, type Worker } from '@playwright/test'

/**
 * A linked Pulse account with a fixture Supporter membership, for specs that
 * need the worker to verify Supporter perks. Every read is served from these
 * fixtures; nothing reaches the hosted API.
 */
export const LINKED_DEVICE = {
  token: 'a'.repeat(64),
  refreshToken: 'b'.repeat(64),
  accountId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
}

/** Seed the linked credential into the worker's private store and prove the round trip. */
export async function linkDevice(serviceWorker: Worker): Promise<void> {
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

export type MembershipStatus = 'none' | 'active' | 'grace' | 'pending' | 'expired' | 'review'

export function supporterBody(status: MembershipStatus, supportPeriods: number, cosmetics = { enabled: false, finish: 'glass' }) {
  const paid = status === 'active' || status === 'grace'
  return {
    schemaVersion: 1,
    accountId: LINKED_DEVICE.accountId,
    environment: 'live',
    revision: 4,
    status,
    checkoutEnabled: true,
    serverTime: new Date().toISOString(),
    accessFrom: new Date(Date.now() - 86_400_000).toISOString(),
    accessUntil: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    cacheUntil: new Date(Date.now() + 900_000).toISOString(),
    supportPeriods,
    features: {
      'supporter.banner.v1': paid,
      'supporter.finish.v1': paid,
      'supporter.recognition.v1': supportPeriods > 0,
      'supporter.chat_badge.v1': false,
    },
    cosmetics,
  }
}

/** Serve the current membership for every entitlement read, so a spec can change it mid-run. */
export async function serveMembership(context: BrowserContext, body: () => ReturnType<typeof supporterBody>): Promise<void> {
  await context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: body() }))
}
