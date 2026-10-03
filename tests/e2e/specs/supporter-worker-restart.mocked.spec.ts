import { test as base, expect } from '../helpers/testFixtures.ts'
import type { BrowserContext, CDPSession, Route, TestInfo, Worker } from '@playwright/test'
import { chromium } from '@playwright/test'
import { closeExtensionContext, extensionIdFromWorker, EXTENSION_DIST_DIR, waitForExtensionServiceWorker } from '../helpers/extensionContext.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Spec-local launch override: application hosts are DNS-blocked before the
// first worker can execute. Route fulfill serves fixture responses locally.
// No shared launch helper or owner Chrome profile is changed.
const test = base.extend({
  extension: async ({}, use, info) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-worker-restart-e2e-'))
    const videoDir = info.outputPath('disposable-videos')
    fs.mkdirSync(videoDir, { recursive: true })
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${EXTENSION_DIST_DIR}`, `--load-extension=${EXTENSION_DIST_DIR}`,
        '--disable-blink-features=AutomationControlled', '--host-resolver-rules=MAP * ~NOTFOUND'],
      viewport: { width: 1440, height: 900 }, recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    })
    const serviceWorker = await waitForExtensionServiceWorker(context)
    const launched = { context, page: context.pages()[0] ?? await context.newPage(), userDataDir,
      extensionId: extensionIdFromWorker(serviceWorker), serviceWorker, videoDir }
    try { await use(launched) }
    finally { await closeExtensionContext(launched, { retainVideoDir: true }) }
  },
})

// All credentials and IDs in this file are synthetic, disposable-profile fixtures.
const API = 'https://api.streampulse.stream'
const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const RESTORED_ACCOUNT = '55555555-5555-4555-8555-555555555555'
const DEVICE = '22222222-2222-4222-8222-222222222222'
const ATTEMPT = '33333333-3333-4333-8333-333333333333'
const RESTORE = '44444444-4444-4444-8444-444444444444'
const TOKEN = 'a'.repeat(64)
const RESTORED_TOKEN = 'd'.repeat(64)
const SECRET = 'c'.repeat(64)
const COOLDOWN_SECONDS = 8
const STOP_PROOF_MS = 11_000 // More than two real five-second watcher ticks.
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const credentials = (accountId = ACCOUNT, token = TOKEN) => ({ accountId, token,
  refreshToken: 'b'.repeat(64), deviceId: DEVICE,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 172_800_000).toISOString() })
function membership(active = false, cosmetics = { enabled: false, finish: 'glass' }) {
  return { schemaVersion: 1, accountId: ACCOUNT, environment: 'live', revision: active ? 2 : 1,
    status: active ? 'active' : 'none', checkoutEnabled: true, installationAccountsEnabled: true,
    accountKind: 'installation', restoreEligible: !active, serverTime: new Date().toISOString(),
    accessFrom: new Date(Date.now() - 60_000).toISOString(),
    accessUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    cacheUntil: new Date(Date.now() + 60_000).toISOString(), supportPeriods: active ? 1 : 0,
    features: { 'supporter.banner.v1': active, 'supporter.finish.v1': active, 'supporter.recognition.v1': active }, cosmetics }
}
type Call = { at: number; method: string; path: string; fixtureBearer: string | null; body: unknown; responseStatus?: number; responseAt?: number }
type Version = { versionId: string; registrationId: string; scriptURL: string; runningStatus: string }
type Registration = { registrationId: string; scopeURL: string }
type Trace = { startedAt: number; calls: Call[]; blockedExternal: Array<{ at: number; host: string; path: string; method: string; disposition: string }>; lifecycle: unknown[]; checks: Record<string, unknown> }
type WorkerExecution = { evaluate<T>(fn: () => T | Promise<T>): Promise<T> }
function output(info: TestInfo, trace: Trace) {
  fs.writeFileSync(info.outputPath('worker-restart-observations.json'), `${JSON.stringify(trace, null, 2)}\n`)
}
function assertApiCovered(trace: Trace) {
  // A duplicate write cannot disappear from the counts by hitting the deny rule.
  expect(trace.blockedExternal.filter(entry => entry.disposition === 'blocked-unhandled-API')).toEqual([])
}
function call(route: Route, trace: Trace, bearer: string | null = TOKEN): Call {
  const request = route.request()
  expect(request.headers().cookie).toBeUndefined()
  expect(request.headers().authorization ?? null).toBe(bearer ? `Bearer ${bearer}` : null)
  const entry: Call = { at: Date.now(), method: request.method(), path: new URL(request.url()).pathname,
    fixtureBearer: bearer === TOKEN ? 'waiting-installation' : bearer === RESTORED_TOKEN ? 'restored-installation' : null,
    body: request.postData() ? request.postDataJSON() : null }
  trace.calls.push(entry)
  return entry
}
async function respond(route: Route, entry: Call, json: unknown, status = 200, retryAfter?: number) {
  await route.fulfill({ status, json, ...(retryAfter ? { headers: { 'Retry-After': String(retryAfter) } } : {}) })
  entry.responseStatus = status
  entry.responseAt = Date.now()
}
async function guard(context: BrowserContext, trace: Trace) {
  // Every non-API HTTPS request is aborted locally, even a worker-created Stripe tab.
  // The shared launcher additionally DNS-blocks exact portal/Stripe destinations.
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url())
    trace.blockedExternal.push({ at: Date.now(), host: url.hostname, path: url.pathname, method: route.request().method(),
      disposition: url.origin === API ? 'blocked-unhandled-API' : 'blocked-external' })
    await route.abort('blockedbyclient')
  })
  // Options probes health separately from the account journey. Make that known
  // read explicit rather than allow fallback to an unbounded API handler.
  await context.route(`${API}/v1/extension/health`, async route => {
    const entry = call(route, trace, null)
    expect(entry.method).toBe('GET')
    await respond(route, entry, JSON.parse(fs.readFileSync(new URL('../fixtures/api/health-ok.json', import.meta.url), 'utf8')))
  })
}
async function privateState(worker: WorkerExecution) {
  return worker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pulse-account-private-v1', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = reject
    })
    try {
      const get = (key: string) => new Promise<any>((resolve, reject) => {
        const request = db.transaction('account').objectStore('account').get(key)
        request.onsuccess = () => resolve(request.result); request.onerror = reject
      })
      const journey = await get('supporter-pay-first'), account = await get('https://api.streampulse.stream')
      // No bearer, refresh secret, polling secret or Checkout URL leaves this read.
      return { billing: journey?.billing ? { accountId: journey.billing.accountId, attemptId: journey.billing.attemptId,
        nextPoll: journey.billing.nextPoll, until: journey.billing.until } : null,
        billingRetryUntil: journey?.billingRetryUntil ?? null,
        restore: journey?.restore ? { accountId: journey.restore.accountId, restoreId: journey.restore.restoreId,
          nextPoll: journey.restore.nextPoll, expiresAt: journey.restore.expiresAt } : null,
        restoreResult: journey?.restoreResult ?? null, accountId: account?.accountId ?? null,
        restoredTokenMatches: account?.token === 'd'.repeat(64), finishIntentPresent: Boolean(await get('supporter-finish-intent')),
        revisions: await chrome.storage.local.get(['pulseAccountRevision', 'pulseSupporterRevision']) }
    } finally { db.close() }
  })
}
async function targetRuntime(cdp: CDPSession, targetId: string, trace: Trace) {
  let sessionId = '', counter = 0
  const contexts = new Map<number, { id: number; uniqueId: string; auxData?: { isDefault?: boolean } }>()
  const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const receive = (event: { sessionId: string; message: string }) => {
    if (event.sessionId !== sessionId) return
    const message = JSON.parse(event.message)
    if (message.id) {
      const request = pending.get(message.id)
      if (request) {
        pending.delete(message.id); clearTimeout(request.timer)
        if (message.error) request.reject(new Error(message.error.message))
        else request.resolve(message.result)
      }
    } else if (message.method === 'Runtime.executionContextCreated') {
      const context = message.params.context
      contexts.set(context.id, context)
      trace.lifecycle.push({ at: Date.now(), event: 'execution-context-created', targetId, sessionId,
        id: context.id, uniqueId: context.uniqueId })
    } else if (message.method === 'Runtime.executionContextDestroyed') {
      contexts.delete(message.params.executionContextId)
      trace.lifecycle.push({ at: Date.now(), event: 'execution-context-destroyed', targetId,
        executionContextId: message.params.executionContextId, uniqueId: message.params.executionContextUniqueId })
    } else if (message.method === 'Runtime.executionContextsCleared') {
      contexts.clear()
      trace.lifecycle.push({ at: Date.now(), event: 'execution-contexts-cleared', targetId, sessionId })
    }
  }
  cdp.on('Target.receivedMessageFromTarget', receive)
  sessionId = (await cdp.send('Target.attachToTarget', { targetId, flatten: false })).sessionId
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    const id = ++counter
    const result = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Disposable worker CDP timeout: ${method}`)) }, 15_000)
      pending.set(id, { resolve, reject, timer })
    })
    try {
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
    } catch (error) {
      const request = pending.get(id)
      if (request) { clearTimeout(request.timer); pending.delete(id) }
      throw error
    }
    return result
  }
  await send('Runtime.enable')
  await expect.poll(() => [...contexts.values()].find(context => context.auxData?.isDefault !== false)).toBeTruthy()
  const executionContext = [...contexts.values()].find(context => context.auxData?.isDefault !== false)!
  expect(executionContext.uniqueId).toBeTruthy()
  const worker: WorkerExecution = { async evaluate<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})()`,
      contextId: executionContext.id, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value as T
  } }
  const detach = async () => {
    cdp.off('Target.receivedMessageFromTarget', receive)
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  }
  const evaluateInUniqueContext = (uniqueContextId: string) => send('Runtime.evaluate', {
    expression: 'true', uniqueContextId, returnByValue: true })
  return { worker, executionContext, detach, evaluateInUniqueContext }
}
async function restart(context: BrowserContext, page: import('@playwright/test').Page, old: Worker, trace: Trace): Promise<{ worker: WorkerExecution; cdp: CDPSession }> {
  const cdp = await context.newCDPSession(page)
  const versions = new Map<string, Version>(), registrations = new Map<string, Registration>()
  cdp.on('ServiceWorker.workerVersionUpdated', event => {
    for (const version of event.versions as Version[]) {
      versions.set(version.versionId, version)
      if (version.scriptURL === old.url()) trace.lifecycle.push({ at: Date.now(), event: 'version', ...version })
    }
  })
  cdp.on('ServiceWorker.workerRegistrationUpdated', event => {
    for (const registration of event.registrations as Registration[]) registrations.set(registration.registrationId, registration)
  })
  await cdp.send('ServiceWorker.enable')
  await expect.poll(() => [...versions.values()].find(value => value.scriptURL === old.url() && value.runningStatus === 'running')).toBeTruthy()
  const version = [...versions.values()].find(value => value.scriptURL === old.url() && value.runningStatus === 'running')!
  const targets = await cdp.send('Target.getTargets')
  const oldTarget = targets.targetInfos.find((target: { type: string; url: string }) => target.type === 'service_worker' && target.url === old.url())
  expect(oldTarget).toBeTruthy()
  if (!oldTarget) throw new Error('Packaged worker target is missing')
  const marker = await old.evaluate(() => {
    const root = globalThis as unknown as { __restartExecutionMarker?: string }
    root.__restartExecutionMarker = crypto.randomUUID()
    return root.__restartExecutionMarker
  })
  const oldRuntime = await targetRuntime(cdp, oldTarget.targetId, trace)
  let closedAt = 0
  old.once('close', () => { closedAt = Date.now() })
  trace.lifecycle.push({ at: Date.now(), event: 'stop-command', targetId: oldTarget.targetId, versionId: version.versionId, marker })
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId })
  await expect.poll(() => versions.get(version.versionId)?.runningStatus).toBe('stopped')
  // Chromium can retain a stopped extension debugger target. Explicitly remove
  // that disposable target too; never infer a restart from the Playwright handle.
  const stoppedTargets = (await cdp.send('Target.getTargets')).targetInfos
  if (stoppedTargets.some((target: { targetId: string }) => target.targetId === oldTarget.targetId)) {
    const result = await cdp.send('Target.closeTarget', { targetId: oldTarget.targetId })
    expect(result.success).toBe(true)
    trace.lifecycle.push({ at: Date.now(), event: 'stopped-debugger-target-closed', targetId: oldTarget.targetId })
  }
  await expect.poll(async () => (await cdp.send('Target.getTargets')).targetInfos.some((target: { targetId: string }) => target.targetId === oldTarget.targetId)).toBe(false)
  trace.lifecycle.push({ at: Date.now(), event: 'old-worker-stopped-and-target-removed', playwrightCloseNotifiedAt: closedAt || null })
  await oldRuntime.detach()
  const scopeURL = registrations.get(version.registrationId)?.scopeURL
  expect(scopeURL).toBe(`chrome-extension://${new URL(old.url()).hostname}/`)
  if (!scopeURL) throw new Error('Packaged worker registration scope is missing')
  await cdp.send('ServiceWorker.startWorker', { scopeURL })
  await expect.poll(() => versions.get(version.versionId)?.runningStatus).toBe('running')
  const current = (await cdp.send('Target.getTargets')).targetInfos.find((target: { type: string; url: string }) => target.type === 'service_worker' && target.url === old.url())
  if (!current) throw new Error('New packaged worker target is missing')
  // Chromium reuses extension worker target IDs across stop/start. A changed
  // Runtime uniqueId and absent old global prove distinct execution instead.
  const fresh = await targetRuntime(cdp, current.targetId, trace)
  expect(fresh.executionContext.uniqueId).not.toBe(oldRuntime.executionContext.uniqueId)
  let refusal = ''
  try { await fresh.evaluateInUniqueContext(oldRuntime.executionContext.uniqueId) } catch (error) { refusal = String(error) }
  expect(refusal).toMatch(/Cannot find context|uniqueContextId.*not found|Cannot find execution context/)
  trace.lifecycle.push({ at: Date.now(), event: 'old-execution-evaluation-refused-after-restart',
    oldExecutionId: oldRuntime.executionContext.uniqueId, reason: refusal })
  const execution = await fresh.worker.evaluate(() => {
    const root = globalThis as unknown as { __restartExecutionMarker?: string }
    const inherited = root.__restartExecutionMarker ?? null
    root.__restartExecutionMarker = crypto.randomUUID()
    return { inherited, marker: root.__restartExecutionMarker }
  })
  expect(execution.inherited).toBeNull()
  expect(execution.marker).not.toBe(marker)
  expect(current?.targetId).toBeTruthy()
  trace.lifecycle.push({ at: Date.now(), event: 'new-worker-execution-started', targetId: current.targetId,
    targetIdReused: current.targetId === oldTarget.targetId, oldExecutionId: oldRuntime.executionContext.uniqueId,
    newExecutionId: fresh.executionContext.uniqueId, ...execution })
  return { worker: fresh.worker, cdp }
}
async function installation(context: BrowserContext, trace: Trace) {
  await context.route(`${API}/v1/account/installations`, async route => {
    const entry = call(route, trace, null)
    expect(entry.method).toBe('POST')
    expect(entry.body).toEqual({ installationKey: expect.stringMatching(/^[a-f0-9]{64}$/), label: 'StreamPulse extension' })
    // The fixture key is evidence of exact replay counts, not release authority.
    await respond(route, entry, credentials(), 201)
  })
}

