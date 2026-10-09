import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page, Worker } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { EXTENSION_DIST_DIR } from '../helpers/extensionContext.ts'

// §6/§7 evidence uses the actual packaged options page and worker. These are
// synthetic HTTP responses and worker-private persisted records, never a
// substitute page/DOM or proof of Stripe, mail, production, or owner Chrome.
const API = 'https://api.streampulse.stream'
const ACCOUNT = '11111111-1111-4111-8111-1111111a1b2c'
const DEVICE = '22222222-2222-4222-8222-222222222222'
const ATTEMPT = '33333333-3333-4333-8333-333333333333'
const RESTORE = '44444444-4444-4444-8444-444444444444'
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const CAPTURE_PHASE = process.env.SUPPORTER_STATE_CAPTURE_PHASE ?? 'after'
if (CAPTURE_PHASE !== 'before' && CAPTURE_PHASE !== 'after') throw new Error('SUPPORTER_STATE_CAPTURE_PHASE must be before or after')
type Status = 'none' | 'pending' | 'active' | 'grace' | 'expired' | 'review'
type StateCase = {
  name: string
  journey: string
  principal: string
  status?: Status
  billing?: 'waiting' | 'confirming' | 'still_confirming'
  restore?: 'pending' | 'expired' | 'conflict'
  setup?: 'unlinked' | 'preparing' | 'fallback' | 'revoked' | 'outage' | 'sandbox'
  checkoutEnabled?: boolean
  alias?: string
}
const CASES: StateCase[] = [
  { name: 'not-a-supporter', journey: 'signed-out', principal: 'Supporter details', setup: 'unlinked', alias: 'Twitch sign-in off (stage A): sign-ups are not open, so the signed-out page describes Supporter and offers no purchase.' },
  { name: 'checkout-closed', journey: 'checkout-closed', principal: 'Check sign-up status', status: 'none', checkoutEnabled: false },
  { name: 'preparing-checkout', journey: 'offer', principal: 'Preparing checkout…', status: 'none', setup: 'preparing', alias: 'Transient busy offer. The worker is awaiting the mocked checkout response; the disabled action prevents another request.' },
  { name: 'stripe-open', journey: 'stripe-open', principal: 'Return to Stripe checkout', status: 'none', billing: 'waiting' },
  { name: 'payment-confirming', journey: 'payment-pending', principal: 'Check payment status', status: 'pending', billing: 'confirming' },
  { name: 'still-confirming', journey: 'still-confirming', principal: 'Check payment status', status: 'none', billing: 'still_confirming' },
  { name: 'active', journey: 'active', principal: 'Manage subscription', status: 'active' },
  { name: 'scheduled-cancellation', journey: 'active', principal: 'Manage subscription', status: 'active', alias: 'Active + Access through the authoritative accessUntil. The extension projection has no cancellation-reason/cancelAt field; this image does not prove cancellation was scheduled.' },
  { name: 'grace', journey: 'grace', principal: 'Update payment method', status: 'grace' },
  { name: 'ended', journey: 'expired', principal: 'Rejoin Supporter', status: 'expired' },
  { name: 'review-dispute', journey: 'review', principal: 'Manage subscription', status: 'review', alias: 'Authoritative review status. The snapshot exposes no dispute-reason field, so this does not prove a dispute.' },
  { name: 'refunded', journey: 'expired', principal: 'Rejoin Supporter', status: 'expired', alias: 'Expired is the only supported inactive projection. No refund-reason field exists; this image does not prove a refund and must not be labelled a distinct refunded UI.' },
  { name: 'tester-connect', journey: 'link-pending', principal: 'Reopen streampulse.stream', setup: 'fallback', alias: 'Invited-tester device link from the closed disclosure. No installation account is created.' },
  { name: 'service-outage', journey: 'membership-unknown', principal: 'Check again', status: 'none', setup: 'outage' },
  { name: 'sandbox-live-mismatch', journey: 'membership-unknown', principal: 'Check again', status: 'active', setup: 'sandbox' },
  { name: 'revoked-installation', journey: 'signed-out', principal: 'Supporter details', status: 'active', setup: 'revoked', alias: 'A connection that ended without the user choosing it is explained; no email restore or new payment is offered.' },
]
const VIEWS = [
  { width: 320, height: 900, label: '320', basis: 'extension narrow viewport' },
  { width: 360, height: 900, label: '360', basis: 'extension narrow viewport' },
  { width: 380, height: 900, label: '380', basis: 'extension narrow viewport' },
  { width: 1280, height: 900, label: 'desktop-100', basis: '1280×900 CSS viewport; 100% reflow equivalent' },
  { width: 1024, height: 720, label: 'desktop-125', basis: '1280×900 divided by 1.25; CSS reflow equivalent, not native browser zoom' },
  { width: 853, height: 600, label: 'desktop-150', basis: '1280×900 divided by 1.5; CSS reflow equivalent, not native browser zoom' },
  { width: 640, height: 450, label: 'desktop-200', basis: '1280×900 divided by 2; CSS reflow equivalent, not native browser zoom' },
]
const credential = () => ({ kind: 'linked', accountId: ACCOUNT, deviceId: DEVICE, token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), refreshExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString() })
function snapshot(state: StateCase) {
  const paid = state.status === 'active' || state.status === 'grace'
  return {
    schemaVersion: 1, accountId: ACCOUNT, environment: state.setup === 'sandbox' ? 'sandbox' : 'live', revision: 1,
    status: state.status ?? 'none', checkoutEnabled: state.checkoutEnabled !== false,
    accountKind: 'installation', installationAccountsEnabled: true, restoreEligible: state.status === 'none',
    serverTime: new Date().toISOString(), accessFrom: new Date(Date.now() - 60_000).toISOString(),
    accessUntil: new Date(Date.now() + 28 * 86_400_000).toISOString(), cacheUntil: new Date(Date.now() + 300_000).toISOString(),
    supportPeriods: paid ? 1 : 0,
    features: { 'supporter.banner.v1': paid, 'supporter.finish.v1': paid, 'supporter.recognition.v1': paid, 'supporter.chat_badge.v1': paid },
    cosmetics: { enabled: false, finish: 'glass' },
  }
}
async function seedPrivate(worker: Worker, state: StateCase) {
  const account = state.setup === 'unlinked' || state.setup === 'fallback' ? null : credential()
  const journey: Record<string, unknown> = {}
  if (state.billing) journey.billing = { accountId: ACCOUNT, attemptId: ATTEMPT, phase: state.billing === 'waiting' ? 'waiting' : 'confirming', until: Date.now() + 24 * 60 * 60_000, watchUntil: Date.now() + (state.billing === 'still_confirming' ? -1000 : 30 * 60_000), nextPoll: 0, url: 'https://checkout.stripe.com/c/pay/cs_test_state_fixture' }
  if (state.restore) journey.restore = { accountId: ACCOUNT, restoreId: RESTORE, secret: 'c'.repeat(64), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), comparisonCode: 'A3B4C5', nextPoll: 0, interval: 60_000 }
  await worker.evaluate(async ({ account, journey, api }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pulse-account-private-v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('account')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('account', 'readwrite'), store = tx.objectStore('account')
        if (account) store.put(account, api)
        else store.delete(api)
        store.put(journey, 'supporter-pay-first')
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }, { account, journey, api: API })
}
async function privateRestoreAuthority(worker: Worker) {
  return worker.evaluate(async api => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('pulse-account-private-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      const tx = db.transaction('account'), store = tx.objectStore('account')
      const read = (key: string) => new Promise<Record<string, unknown>>((resolve, reject) => { const request = store.get(key); request.onsuccess = () => resolve(request.result ?? {}); request.onerror = () => reject(request.error) })
      const [account, journey] = await Promise.all([read(api), read('supporter-pay-first')])
      const restore = (journey.restore ?? {}) as Record<string, unknown>
      const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      return {
        accountId: account.accountId, deviceId: account.deviceId,
        accountCredentialHash: await hash({ token: account.token, refreshToken: account.refreshToken, expiresAt: account.expiresAt, refreshExpiresAt: account.refreshExpiresAt }),
        restoreAccountId: restore.accountId, restoreId: restore.restoreId, comparisonCode: restore.comparisonCode, expiresAt: restore.expiresAt, nextPoll: restore.nextPoll,
        restoreAuthorityHash: await hash({ accountId: restore.accountId, restoreId: restore.restoreId, secret: restore.secret, expiresAt: restore.expiresAt, comparisonCode: restore.comparisonCode }),
      }
    } finally { db.close() }
  }, API)
}
function digest(file: string) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function packageIdentity() {
  const marker = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIST_DIR, 'extension-target.json'), 'utf8')) as { target: string; buildId?: string; version: string }
  const provenancePath = process.env.SUPPORTER_STATE_CAPTURE_PROVENANCE ?? path.join(SOURCE_ROOT, '.artifacts/extension-build-provenance.json')
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8')) as { buildId: string; packageBuildCommit: string; worktreeState: string; files: Record<string, string> }
  expect(provenance.buildId, 'package marker must match the selected local build provenance').toBe(marker.buildId)
  for (const [file, hash] of Object.entries(provenance.files)) expect(digest(path.join(EXTENSION_DIST_DIR, file)), `package integrity: ${file}`).toBe(hash)
  return { ...marker, dist: EXTENSION_DIST_DIR, provenancePath, provenanceSha256: digest(provenancePath), packageBuildCommit: provenance.packageBuildCommit, worktreeState: provenance.worktreeState, files: provenance.files }
}
async function keyboardReachable(page: Page, journey: Locator) {
  const count = await journey.locator('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary').evaluateAll(elements => elements.filter(element => element instanceof HTMLElement && element.checkVisibility() && element.tabIndex >= 0).length)
  const seen = new Set<number>()
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  // Genuine Tab traversal; no programmatic focus is counted as keyboard proof.
  for (let step = 0; step < 180 && seen.size < count; step++) {
    await page.keyboard.press('Tab')
    const index = await journey.evaluate(root => {
      const controls = [...root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary')].filter(element => element instanceof HTMLElement && element.checkVisibility() && element.tabIndex >= 0)
      return controls.indexOf(document.activeElement as Element)
    })
    if (index >= 0) seen.add(index)
  }
  expect(seen.size, 'all visible enabled Supporter controls must be reachable by Tab').toBe(count)
  return { controls: count, reached: seen.size }
}
async function layoutRequirements(page: Page, journey: Locator) {
  return page.evaluate(() => {
    const root = document.querySelector('.pulse-journey')!
    const controls = [...root.querySelectorAll('button, a[href], input, select, textarea, summary')].filter(element => element instanceof HTMLElement && element.checkVisibility())
    const targets = controls.map(element => {
      const bounds = element.getBoundingClientRect()
      return { name: element.getAttribute('aria-label') || element.textContent?.trim() || (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent?.trim() : '') || '', width: bounds.width, height: bounds.height }
    })
    const horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1 || root.scrollWidth > root.clientWidth + 1
    const animations = root.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && Number(animation.effect?.getComputedTiming().duration ?? 0) > 0).map(animation => {
      const effect = animation.effect as KeyframeEffect
      return { duration: effect.getComputedTiming().duration, iterations: effect.getTiming().iterations, properties: [...new Set(effect.getKeyframes().flatMap(frame => Object.keys(frame)))].filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)) }
    })
    // Color/focus feedback is not positional motion. The requirement is that
    // reduced-motion users get no running movement, resizing, or looping
    // emphasis, including when they hover/focus a real control.
    const motionProperties = /^(transform|translate|rotate|scale|left|right|top|bottom|width|height|minWidth|maxWidth|minHeight|maxHeight|margin.*|padding.*|backgroundPosition.*|offsetDistance)$/
    // A finite sub-millisecond transition is the conventional instant-style
    // reduced-motion fallback. It cannot display an intervening frame. A
    // looping animation still fails regardless of its period.
    const runningMotion = animations.filter(animation => animation.iterations === Infinity || Number(animation.duration) >= 1 && animation.properties.some(property => motionProperties.test(property)))
    return { horizontalOverflow, targets, animations, runningMotion, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }
  })
}

