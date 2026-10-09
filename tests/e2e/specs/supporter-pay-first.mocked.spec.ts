import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import type { CDPSession, Page, Worker } from '@playwright/test'

const ACCOUNT = '11111111-1111-4111-8111-1111111a1b2c'
const ATTEMPT = '33333333-3333-4333-8333-333333333333'
const RESTORE = '44444444-4444-4444-8444-444444444444'
const CLOSED_PENDING_MS = 35_000
const STOPPED_POLL_PROOF_MS = 11_000 // More than two five-second worker ticks.
const credential = (accountId = ACCOUNT, token = 'a'.repeat(64)) => ({ accountId, token, refreshToken: 'b'.repeat(64), deviceId: '22222222-2222-4222-8222-222222222222', expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString() })
function snapshot(status: 'none' | 'pending' | 'active', cosmetics = { enabled: false, finish: 'glass' }, accountId = ACCOUNT) {
  const paid = status === 'active'
  return { schemaVersion: 1, accountId, environment: 'live', revision: paid ? 2 : 1, status, checkoutEnabled: true, installationAccountsEnabled: true, accountKind: 'installation', restoreEligible: status === 'none', serverTime: new Date().toISOString(), accessFrom: new Date(Date.now() - 60_000).toISOString(), accessUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(), cacheUntil: new Date(Date.now() + 60_000).toISOString(), supportPeriods: paid ? 1 : 0, features: { 'supporter.banner.v1': paid, 'supporter.finish.v1': paid, 'supporter.recognition.v1': paid }, cosmetics }
}
/**
 * The options page no longer starts an installation account or an email
 * restore (account journey spec, closeout 2026-10-08b: the page never sends
 * SUPPORTER_RESTORE and never asks for an installation). The worker paths are
 * kept, so these packaged proofs start them through the same extension-page
 * message the page used to send, then observe the page and the mock server.
 */
const workerCheckout = (page: Page) => page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'checkout' }))
const workerRestore = (page: Page, email = 'payer@example.test') => page.evaluate(address => chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'start', email: address }), email)
// Controlled fixture worker only. Real provider destinations are resolver-blocked.
async function recordTabs(worker: Worker) {
  await worker.evaluate(() => {
    const original = chrome.tabs.create.bind(chrome.tabs)
    const opened: string[] = []
    ;(globalThis as unknown as { __payTabs: string[] }).__payTabs = opened
    chrome.tabs.create = ((properties: chrome.tabs.CreateProperties) => { opened.push(String(properties.url)); return original(properties) }) as typeof chrome.tabs.create
  })
  return () => worker.evaluate(() => (globalThis as unknown as { __payTabs: string[] }).__payTabs)
}
interface Node { nodeId: number; nodeName: string; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] }
const attr = (node: Node, name: string) => { const index = node.attributes?.indexOf(name) ?? -1; return index < 0 ? undefined : node.attributes?.[index + 1] }
function find(node: Node, predicate: (value: Node) => boolean): Node | undefined {
  if (predicate(node)) return node
  for (const child of [...node.children ?? [], ...node.shadowRoots ?? []]) { const found = find(child, predicate); if (found) return found }
}
async function finish(cdp: CDPSession) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const host = find(root, node => attr(node, 'id') === 'streamclone-pulse-root')
  const banner = host && find(host, node => node.nodeName === 'HEADER' && (attr(node, 'class') ?? '').split(/\s+/).includes('pulse-personal-banner'))
  return banner ? attr(banner, 'data-supporter-finish') ?? null : undefined
}