test('a stopped packaged worker resumes Checkout cooldown and applies the chosen finish with Settings closed', async ({ extension, prepare }, info) => {
  test.setTimeout(90_000)
  await prepare()
  const trace: Trace = { startedAt: Date.now(), calls: [], blockedExternal: [], lifecycle: [], checks: {} }
  await extension.context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await guard(extension.context, trace)
    await installation(extension.context, trace)
    let paid = false, cosmetics = { enabled: false, finish: 'glass' }
    await extension.context.route(`${API}/v1/billing/supporter`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('GET')
      await respond(route, entry, membership(paid, cosmetics))
    })
    await extension.context.route(`${API}/v1/billing/checkout`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('POST'); expect(entry.body).toEqual({})
      await respond(route, entry, { attemptId: ATTEMPT, url: 'https://checkout.stripe.com/c/pay/cs_test_worker_restart_fixture',
        expiresAt: new Date(Date.now() + 600_000).toISOString() })
    })
    let throttled: Call | undefined
    await extension.context.route(`${API}/v1/billing/checkout/${ATTEMPT}`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('GET'); expect(entry.body).toBeNull()
      if (!throttled) { throttled = entry; await respond(route, entry, { error: 'rate_limited' }, 429, COOLDOWN_SECONDS) }
      else await respond(route, entry, { attemptId: ATTEMPT, state: paid ? 'active' : 'open' })
    })
    await extension.context.route(`${API}/v1/billing/cosmetics`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('POST')
      expect(entry.body).toEqual({ enabled: true, finish: 'halo' })
      cosmetics = entry.body as typeof cosmetics
      await respond(route, entry, cosmetics)
    })
    await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await extension.page.getByRole('group', { name: 'Accent finish' }).getByRole('radio', { name: 'Halo', exact: true }).check()
    await extension.page.getByRole('button', { name: 'Use Halo when Supporter starts', exact: true }).click()
    await extension.page.getByRole('button', { name: 'Become a Supporter', exact: true }).click()
    await expect(extension.page.locator('[data-journey-state="stripe-open"]')).toBeVisible()
    await extension.page.screenshot({ path: info.outputPath('before-worker-stop.png'), fullPage: true })
    await extension.page.goto('about:blank')
    for (const page of extension.context.pages()) if (page !== extension.page) await page.close()
    trace.checks.settingsClosedAt = Date.now()
    await expect.poll(() => throttled?.responseAt).toBeTruthy()
    await expect.poll(async () => (await privateState(extension.serviceWorker)).billingRetryUntil).toBeGreaterThan(throttled!.responseAt! + COOLDOWN_SECONDS * 1000 - 100)
    const stored = await privateState(extension.serviceWorker)
    expect(stored.billing).toMatchObject({ accountId: ACCOUNT, attemptId: ATTEMPT, nextPoll: stored.billingRetryUntil })
    trace.checks.persistedBeforeRestart = stored
    paid = true
    const fresh = await restart(extension.context, extension.page, extension.serviceWorker, trace)
    expect(extension.context.pages().every(page => !page.url().includes('/options/'))).toBe(true)
    const deadline = stored.billingRetryUntil!
    await pause(Math.max(0, deadline - Date.now() - 150))
    expect(trace.calls.filter(entry => entry.path === `/v1/billing/checkout/${ATTEMPT}`)).toHaveLength(1)
    await expect.poll(() => trace.calls.filter(entry => entry.path === '/v1/billing/cosmetics').length, { timeout: 20_000 }).toBe(1)
    const polls = trace.calls.filter(entry => entry.path === `/v1/billing/checkout/${ATTEMPT}`)
    expect(polls.length).toBeGreaterThanOrEqual(2)
    expect(polls[1].at).toBeGreaterThanOrEqual(deadline)
    const countAtCompletion = polls.length
    await pause(STOP_PROOF_MS)
    expect(trace.calls.filter(entry => entry.path === `/v1/billing/checkout/${ATTEMPT}`)).toHaveLength(countAtCompletion)
    const settled = await privateState(fresh.worker)
    expect(settled.billing).toBeNull(); expect(settled.finishIntentPresent).toBe(false)
    expect(settled.revisions.pulseSupporterRevision).not.toBe(stored.revisions.pulseSupporterRevision)
    expect(trace.calls.filter(entry => entry.path === '/v1/account/installations')).toHaveLength(1)
    expect(trace.calls.filter(entry => entry.path === '/v1/billing/checkout')).toHaveLength(1)
    trace.checks.settledWithoutSettings = settled
    trace.checks.cooldownDeadline = deadline
    await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await expect(extension.page.locator('[data-journey-state="active"]')).toBeVisible()
    await extension.page.screenshot({ path: info.outputPath('after-automatic-activation.png'), fullPage: true })
    assertApiCovered(trace)
    await fresh.cdp.detach()
  } finally {
    output(info, trace)
    await extension.context.tracing.stop({ path: info.outputPath('disposable-profile-trace.zip') })
  }
})