for (const state of CASES) {
  test(`§7 state evidence: ${state.name}`, async ({ extension, prepare }, info) => {
    test.setTimeout(100_000)
    await prepare()
    const identity = packageIdentity(), storeTarget = ['cws', 'edge', 'firefox'].includes(identity.target)
    const mismatchRepresentable = state.setup !== 'sandbox' || storeTarget
    const expectedJourney = mismatchRepresentable ? state.journey : 'active'
    const expectedPrincipal = mismatchRepresentable ? state.principal : 'Manage subscription'
    const membership = snapshot(state)
    const requests: Array<{ path: string; method: string; status: number }> = []
    let releaseCheckout: (() => void) | undefined
    const checkoutResponseGate = new Promise<void>(resolve => { releaseCheckout = resolve })
    let checkoutReached = false
    await extension.context.route(`${API}/v1/**`, async route => {
      const request = route.request(), url = new URL(request.url()), pathname = url.pathname
      if (!pathname.startsWith('/v1/account/') && !pathname.startsWith('/v1/billing/')) { await route.fallback(); return }
      if (pathname.startsWith('/v1/billing/') || pathname === '/v1/account/restores/poll') expect(request.headers().authorization).toBe(`Bearer ${credential().token}`)
      let status = 200, body: unknown = {}
      if (pathname === '/v1/billing/supporter') {
        status = state.setup === 'outage' ? 503 : state.setup === 'revoked' ? 401 : 200
        body = status === 200 ? membership : { error: status === 401 ? 'unauthorized' : 'temporarily_unavailable' }
      } else if (pathname === '/v1/account/installations') {
        status = state.setup === 'fallback' ? 404 : 201; body = status === 201 ? credential() : { error: 'not_found' }
      } else if (pathname === '/v1/billing/checkout') {
        checkoutReached = true
        if (state.setup === 'preparing') await checkoutResponseGate
        body = { attemptId: ATTEMPT, url: 'https://checkout.stripe.com/c/pay/cs_test_state_fixture', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
      } else if (pathname === `/v1/billing/checkout/${ATTEMPT}`) {
        body = { attemptId: ATTEMPT, state: state.billing === 'confirming' ? 'pending' : 'open' }
      } else if (pathname === '/v1/account/device-links') {
        status = 201; body = { pollingSecret: 'd'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), intervalSeconds: 60 }
      } else if (pathname === '/v1/account/device-links/poll') {
        body = { state: 'pending' }
      } else if (pathname === '/v1/account/restores/poll') {
        body = { state: state.restore === 'conflict' ? 'restore_conflict' : state.restore === 'expired' ? 'expired' : 'pending' }
      } else if (pathname === '/v1/account/devices') {
        body = { devices: [], currentDeviceId: DEVICE }
      } else { status = 404; body = { error: 'not_found' } }
      requests.push({ path: pathname, method: request.method(), status })
      await route.fulfill({ status, json: body })
    })
    await extension.context.route('https://streampulse.stream/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Resolver-blocked portal fixture</title>' }))
    // The standard launch helper additionally resolver-blocks the exact portal
    // and Stripe hosts. No provider tab is treated as a payment receipt.
    await seedPrivate(extension.serviceWorker, state)
    const page = extension.page
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    const journey = page.locator('.pulse-journey')
    if (state.setup === 'fallback') {
      await page.getByText('Invited tester? Connect this extension', { exact: true }).click()
      await page.getByRole('button', { name: 'Connect this extension', exact: true }).click()
    }
    if (state.setup === 'preparing') {
      await page.getByRole('button', { name: 'Become a Supporter', exact: true }).click()
      await expect.poll(() => checkoutReached).toBe(true)
    }
    try {
      await expect(journey).toHaveAttribute('data-journey-state', expectedJourney)
      const principal = journey.getByRole(/^(Reopen|Contact|Supporter details)/.test(expectedPrincipal) ? 'link' : 'button', { name: expectedPrincipal, exact: true })
      if (CAPTURE_PHASE === 'after') {
        await expect(principal).toHaveCount(1)
        await expect(principal).toBeVisible()
        await expect(journey.locator('.pulse-journey-primary')).toHaveCount(1)
        await expect(principal).toHaveClass(/pulse-journey-primary/)
        if (state.setup === 'preparing') await expect(principal).toBeDisabled()
        else await expect(principal).toBeEnabled()
      }
      // Sample only after the current phase's awaited assertions. Read all
      // fields in one browser evaluation so an asynchronous worker projection
      // cannot mix a former count with a later primary-class observation.
      const principalObservations = await principal.evaluateAll((controls, name) => {
        const root = document.querySelector('.pulse-journey')
        return {
          expectedName: name, matchingControls: controls.length,
          visualPrimaryCount: root?.querySelectorAll('.pulse-journey-primary').length ?? 0,
          matchingPrimaryClass: controls.length === 1 && controls[0].classList.contains('pulse-journey-primary'),
        }
      }, expectedPrincipal)
      const baselineGaps: string[] = []
      if (CAPTURE_PHASE === 'before') {
        // Baseline captures document old defects. Their successful execution
        // is evidence collection only, not a passing current acceptance check.
        if (principalObservations.matchingControls !== 1) baselineGaps.push(`Missing expected principal action: ${expectedPrincipal}`)
        if (principalObservations.visualPrimaryCount !== 1 || !principalObservations.matchingPrimaryClass) baselineGaps.push('No single visually primary expected action')
      } else {
        expect(principalObservations).toEqual({ expectedName: expectedPrincipal, matchingControls: 1, visualPrimaryCount: 1, matchingPrimaryClass: true })
      }
      if (state.billing === 'confirming' || state.billing === 'still_confirming') {
        await expect(journey).toContainText('Do not pay again')
        await expect(journey.getByRole('button', { name: /Become a Supporter|Rejoin|Start checkout again/ })).toHaveCount(0)
      }
      if (state.name === 'scheduled-cancellation') await expect(journey).toContainText('Access through')
      // The page never asks for an installation account or an email restore.
      expect(requests.some(request => request.path === '/v1/account/installations' || request.path === '/v1/account/restores')).toBe(false)
      if (state.setup === 'fallback') {
        expect(requests.some(request => request.path === '/v1/account/device-links' && request.status === 201)).toBe(true)
        expect(requests.some(request => request.path === '/v1/billing/checkout')).toBe(false)
      }
      if (state.setup === 'revoked') {
        expect(requests.some(request => request.path === '/v1/billing/supporter' && request.status === 401)).toBe(true)
        await expect(journey).toContainText('disconnected from your StreamPulse account')
        await expect(journey.getByRole('button', { name: /Become a Supporter|Restore my Supporter/ })).toHaveCount(0)
      }
      if (state.setup === 'sandbox' && storeTarget) await expect(journey).toContainText('Supporter is not open in this build yet')
      const views: Array<Record<string, unknown>> = []
      for (const view of VIEWS) {
        await page.setViewportSize({ width: view.width, height: view.height })
        await expect(journey).toHaveAttribute('data-journey-state', expectedJourney)
        const layout = await layoutRequirements(page, journey)
        expect(layout.horizontalOverflow, `${state.name} horizontal overflow at ${view.label}`).toBe(false)
        expect(layout.targets.filter(target => target.width < 44 || target.height < 44), `${state.name} controls below 44px at ${view.label}`).toEqual([])
        expect(layout.targets.filter(target => !target.name), `${state.name} unnamed controls at ${view.label}`).toEqual([])
        expect(layout.reducedMotion).toBe(true)
        expect(layout.runningMotion, `${state.name} motion continues with reduced motion`).toEqual([])
        const keyboard = view.width === 320 || view.label === 'desktop-100' ? await keyboardReachable(page, journey) : null
        const screenshot = info.outputPath(`state-${state.name}-${view.label}.png`)
        await journey.locator('..').screenshot({ path: screenshot, animations: 'disabled' })
        await info.attach(path.basename(screenshot), { path: screenshot, contentType: 'image/png' })
        views.push({ ...view, screenshot, sha256: digest(screenshot), layout, keyboard })
      }
      // Explicit checks reuse the pending requests and must never start another
      // checkout or another restore email. The existing journey specs cover
      // the real user activation paths for purchase and membership management.
      let pendingAction: Record<string, unknown> | null = null
      if (CAPTURE_PHASE === 'after' && (state.billing === 'confirming' || state.billing === 'still_confirming' || state.restore === 'pending')) {
        const checkoutPosts = requests.filter(request => request.path === '/v1/billing/checkout' && request.method === 'POST').length
        const ownedReads = () => requests.filter(request => request.path === `/v1/billing/checkout/${ATTEMPT}` && request.method === 'GET').length
        const ownedReadsBefore = ownedReads()
        const restorePolls = requests.filter(request => request.path === '/v1/account/restores/poll').length
        const otherPosts = requests.filter(request => request.method === 'POST' && request.path !== '/v1/account/restores/poll').length
        const authorityBefore = state.restore === 'pending' ? await privateRestoreAuthority(extension.serviceWorker) : null
        const navigationBefore = extension.context.pages().map(current => current.url()).sort()
        if (authorityBefore) {
          expect(authorityBefore.accountId).toBe(ACCOUNT)
          expect(authorityBefore.restoreAccountId).toBe(ACCOUNT)
          expect(authorityBefore.restoreId).toBe(RESTORE)
          expect(Number(authorityBefore.nextPoll)).toBeGreaterThan(Date.now())
        }
        await principal.click()
        if (state.restore === 'pending') {
          // A manual check also honors the server polling interval. It may
          // safely return the known pending projection without another HTTP
          // poll; it must never create another restore/email request.
          await expect(principal).toBeEnabled()
          await expect(journey).toHaveAttribute('data-journey-state', 'restore-pending')
          const projection = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_RESTORE', action: 'status' }))
          expect(projection).toMatchObject({ type: 'SUPPORTER_RESTORE', restore: { state: 'pending', comparisonCode: authorityBefore!.comparisonCode, expiresAt: authorityBefore!.expiresAt } })
          const authorityAfter = await privateRestoreAuthority(extension.serviceWorker)
          expect(authorityAfter).toEqual(authorityBefore)
          const pollsAfter = requests.filter(request => request.path === '/v1/account/restores/poll').length
          expect(pollsAfter, 'manual status check must honor the 60-second owned-request cooldown').toBe(restorePolls)
          expect(extension.context.pages().map(current => current.url()).sort()).toEqual(navigationBefore)
          expect(requests.filter(request => request.method === 'POST' && request.path !== '/v1/account/restores/poll').length).toBe(otherPosts)
          pendingAction = { action: expectedPrincipal, state: 'restore-pending', pollsBefore: restorePolls, pollsAfter, pollingIntervalHonored: true, sameOwnedProjection: projection.restore, authorityBefore, authorityAfter, noNewNavigation: true, noAdditionalStartEmailOrBillingPost: true }
        } else {
          // A stopped automatic watch may have made no initial owned read.
          // The manual action must read this attempt, rather than relying on
          // an earlier poll or creating another checkout.
          await expect.poll(ownedReads).toBeGreaterThan(ownedReadsBefore)
          pendingAction = { action: expectedPrincipal, state: expectedJourney, ownedReadsBefore, ownedReadsAfter: ownedReads(), noAdditionalCheckoutPosts: true }
        }
        expect(requests.filter(request => request.path === '/v1/billing/checkout' && request.method === 'POST').length).toBe(checkoutPosts)
        expect(requests.filter(request => request.path === '/v1/account/restores').length).toBe(0)
      }
      const metadata = {
        schema: 'supporter-packaged-state-evidence/v1', phase: CAPTURE_PHASE, name: state.name, capturedAt: new Date().toISOString(),
        proof: 'Local packaged extension; mocked HTTP + explicitly seeded worker-private continuity. No owner browser, preview, Stripe session, email delivery, or production proof.',
        package: identity, sourceHashes: { ...(CAPTURE_PHASE === 'after' ? { 'src/options/SupporterJourney.tsx': digest(path.join(SOURCE_ROOT, 'src/options/SupporterJourney.tsx')) } : {}), 'tests/e2e/specs/supporter-state-coverage.mocked.spec.ts': digest(fileURLToPath(import.meta.url)) },
        baselineGaps, principalObservations, acceptance: CAPTURE_PHASE === 'before' ? 'baseline observations, not a current acceptance result' : 'current requirements asserted',
        expectedJourney, principal: expectedPrincipal, alias: state.alias ?? null,
        coverage: mismatchRepresentable ? 'captured' : 'unproven-store-target-mismatch',
        limitation: mismatchRepresentable ? null : 'This development package accepts sandbox projections. The shown active state proves development acceptance, not a sandbox/live mismatch UI. Store packaging is release-gated; tests/supporterAccountCoordinator.test.ts covers the live-only projection policy.',
        fixtureSnapshot: requests.some(request => request.path === '/v1/billing/supporter' && request.status === 200) ? membership : null,
        continuity: { linkedCredentialsSeeded: state.setup !== 'unlinked' && state.setup !== 'fallback', billing: state.billing ?? null, restore: state.restore ?? null },
        pendingAction, requests, views,
      }
      const result = info.outputPath('state-metadata.json')
      fs.writeFileSync(result, `${JSON.stringify(metadata, null, 2)}\n`)
      await info.attach('state-metadata', { path: result, contentType: 'application/json' })
      if (!mismatchRepresentable) info.annotations.push({ type: 'unproven', description: metadata.limitation! })
    } finally { releaseCheckout?.() }
  })
}