test('worker installation Checkout opens only Stripe, delayed payment activates a chosen finish on an already-open Twitch tab without reload', async ({ extension, prepare }, info) => {
  test.setTimeout(100_000)
  await prepare()
  const context = extension.context
  await context.addCookies([{ name: 'ambient_account_fixture', value: 'must_not_be_sent', domain: 'api.streampulse.stream', path: '/', secure: true }])
  let status: 'none' | 'pending' | 'active' = 'none'
  let cosmetics = { enabled: false, finish: 'glass' }
  const calls: string[] = [], writes: unknown[] = []
  await context.route('https://api.streampulse.stream/v1/account/installations', route => {
    calls.push('installation')
    expect(route.request().postDataJSON()).toMatchObject({ installationKey: expect.stringMatching(/^[a-f0-9]{64}$/), label: 'StreamPulse extension' })
    expect(route.request().headers().cookie).toBeUndefined()
    return route.fulfill({ status: 201, json: credential() })
  })
  await context.route('https://api.streampulse.stream/v1/billing/checkout', route => {
    calls.push('checkout')
    expect(route.request().headers().authorization).toBe(`Bearer ${credential().token}`)
    expect(route.request().headers().cookie).toBeUndefined()
    expect(route.request().postDataJSON()).toEqual({})
    return route.fulfill({ json: { attemptId: ATTEMPT, url: 'https://checkout.stripe.com/c/pay/cs_test_local_fixture#fidkdWxOYHwnPyd1blppbHNgWmR', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } })
  })
  await context.route(`https://api.streampulse.stream/v1/billing/checkout/${ATTEMPT}`, route => route.fulfill({ json: { attemptId: ATTEMPT, state: status === 'none' ? 'open' : status === 'pending' ? 'pending' : 'active' } }))
  await context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot(status, cosmetics) }))
  await context.route('https://api.streampulse.stream/v1/billing/cosmetics', route => { cosmetics = route.request().postDataJSON(); writes.push(cosmetics); return route.fulfill({ json: cosmetics }) })
  const settings = extension.page
  await settings.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const twitch = await context.newPage(), cdp = await context.newCDPSession(twitch)
  let twitchNavigations = 0
  twitch.on('framenavigated', frame => { if (frame === twitch.mainFrame()) twitchNavigations++ })
  await openTwitchChannel(twitch)
  await expect.poll(() => finish(cdp)).toBe(null)
  const initialNavigations = twitchNavigations
  await settings.bringToFront()
  await settings.getByRole('group', { name: 'Paint' }).getByRole('radio', { name: 'Halo', exact: true }).check()
  await settings.getByRole('button', { name: 'Use Halo when Supporter starts', exact: true }).click()
  expect(calls).toEqual([])
  const tabs = await recordTabs(extension.serviceWorker)
  // A signed-out page offers no purchase; the kept worker path is started directly.
  await expect(settings.getByRole('button', { name: 'Become a Supporter', exact: true })).toHaveCount(0)
  await workerCheckout(settings)
  await expect(settings.locator('[data-journey-state="stripe-open"]')).toBeVisible()
  expect(await tabs()).toEqual(['https://checkout.stripe.com/c/pay/cs_test_local_fixture#fidkdWxOYHwnPyd1blppbHNgWmR'])
  await settings.getByRole('button', { name: 'Return to Stripe checkout', exact: true }).click()
  await expect.poll(tabs).toEqual(['https://checkout.stripe.com/c/pay/cs_test_local_fixture#fidkdWxOYHwnPyd1blppbHNgWmR', 'https://checkout.stripe.com/c/pay/cs_test_local_fixture#fidkdWxOYHwnPyd1blppbHNgWmR'])
  expect(calls).toEqual(['installation', 'checkout'])
  expect(writes).toEqual([])
  status = 'pending'
  await expect(settings.locator('[data-journey-state="payment-pending"]')).toBeVisible({ timeout: 20_000 })
  await expect(settings.getByRole('button', { name: 'Become a Supporter', exact: true })).toHaveCount(0)
  await settings.screenshot({ path: info.outputPath('pay-first-confirming.png'), fullPage: true, animations: 'disabled' })
  status = 'active'
  await expect(settings.locator('[data-journey-state="active"]')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => writes).toEqual([{ enabled: true, finish: 'halo' }])
  await twitch.bringToFront()
  await expect.poll(() => finish(cdp), { timeout: 20_000 }).toBe('halo')
  expect(twitchNavigations).toBe(initialNavigations)
  expect(calls).toEqual(['installation', 'checkout'])
  const safe = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'status' }))
  expect(JSON.stringify(safe)).not.toMatch(/cs_test|aaaa|bbbb|installationKey/)
  await cdp.detach()
})