test('a stopped packaged worker resumes the exact private restore and respects its persisted cooldown', async ({ extension, prepare }, info) => {
  test.setTimeout(90_000)
  await prepare()
  const trace: Trace = { startedAt: Date.now(), calls: [], blockedExternal: [], lifecycle: [], checks: {} }
  await extension.context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await guard(extension.context, trace); await installation(extension.context, trace)
    let restored = false, approved = false
    await extension.context.route(`${API}/v1/billing/supporter`, async route => {
      const entry = call(route, trace, restored ? RESTORED_TOKEN : TOKEN)
      await respond(route, entry, { ...membership(restored), accountId: restored ? RESTORED_ACCOUNT : ACCOUNT })
    })
    await extension.context.route(`${API}/v1/account/restores`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('POST')
      expect(entry.body).toEqual({ restoreKey: expect.stringMatching(/^[a-f0-9]{64}$/), email: 'payer@example.test' })
      await respond(route, entry, { restoreId: RESTORE, pollingSecret: SECRET, comparisonCode: 'A1B2C3',
        expiresAt: new Date(Date.now() + 600_000).toISOString(), intervalSeconds: 5 }, 201)
    })
    let throttled: Call | undefined
    await extension.context.route(`${API}/v1/account/restores/poll`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('POST')
      expect(entry.body).toEqual({ restoreId: RESTORE, pollingSecret: SECRET })
      if (!throttled) { throttled = entry; await respond(route, entry, { error: 'rate_limited' }, 429, COOLDOWN_SECONDS) }
      else {
        if (approved) restored = true
        await respond(route, entry, approved ? { state: 'approved', ...credentials(RESTORED_ACCOUNT, RESTORED_TOKEN) } : { state: 'pending' })
      }
    })
    await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await extension.page.getByRole('button', { name: 'Restore my Supporter', exact: true }).click()
    await extension.page.getByRole('textbox', { name: 'Email used at checkout', exact: true }).fill('payer@example.test')
    await extension.page.getByRole('button', { name: 'Send restore link', exact: true }).click()
    await expect(extension.page.getByText('A1B2C3', { exact: true })).toBeVisible()
    await extension.page.screenshot({ path: info.outputPath('before-restore-worker-stop.png'), fullPage: true })
    await extension.page.goto('about:blank'); trace.checks.settingsClosedAt = Date.now()
    await expect.poll(() => throttled?.responseAt).toBeTruthy()
    await expect.poll(async () => (await privateState(extension.serviceWorker)).restore?.nextPoll).toBeGreaterThan(throttled!.responseAt! + COOLDOWN_SECONDS * 1000 - 100)
    const stored = await privateState(extension.serviceWorker)
    expect(stored.restore).toMatchObject({ accountId: ACCOUNT, restoreId: RESTORE })
    trace.checks.persistedBeforeRestart = stored
    const fresh = await restart(extension.context, extension.page, extension.serviceWorker, trace)
    approved = true
    const deadline = stored.restore!.nextPoll
    await pause(Math.max(0, deadline - Date.now() - 150))
    expect(trace.calls.filter(entry => entry.path === '/v1/account/restores/poll')).toHaveLength(1)
    await expect.poll(() => restored, { timeout: 20_000 }).toBe(true)
    // Node-side callback is the only observation while the new worker settles.
    await pause(STOP_PROOF_MS)
    const polls = trace.calls.filter(entry => entry.path === '/v1/account/restores/poll')
    expect(polls).toHaveLength(2); expect(polls[1].at).toBeGreaterThanOrEqual(deadline)
    const settled = await privateState(fresh.worker)
    expect(settled.restore).toBeNull(); expect(settled.restoreResult).toBe('restored')
    expect(settled.accountId).toBe(RESTORED_ACCOUNT); expect(settled.restoredTokenMatches).toBe(true)
    expect(settled.revisions.pulseAccountRevision).not.toBe(stored.revisions.pulseAccountRevision)
    expect(settled.revisions.pulseSupporterRevision).not.toBe(stored.revisions.pulseSupporterRevision)
    expect(trace.calls.filter(entry => entry.path === '/v1/account/installations')).toHaveLength(1)
    expect(trace.calls.filter(entry => entry.path === '/v1/account/restores')).toHaveLength(1)
    expect(trace.calls.filter(entry => entry.path === '/v1/billing/checkout')).toHaveLength(0)
    trace.checks.settledWithoutSettings = settled; trace.checks.cooldownDeadline = deadline
    assertApiCovered(trace)
    await fresh.cdp.detach()
  } finally {
    output(info, trace)
    await extension.context.tracing.stop({ path: info.outputPath('disposable-profile-trace.zip') })
  }
})