test('worker confirms a payment with settings closed and no Twitch page', async ({ extension, prepare }, info) => {
  test.setTimeout(90_000)
  await prepare()
  let paid = false, activeProjectedAt = 0
  const pollTimes: number[] = [], pendingPollTimes: number[] = []
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/checkout', route => route.fulfill({ json: { attemptId: ATTEMPT, url: 'https://checkout.stripe.com/c/pay/cs_test_closed_fixture', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } }))
  await extension.context.route(`https://api.streampulse.stream/v1/billing/checkout/${ATTEMPT}`, route => {
    pollTimes.push(Date.now())
    if (!paid) pendingPollTimes.push(Date.now())
    return route.fulfill({ json: { attemptId: ATTEMPT, state: paid ? 'active' : 'open' } })
  })
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => {
    if (paid) activeProjectedAt = Date.now()
    return route.fulfill({ json: snapshot(paid ? 'active' : 'none') })
  })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await workerCheckout(page)
  await expect(page.locator('[data-journey-state="stripe-open"]')).toBeVisible()
  // Keep only a blank stand-in: closing Chromium's final window also kills its
  // worker. The resolver-blocked Stripe tab is not a settings or Twitch page.
  const standIn = await extension.context.newPage()
  await standIn.goto('about:blank')
  for (const other of extension.context.pages()) if (other !== page && other !== standIn) await other.close()
  await page.close()
  const closedAt = Date.now()
  expect(extension.context.pages().map(open => open.url())).toEqual(['about:blank'])
  // These reads inspect only Node-side route callbacks. No worker evaluation,
  // extension page, Chrome message or browser interaction can sustain the wait.
  await expect.poll(() => pendingPollTimes.some(at => at - closedAt >= CLOSED_PENDING_MS), { timeout: 45_000 }).toBe(true)
  const completedAt = Date.now()
  paid = true
  await expect.poll(() => activeProjectedAt >= completedAt, { timeout: 15_000 }).toBe(true)
  const completedPollCount = pollTimes.length
  await new Promise(resolve => setTimeout(resolve, STOPPED_POLL_PROOF_MS))
  expect(pollTimes).toHaveLength(completedPollCount)
  const reopenedAt = Date.now()
  await info.attach('settings-closed-payment-timing', { body: JSON.stringify({ closedAt, pendingPollTimes, completedAt, activeProjectedAt, pollTimes, reopenedAt, stoppedPollProofMs: STOPPED_POLL_PROOF_MS }), contentType: 'application/json' })
  const reopened = await extension.context.newPage()
  await reopened.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await expect(reopened.getByText('Supporter active', { exact: true })).toBeVisible()
  expect(pollTimes).toHaveLength(completedPollCount)
})

test('the kept worker restore completes privately after email approval even when settings closes', async ({ extension, prepare }, info) => {
  test.setTimeout(90_000)
  await prepare()
  const recoveredAccount = '55555555-5555-4555-8555-555555555555'
  let approved = false, approvalCollectedAt = 0
  const pollTimes: number[] = [], pendingPollTimes: number[] = []
  const posts: unknown[] = []
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/account/restores', route => {
    posts.push(route.request().postDataJSON())
    expect(route.request().headers().authorization).toBe(`Bearer ${credential().token}`)
    return route.fulfill({ status: 201, json: { restoreId: RESTORE, pollingSecret: 'c'.repeat(64), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
  })
  await extension.context.route('https://api.streampulse.stream/v1/account/restores/poll', route => {
    pollTimes.push(Date.now())
    if (approved) approvalCollectedAt = Date.now()
    else pendingPollTimes.push(Date.now())
    expect(route.request().postDataJSON()).toEqual({ restoreId: RESTORE, pollingSecret: 'c'.repeat(64) })
    return route.fulfill({ json: approved ? { state: 'approved', ...credential(recoveredAccount, 'd'.repeat(64)) } : { state: 'pending' } })
  })
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot(route.request().headers().authorization === `Bearer ${'d'.repeat(64)}` ? 'active' : 'none', undefined, route.request().headers().authorization === `Bearer ${'d'.repeat(64)}` ? recoveredAccount : ACCOUNT) }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const started = await workerRestore(page)
  expect(started.restore).toMatchObject({ state: 'pending', comparisonCode: 'A3B4C5' })
  expect(posts).toEqual([{ email: 'payer@example.test', restoreKey: expect.stringMatching(/^[a-f0-9]{64}$/) }])
  // The page shows no restore and no email, and the worker hands out no secret.
  expect(await page.locator('body').innerText()).not.toMatch(/cccc|dddd|payer@example|A3B4C5/)
  const safe = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'status' }))
  expect(JSON.stringify(safe)).not.toMatch(/cccc|restoreId|token/)
  // Email approval happens in another tab. Keep a blank fixture stand-in so
  // closing settings does not close Chromium's final window and stop its worker.
  const emailTab = await extension.context.newPage()
  await emailTab.goto('about:blank')
  await page.close()
  const closedAt = Date.now()
  expect(extension.context.pages().map(open => open.url())).toEqual(['about:blank'])
  // Observe only the mock server while the request is pending beyond MV3 idle.
  await expect.poll(() => pendingPollTimes.some(at => at - closedAt >= CLOSED_PENDING_MS), { timeout: 45_000 }).toBe(true)
  const approvedAt = Date.now()
  approved = true
  await expect.poll(() => approvalCollectedAt >= approvedAt, { timeout: 15_000 }).toBe(true)
  const completedPollCount = pollTimes.length
  await new Promise(resolve => setTimeout(resolve, STOPPED_POLL_PROOF_MS))
  expect(pollTimes).toHaveLength(completedPollCount)
  const reopenedAt = Date.now()
  await info.attach('settings-closed-restore-timing', { body: JSON.stringify({ closedAt, pendingPollTimes, approvedAt, approvalCollectedAt, pollTimes, reopenedAt, stoppedPollProofMs: STOPPED_POLL_PROOF_MS }), contentType: 'application/json' })
  const reopened = await extension.context.newPage()
  await reopened.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await expect(reopened.getByText('Supporter active', { exact: true })).toBeVisible({ timeout: 15_000 })
  const state = await reopened.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'status' }))
  expect(state.account.accountId).toBe(recoveredAccount)
  expect(JSON.stringify(state)).not.toMatch(/cccc|dddd|token/)
  expect(pollTimes).toHaveLength(completedPollCount)
})