test('a restarted packaged worker stops a restore at its real fixture expiry without restarting the request', async ({ extension, prepare }, info) => {
  test.setTimeout(75_000)
  await prepare()
  const trace: Trace = { startedAt: Date.now(), calls: [], blockedExternal: [], lifecycle: [], checks: {} }
  await extension.context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await guard(extension.context, trace); await installation(extension.context, trace)
    await extension.context.route(`${API}/v1/billing/supporter`, async route => {
      const entry = call(route, trace); await respond(route, entry, membership())
    })
    let expiresAt = 0
    await extension.context.route(`${API}/v1/account/restores`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('POST')
      expiresAt = Date.now() + 14_000
      await respond(route, entry, { restoreId: RESTORE, pollingSecret: SECRET, comparisonCode: 'A1B2C3',
        expiresAt: new Date(expiresAt).toISOString(), intervalSeconds: 5 }, 201)
    })
    await extension.context.route(`${API}/v1/account/restores/poll`, async route => {
      const entry = call(route, trace); expect(entry.body).toEqual({ restoreId: RESTORE, pollingSecret: SECRET })
      await respond(route, entry, { state: 'pending' })
    })
    await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    // Extension-origin setup uses the actual worker message path; there is no real mail.
    const result = await extension.page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'start', email: 'payer@example.test' }))
    expect(result.restore.state).toBe('pending')
    await extension.page.goto('about:blank'); trace.checks.settingsClosedAt = Date.now()
    const stored = await privateState(extension.serviceWorker)
    expect(Date.parse(stored.restore!.expiresAt)).toBe(expiresAt)
    trace.checks.realFixtureExpiry = expiresAt; trace.checks.persistedBeforeRestart = stored
    const fresh = await restart(extension.context, extension.page, extension.serviceWorker, trace)
    await pause(Math.max(0, expiresAt - Date.now()) + STOP_PROOF_MS)
    const polls = trace.calls.filter(entry => entry.path === '/v1/account/restores/poll')
    expect(polls.length).toBeGreaterThan(0)
    expect(polls.every(entry => entry.at < expiresAt)).toBe(true)
    const settled = await privateState(fresh.worker)
    expect(settled.restore).toBeNull(); expect(settled.restoreResult).toBe('expired')
    const stopped = polls.length
    await pause(STOP_PROOF_MS)
    expect(trace.calls.filter(entry => entry.path === '/v1/account/restores/poll')).toHaveLength(stopped)
    expect(trace.calls.filter(entry => entry.path === '/v1/account/installations')).toHaveLength(1)
    expect(trace.calls.filter(entry => entry.path === '/v1/account/restores')).toHaveLength(1)
    expect(trace.calls.filter(entry => entry.path === '/v1/billing/checkout')).toHaveLength(0)
    trace.checks.settledWithoutSettings = settled
    assertApiCovered(trace)
    await fresh.cdp.detach()
  } finally {
    output(info, trace)
    await extension.context.tracing.stop({ path: info.outputPath('disposable-profile-trace.zip') })
  }
})