test('the kept worker restore replaces a revoked bootstrap identity instead of replaying a claimed key', async ({ extension, prepare }) => {
  await prepare()
  let firstKey = '', installations = 0, approved = false
  const freshAccount = '77777777-7777-4777-8777-777777777777'
  const restoredAccount = '55555555-5555-4555-8555-555555555555'
  const fresh = credential(freshAccount, 'f'.repeat(64))
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => {
    const key = route.request().postDataJSON().installationKey
    installations++
    if (!firstKey) { firstKey = key; return route.fulfill({ status: 201, json: credential() }) }
    if (key === firstKey) return route.fulfill({ status: 409, json: { error: 'installation_initialized' } })
    return route.fulfill({ status: 201, json: fresh })
  })
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => {
    const token = route.request().headers().authorization
    if (approved && token === `Bearer ${'d'.repeat(64)}`) return route.fulfill({ json: snapshot('active', undefined, restoredAccount) })
    return route.fulfill({ json: { ...snapshot('none', undefined, token === `Bearer ${fresh.token}` ? freshAccount : ACCOUNT), checkoutEnabled: false } })
  })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  expect((await workerCheckout(page)).billing).toEqual({ state: 'closed' })
  await expect(page.locator('[data-journey-state="checkout-closed"]')).toBeVisible()
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.request().headers().authorization === `Bearer ${credential().token}` ? route.fulfill({ status: 401, json: { error: 'account_authorization_required' } }) : route.fallback())
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ENTITLEMENT' }))
  await extension.context.route('https://api.streampulse.stream/v1/account/restores', route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${fresh.token}`)
    return route.fulfill({ status: 201, json: { restoreId: RESTORE, pollingSecret: 'c'.repeat(64), expiresAt: new Date(Date.now() + 900_000).toISOString(), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
  })
  await extension.context.route('https://api.streampulse.stream/v1/account/restores/poll', route => route.fulfill({ json: approved ? { state: 'approved', ...credential(restoredAccount, 'd'.repeat(64)) } : { state: 'pending' } }))
  // The page offers no restore after the rejection; the worker path is kept.
  await expect(page.locator('[data-journey-state="signed-out"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore my Supporter', exact: true })).toHaveCount(0)
  expect((await workerRestore(page)).restore.state).toBe('pending')
  expect(installations).toBe(2)
  approved = true
  await expect(page.getByText('Supporter active', { exact: true })).toBeVisible({ timeout: 20_000 })
})

test('uncertain installation refresh retains its identity and restores after renewal without re-enrollment', async ({ extension, prepare }) => {
  await prepare()
  let installationKey = '', installations = 0, refreshes = 0, restoreStarts = 0, networkDown = true, approved = false
  const restoredAccount = '55555555-5555-4555-8555-555555555555'
  const renewed = { ...credential(ACCOUNT, 'f'.repeat(64)), refreshToken: 'e'.repeat(64) }
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => {
    installationKey = route.request().postDataJSON().installationKey
    installations++
    return route.fulfill({ status: 201, json: credential() })
  })
  await extension.context.route('https://api.streampulse.stream/v1/account/devices/refresh', route => {
    refreshes++
    expect(route.request().postDataJSON()).toEqual({ refreshToken: 'b'.repeat(64) })
    return networkDown ? route.abort('failed') : route.fulfill({ json: renewed })
  })
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => {
    if (approved && route.request().headers().authorization === `Bearer ${'d'.repeat(64)}`) return route.fulfill({ json: snapshot('active', undefined, restoredAccount) })
    return route.fulfill({ json: { ...snapshot('none'), checkoutEnabled: false } })
  })
  await extension.context.route('https://api.streampulse.stream/v1/account/restores', route => {
    restoreStarts++
    expect(route.request().headers().authorization).toBe(`Bearer ${renewed.token}`)
    return route.fulfill({ status: 201, json: { restoreId: RESTORE, pollingSecret: 'c'.repeat(64), expiresAt: new Date(Date.now() + 900_000).toISOString(), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
  })
  await extension.context.route('https://api.streampulse.stream/v1/account/restores/poll', route => route.fulfill({ json: approved ? { state: 'approved', ...credential(restoredAccount, 'd'.repeat(64)) } : { state: 'pending' } }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  expect((await workerCheckout(page)).billing).toEqual({ state: 'closed' })
  await expect(page.locator('[data-journey-state="checkout-closed"]')).toBeVisible()
  // Expire only the disposable fixture credential, never an owner profile.
  await extension.serviceWorker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pulse-account-private-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('account', 'readwrite'), store = tx.objectStore('account'), r = store.get('https://api.streampulse.stream')
        r.onsuccess = () => store.put({ ...r.result, expiresAt: new Date(Date.now() - 1000).toISOString() }, 'https://api.streampulse.stream')
        tx.oncomplete = () => resolve(); tx.onerror = reject
      })
    } finally { db.close() }
  })
  const unavailable = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'status' }))
  expect(unavailable.account).toMatchObject({ state: 'unavailable', linked: true, reason: 'temporarily_unavailable' })
  expect((await workerRestore(page)).restore).toEqual({ state: 'unavailable', reason: 'connection' })
  expect(installations).toBe(1)
  expect(refreshes).toBe(1)
  expect(restoreStarts).toBe(0)
  const retained = await extension.serviceWorker.evaluate(async expectedKey => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pulse-account-private-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject })
    try {
      const tx = db.transaction('account'), store = tx.objectStore('account')
      const read = (key: string) => new Promise<Record<string, unknown>>((resolve, reject) => { const r = store.get(key); r.onsuccess = () => resolve(r.result); r.onerror = reject })
      const [account, bootstrap] = await Promise.all([read('https://api.streampulse.stream'), read('supporter-installation-key')])
      const credentials = (account.credentials ?? {}) as Record<string, unknown>
      return { kind: account.kind, installation: account.installation, accountId: credentials.accountId, tokenRetained: credentials.token === 'a'.repeat(64), refreshRetained: credentials.refreshToken === 'b'.repeat(64), keyRetained: bootstrap?.key === expectedKey, keyState: bootstrap?.state }
    } finally { db.close() }
  }, installationKey)
  expect(retained).toEqual({ kind: 'refreshing', installation: true, accountId: ACCOUNT, tokenRetained: true, refreshRetained: true, keyRetained: true, keyState: 'claimed' })
  networkDown = false
  // Make this fixture's persisted retry due; unit tests cover the real 30s
  // cooldown. The browser proof exercises the same lost refresh token retry.
  await extension.serviceWorker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pulse-account-private-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('account', 'readwrite'), store = tx.objectStore('account'), r = store.get('https://api.streampulse.stream')
        r.onsuccess = () => store.put({ ...r.result, retryAt: Date.now() - 1000 }, 'https://api.streampulse.stream')
        tx.oncomplete = () => resolve(); tx.onerror = reject
      })
    } finally { db.close() }
  })
  const recovered = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'status' }))
  expect(recovered.account).toMatchObject({ state: 'linked', accountId: ACCOUNT })
  expect(refreshes).toBe(2)
  expect((await workerRestore(page)).restore.state).toBe('pending')
  expect(installations).toBe(1)
  expect(restoreStarts).toBe(1)
  approved = true
  await expect(page.getByText('Supporter active', { exact: true })).toBeVisible({ timeout: 20_000 })
  // The Account card's billing row carries its own Manage subscription; this is the footer's.
  await expect(page.locator('.pulse-journey').getByRole('button', { name: 'Manage subscription', exact: true })).toBeVisible()
})

test('a 429 try_later from Checkout names the wait and the worker sends nothing until it ends', async ({ extension, prepare }) => {
  await prepare()
  const checkoutCalls: number[] = []
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot('none') }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/checkout', route => {
    checkoutCalls.push(Date.now())
    return route.fulfill({ status: 429, headers: { 'Retry-After': '540' }, json: { error: 'try_later' } })
  })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const first = await workerCheckout(page)
  expect(first.billing.state).toBe('try_later')
  expect(first.billing.retryAt - Date.now()).toBeGreaterThan(530_000)
  // Pressing again, or reopening settings, asks the server nothing.
  expect((await workerCheckout(page)).billing.state).toBe('try_later')
  await page.reload()
  const journey = page.locator('[data-journey-state="try-later"]')
  await expect(journey).toBeVisible()
  await expect(journey).toContainText('Checkout is paused for a moment')
  await expect(journey).toContainText('This attempt started nothing and charged nothing.')
  await expect(journey).toContainText('(about 9 minutes)')
  await expect(journey.getByRole('button', { name: /^Try again after / })).toBeDisabled()
  expect(checkoutCalls).toHaveLength(1)
})

test('slow Checkout and Portal responses survive the former twelve-second deadline', async ({ extension, prepare }) => {
  test.setTimeout(100_000)
  await prepare()
  let paid = false
  const tabs = await recordTabs(extension.serviceWorker)
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot(paid ? 'active' : 'none') }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/checkout', async route => {
    await new Promise(resolve => setTimeout(resolve, 13_000))
    await route.fulfill({ json: { attemptId: ATTEMPT, url: 'https://checkout.stripe.com/c/pay/slow-fixture', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } })
  })
  await extension.context.route(`https://api.streampulse.stream/v1/billing/checkout/${ATTEMPT}`, route => route.fulfill({ json: { attemptId: ATTEMPT, state: paid ? 'active' : 'open', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/portal', async route => {
    expect(route.request().headers().cookie).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 13_000))
    await route.fulfill({ json: { url: 'https://billing.stripe.com/p/session/slow-fixture' } })
  })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await workerCheckout(page)
  await expect(page.locator('[data-journey-state="stripe-open"]')).toBeVisible({ timeout: 30_000 })
  paid = true
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_BILLING', action: 'check' }))
  await page.reload()
  await expect(page.locator('[data-journey-state="active"]')).toBeVisible()
  await page.locator('.pulse-journey').getByRole('button', { name: 'Manage subscription', exact: true }).click()
  await expect.poll(tabs, { timeout: 30_000 }).toContain('https://billing.stripe.com/p/session/slow-fixture')
})

test('lost restore start resumes its matching code without resending an email', async ({ extension, prepare }) => {
  test.setTimeout(100_000)
  await prepare()
  let initialKey = '', writes = 0
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot('none') }))
  await extension.context.route('https://api.streampulse.stream/v1/account/restores', async route => {
    const body = route.request().postDataJSON()
    writes++
    if (body.email) {
      initialKey = body.restoreKey
      expect(initialKey).toMatch(/^[a-f0-9]{64}$/)
      return route.abort('failed')
    }
    expect(body).toEqual({ restoreKey: initialKey })
    return route.fulfill({ status: 201, json: { restoreId: RESTORE, pollingSecret: 'c'.repeat(64), expiresAt: new Date(Date.now() + 900_000).toISOString(), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
  })
  await extension.context.route('https://api.streampulse.stream/v1/account/restores/poll', route => route.fulfill({ json: { state: 'pending' } }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  expect((await workerRestore(page)).restore.state).toBe('uncertain')
  const checked = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'check' }))
  expect(checked.restore).toMatchObject({ state: 'pending', comparisonCode: 'A3B4C5' })
  expect(writes).toBe(2)
  const privateRecord = await extension.serviceWorker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pulse-account-private-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject })
    try { return await new Promise<unknown>((resolve, reject) => { const r = db.transaction('account').objectStore('account').get('supporter-pay-first'); r.onsuccess = () => resolve(r.result); r.onerror = reject }) } finally { db.close() }
  })
  expect(JSON.stringify(privateRecord)).not.toMatch(/payer@example|restoreKey/)
})