test('a restarted packaged worker bounds Checkout polling at real fixture expiry while retaining payment uncertainty', async ({ extension, prepare }, info) => {
  test.setTimeout(75_000)
  await prepare()
  const trace: Trace = { startedAt: Date.now(), calls: [], blockedExternal: [], lifecycle: [], checks: {} }
  await extension.context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await guard(extension.context, trace); await installation(extension.context, trace)
    await extension.context.route(`${API}/v1/billing/supporter`, async route => {
      const entry = call(route, trace); await respond(route, entry, membership())
    })
    let expiresAt = 0
    await extension.context.route(`${API}/v1/billing/checkout`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('POST'); expect(entry.body).toEqual({})
      // A recorded, short fixture lifetime exercises the boundary with the real
      // wall clock. It is not a claim about Stripe's supported session lifetime.
      expiresAt = Date.now() + 14_000
      await respond(route, entry, { attemptId: ATTEMPT,
        url: 'https://checkout.stripe.com/c/pay/cs_test_worker_expiry_fixture',
        expiresAt: new Date(expiresAt).toISOString() })
    })
    await extension.context.route(`${API}/v1/billing/checkout/${ATTEMPT}`, async route => {
      const entry = call(route, trace); expect(entry.method).toBe('GET'); expect(entry.body).toBeNull()
      // No terminal server proof is manufactured: the attempt remains open.
      await respond(route, entry, { attemptId: ATTEMPT, state: 'open' })
    })
    await extension.page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    await extension.page.getByRole('button', { name: 'Become a Supporter', exact: true }).click()
    await expect(extension.page.locator('[data-journey-state="stripe-open"]')).toBeVisible()
    await extension.page.screenshot({ path: info.outputPath('before-checkout-expiry-worker-stop.png'), fullPage: true })
    await extension.page.goto('about:blank')
    for (const page of extension.context.pages()) if (page !== extension.page) await page.close()
    trace.checks.settingsClosedAt = Date.now()
    await expect.poll(() => trace.calls.filter(entry => entry.path === `/v1/billing/checkout/${ATTEMPT}`).length).toBe(1)
    const stored = await privateState(extension.serviceWorker)
    expect(stored.billing?.until).toBe(expiresAt)
    trace.checks.realFixtureExpiry = expiresAt; trace.checks.persistedBeforeRestart = stored
    const fresh = await restart(extension.context, extension.page, extension.serviceWorker, trace)
    await pause(Math.max(0, expiresAt - Date.now()) + STOP_PROOF_MS)
    const polls = trace.calls.filter(entry => entry.path === `/v1/billing/checkout/${ATTEMPT}`)
    expect(polls.length).toBeGreaterThan(1)
    // The last watcher tick can straddle expiry; no more than one tick beyond
    // the boundary is expected, with a small scheduling margin for Chromium.
    expect(polls.every(entry => entry.at < expiresAt + 7_000)).toBe(true)
    const settled = await privateState(fresh.worker)
    expect(settled.billing).toMatchObject({ accountId: ACCOUNT, attemptId: ATTEMPT, until: expiresAt })
    const stopped = polls.length
    await pause(STOP_PROOF_MS)
    expect(trace.calls.filter(entry => entry.path === `/v1/billing/checkout/${ATTEMPT}`)).toHaveLength(stopped)
    expect(trace.calls.filter(entry => entry.path === '/v1/account/installations')).toHaveLength(1)
    expect(trace.calls.filter(entry => entry.path === '/v1/billing/checkout')).toHaveLength(1)
    expect(trace.calls.filter(entry => entry.path === '/v1/account/restores')).toHaveLength(0)
    trace.checks.settledWithoutSettings = settled
    trace.checks.paymentUncertaintyRetained = true
    assertApiCovered(trace)
    await fresh.cdp.detach()
  } finally {
    output(info, trace)
    await extension.context.tracing.stop({ path: info.outputPath('disposable-profile-trace.zip') })
  }
})