test('a successful slow restore response outlasts the former twelve-second deadline', async ({ extension, prepare }) => {
  test.setTimeout(60_000)
  await prepare()
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot('none') }))
  await extension.context.route('https://api.streampulse.stream/v1/account/restores', async route => {
    await new Promise(resolve => setTimeout(resolve, 13_000))
    return route.fulfill({ status: 201, json: { restoreId: RESTORE, pollingSecret: 'c'.repeat(64), expiresAt: new Date(Date.now() + 900_000).toISOString(), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
  })
  await extension.context.route('https://api.streampulse.stream/v1/account/restores/poll', route => route.fulfill({ json: { state: 'pending' } }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  const started = Date.now()
  expect((await workerRestore(page)).restore).toMatchObject({ state: 'pending', comparisonCode: 'A3B4C5' })
  expect(Date.now() - started).toBeGreaterThanOrEqual(12_000)
})

test('a restore that may have been sent never reuses the email for a retry', async ({ extension, prepare }) => {
  await prepare()
  const bodies: Array<Record<string, unknown>> = []
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot('none') }))
  await extension.context.route('https://api.streampulse.stream/v1/account/restores', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    bodies.push(body)
    return body.email ? route.abort('failed') : route.fulfill({ status: 404, json: { error: 'restore_request_not_found' } })
  })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  expect((await workerRestore(page)).restore.state).toBe('uncertain')
  const checked = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'check' }))
  expect(checked.restore.state).toBe('error')
  expect(bodies).toEqual([{ restoreKey: expect.any(String), email: 'payer@example.test' }, { restoreKey: bodies[0].restoreKey }])
})

test('lost Checkout response recovers on explicit check without a second provider navigation', async ({ extension, prepare }) => {
  await prepare()
  let posts = 0
  const tabs = await recordTabs(extension.serviceWorker)
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot('none') }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/checkout', route => {
    posts++
    expect(route.request().headers().authorization).toBe(`Bearer ${credential().token}`)
    return posts === 1 ? route.abort('failed') : route.fulfill({ json: { attemptId: ATTEMPT, url: 'https://checkout.stripe.com/c/pay/recovered-fixture#fidkdWx-local', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } })
  })
  await extension.context.route(`https://api.streampulse.stream/v1/billing/checkout/${ATTEMPT}`, route => route.fulfill({ json: { attemptId: ATTEMPT, state: 'open', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } }))
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await workerCheckout(page)
  await expect(page.getByRole('button', { name: 'Check payment status', exact: true })).toBeVisible()
  expect(posts).toBe(1)
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click()
  await expect(page.locator('[data-journey-state="stripe-open"]')).toBeVisible()
  expect(posts).toBe(2)
  expect(await tabs()).toEqual([])
  await page.getByRole('button', { name: 'Return to Stripe checkout', exact: true }).click()
  await expect.poll(tabs).toEqual(['https://checkout.stripe.com/c/pay/recovered-fixture#fidkdWx-local'])
})

test('owned device list has an explicit peer-revocation confirmation', async ({ extension, prepare }) => {
  await prepare()
  const peer = '55555555-5555-4555-8555-555555555555'
  const revocations: unknown[] = []
  await extension.context.route('https://api.streampulse.stream/v1/account/installations', route => route.fulfill({ status: 201, json: credential() }))
  await extension.context.route('https://api.streampulse.stream/v1/billing/supporter', route => route.fulfill({ json: snapshot('active') }))
  await extension.context.route('https://api.streampulse.stream/v1/account/installations/devices', route => route.fulfill({ json: { currentDeviceId: credential().deviceId, devices: [{ id: credential().deviceId, label: 'Chrome extension', createdAt: new Date().toISOString(), expiresAt: credential().expiresAt }, { id: peer, label: 'Chrome extension', createdAt: new Date().toISOString(), expiresAt: credential().expiresAt }] } }))
  await extension.context.route('https://api.streampulse.stream/v1/account/installations/devices/revoke', route => { revocations.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }) })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  expect((await workerCheckout(page)).billing).toEqual({ state: 'active' })
  await expect(page.locator('[data-journey-state="active"]')).toBeVisible()
  await page.getByText('Connected extensions', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Revoke connection', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Revoke connection', exact: true }).click()
  expect(revocations).toEqual([])
  await page.getByRole('button', { name: 'Confirm revoke', exact: true }).click()
  await expect.poll(() => revocations).toEqual([{ deviceId: peer }])
})
