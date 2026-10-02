import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Only the test-managed local production preview is permitted. Every service
// request is intercepted; these fixtures never contact Stripe or a live API.
const EVIDENCE = process.env.SUPPORTER_WEBSITE_EVIDENCE
const PHASE = process.env.SUPPORTER_WEBSITE_PHASE === 'before' ? 'before' : 'after'
const WIDTHS = [1440, 1280, 1024, 853, 640, 390, 320]
const ATTEMPT = '12345678-1234-4234-8234-123456789abc'
const SECRET = 'a'.repeat(64) // Fabricated restore secret, never a real link.
const PRIMARY_SELECTOR = '.pulse-account-primary, .btn-primary'
test.use({ serviceWorkers: 'block' })

type State = {
  name: string
  path: string
  heading: string
  primary: string
  status?: string
  enabled?: boolean
  attemptState?: string
  setup?: 'checkout-reauth' | 'portal-reauth' | 'preparing' | 'restore-ready' | 'restore-confirmed' | 'restore-expired' | 'restore-conflict' | 'restore-unavailable' | 'restore-429' | 'restore-uncertain'
  snapshot?: Record<string, unknown>
}

const billing = (name: string, status: string, heading: string, primary: string, enabled?: boolean): State => ({ name, status, heading, primary, enabled, path: '/account/billing' })
const states: State[] = [
  { name: 'public-supporter', path: '/supporter', heading: 'Pulse Supporter', primary: 'Get the extension' },
  billing('billing-none-open', 'none', 'Become a Pulse Supporter', 'Continue to Stripe checkout', true),
  billing('billing-none-closed-false', 'none', 'Supporter sign-ups are not open yet', 'Refresh status', false),
  billing('billing-none-closed-missing', 'none', 'Supporter sign-ups are not open yet', 'Refresh status'),
  { ...billing('billing-cancelled-closed-false', 'none', 'Checkout cancelled', 'Refresh status', false), path: `/account/billing/return?attempt=${ATTEMPT}&cancelled=1`, attemptState: 'open' },
  { ...billing('billing-cancelled-closed-missing', 'none', 'Checkout cancelled', 'Refresh status'), path: `/account/billing/return?attempt=${ATTEMPT}&cancelled=1`, attemptState: 'open' },
  { ...billing('billing-confirming-initial', 'none', 'Confirming your payment', 'Check again', false), path: `/account/billing/return?attempt=${ATTEMPT}`, attemptState: 'pending' },
  billing('billing-membership-pending', 'pending', 'Confirming your payment', 'Check again', false),
  { ...billing('billing-welcome', 'active', 'You’re a Supporter', 'Manage membership', false), path: `/account/billing/return?attempt=${ATTEMPT}`, attemptState: 'active' },
  { ...billing('billing-reauth-checkout', 'none', 'Become a Pulse Supporter', 'Sign in again', true), setup: 'checkout-reauth' },
  { ...billing('billing-reauth-portal', 'active', 'Supporter active', 'Sign in again', false), setup: 'portal-reauth' },
  { ...billing('billing-preparing-hold', 'none', 'Become a Pulse Supporter', 'Opening Stripe…', true), setup: 'preparing' },
  billing('billing-active', 'active', 'Supporter active', 'Manage membership', false),
  billing('billing-grace', 'grace', 'Payment needs attention', 'Update payment method', false),
  billing('billing-expired-open', 'expired', 'Supporter ended', 'Rejoin Supporter', true),
  billing('billing-expired-closed', 'expired', 'Supporter ended', 'Billing history', false),
  billing('billing-review', 'review', 'Membership needs review', 'Manage membership', false),
  // The server projects cancellation/refunds into membership status. Extra
  // provider fields must never independently grant or invent entitlement.
  { ...billing('billing-cancellation-scheduled', 'active', 'Supporter active', 'Manage membership', false), snapshot: { cancelAtPeriodEnd: true, cancellationScheduled: true } },
  { ...billing('billing-refunded', 'expired', 'Supporter ended', 'Billing history', false), snapshot: { refunded: true } },
  { ...billing('billing-invalid-provider-alias', 'canceled', 'Billing status is unavailable right now', 'Check again', false) },
  { name: 'static-thanks', path: '/supporter/thanks?attempt=untrusted&success=1', heading: 'Return to your extension', primary: 'Help & support' },
  { name: 'static-cancelled', path: '/supporter/thanks?cancelled=1', heading: 'Return to your extension', primary: 'Help & support' },
  ...([
    ['ready', 'Restore your Supporter', 'Confirm restore'],
    ['confirmed', 'Restore confirmed', 'Help & support'],
    ['expired', 'This restore link is unavailable', 'Help & support'],
    ['conflict', 'These memberships cannot be combined', 'Contact billing support'],
    ['unavailable', 'Restore is unavailable right now', 'Try again'],
    ['429', 'Restore is unavailable right now', 'Try again'],
    ['uncertain', 'Check your extension for the result', 'Help & support'],
  ] as const).map(([kind, heading, primary]) => ({ name: `restore-${kind}`, path: `/account/restore#${SECRET}`, heading, primary, setup: `restore-${kind}` as State['setup'] })),
]

type RequestRecord = { state: string; width: number; method: string; url: string; body: unknown; disposition: string }
type Control = { id: string; tag: string; name: string; href: string | null; disabled: boolean; width: number; height: number; targetWidth: number; targetHeight: number; primary: boolean }
type RuntimeAnimation = { target: string; durationMs: number; iterations: string }
type Observation = { state: string; width: number; heading: string; ariaSnapshot: string; primaryNames: string[]; scrollWidth: number; viewport: number; controls: Control[]; tabReached: string[]; motion: { reduced: boolean; animated: RuntimeAnimation[]; settledAnimated: RuntimeAnimation[]; settledFrames: number; spinnerAnimations: string[]; primaryTransitions: string[] }; failures: string[]; screenshot?: string }

function persist(name: string, value: unknown) {
  if (!EVIDENCE) return
  const directory = join(EVIDENCE, PHASE)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n')
}

async function observe(page: Page, state: State, width: number): Promise<Observation> {
  const root = page.locator('#public-main')
  await expect(root.getByRole('heading', { name: state.heading, exact: true })).toBeVisible()
  const controls = await root.evaluate((element, primarySelector) => {
    const candidates = [...element.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[role="button"]')]
    return candidates.flatMap((control, index) => {
      const box = control.getBoundingClientRect()
      const css = getComputedStyle(control)
      if (!box.width || !box.height || css.display === 'none' || css.visibility === 'hidden') return []
      const label = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.closest('label') : null
      const target = (label || control).getBoundingClientRect()
      const id = `proof-control-${index}`
      control.dataset.proofControl = id
      const labelledBy = control.getAttribute('aria-labelledby')?.split(/\s+/).map(key => document.getElementById(key)?.textContent || '').join(' ')
      const name = (control.getAttribute('aria-label') || labelledBy || label?.textContent || control.textContent || control.getAttribute('title') || '').replace(/\s+/g, ' ').trim()
      return [{ id, tag: control.tagName.toLowerCase(), name, href: control.getAttribute('href'), disabled: control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true', width: box.width, height: box.height, targetWidth: target.width, targetHeight: target.height, primary: control.matches(primarySelector) }]
    })
  }, PRIMARY_SELECTOR) as Control[]
  // Traverse with actual Tab events, starting before the page's first control.
  // Programmatic focus is deliberately not counted as keyboard reachability.
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); document.body.setAttribute('tabindex', '-1'); document.body.focus() })
  const reached = new Set<string>()
  for (let step = 0; step < controls.length + 35; step++) {
    await page.keyboard.press('Tab')
    const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.proofControl)
    if (id) reached.add(id)
    if (controls.filter(control => !control.disabled).every(control => reached.has(control.id))) break
  }
  await page.evaluate(() => document.body.removeAttribute('tabindex'))
  const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }))
  const immediateMotion = await page.evaluate(primarySelector => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, animated: document.getAnimations().filter(animation => animation.playState === 'running').map(animation => {
    const effect = animation.effect as KeyframeEffect | null
    return { target: effect?.target instanceof Element ? String(effect.target.className) : animation.id, durationMs: Number(effect?.getTiming().duration) || 0, iterations: String(effect?.getTiming().iterations || 0) }
  }), spinnerAnimations: [...document.querySelectorAll('.pulse-account-spinner')].map(element => getComputedStyle(element).animationName), primaryTransitions: [...document.querySelectorAll(`#public-main ${primarySelector.split(',').join(', #public-main ')}`)].map(element => getComputedStyle(element).transitionDuration) }), PRIMARY_SELECTOR)
  // Probe again after two real render frames, so the global 0.01ms event-
  // preserving transition cannot be mistaken for continuing visible motion.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const settledAnimated = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').map(animation => {
    const effect = animation.effect as KeyframeEffect | null
    return { target: effect?.target instanceof Element ? String(effect.target.className) : animation.id, durationMs: Number(effect?.getTiming().duration) || 0, iterations: String(effect?.getTiming().iterations || 0) }
  }))
  const motion = { ...immediateMotion, settledAnimated, settledFrames: 2 }
  const failures: string[] = []
  if (geometry.scrollWidth > geometry.viewport) failures.push(`horizontal overflow ${geometry.scrollWidth} > ${geometry.viewport}`)
  for (const control of controls) {
    if (!control.name) failures.push(`${control.id} has no accessible name`)
    if (control.targetWidth < 43.9 || control.targetHeight < 43.9) failures.push(`${control.name || control.id} target ${control.targetWidth.toFixed(1)}×${control.targetHeight.toFixed(1)} is below 44×44`)
    if (!control.disabled && !reached.has(control.id)) failures.push(`${control.name || control.id} was not reached by Tab`)
  }
  // The established global reduced-motion rule uses 0.01ms to preserve events.
  // Record that transient animation, but reject visible/infinite motion.
  const moving = [...motion.animated, ...motion.settledAnimated].filter(animation => animation.durationMs > 1 || animation.iterations === 'Infinity')
  if (!motion.reduced || moving.length || motion.spinnerAnimations.some(name => name !== 'none')) failures.push(`reduced-motion runtime has ${moving.length} meaningful active animation(s)`)
  if (motion.primaryTransitions.some(duration => duration.split(',').some(part => Number.parseFloat(part) * (part.trim().endsWith('ms') ? 1 : 1000) > 1))) failures.push('reduced-motion primary transition exceeds 1ms')
  let screenshot: string | undefined
  if (EVIDENCE && [1440, 390].includes(width)) {
    screenshot = `${PHASE}/${state.name}-${width}.png`
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: join(EVIDENCE, screenshot), fullPage: true })
  }
  return { state: state.name, width, heading: state.heading, ariaSnapshot: await root.ariaSnapshot(), primaryNames: controls.filter(control => control.primary).map(control => control.name), ...geometry, controls, tabReached: [...reached], motion, failures, screenshot }
}

async function installFixtures(page: Page, state: State, width: number, requests: RequestRecord[], baseURL: string) {
  const origin = new URL(baseURL).origin
  let approvals = 0
  let mutations = 0
  let release: (() => void) | undefined
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) { requests.push({ state: state.name, width, method: request.method(), url: url.href, body: null, disposition: 'external-aborted' }); return route.abort() }
    if (!url.pathname.startsWith('/v1/')) return route.continue()
    let body: unknown = request.postDataJSON()
    if (body && typeof body === 'object' && 'secret' in body) body = { ...body as Record<string, unknown>, secret: '[fabricated test-only restore secret]' }
    requests.push({ state: state.name, width, method: request.method(), url: url.href, body, disposition: 'local-mocked' })
    if (url.pathname === '/v1/account/me') return route.fulfill({ json: { accountId: '11111111-1111-4111-8111-111111111111' } })
    if (url.pathname === '/v1/billing/supporter') return route.fulfill({ json: { schemaVersion: 1, status: state.status || 'none', checkoutEnabled: state.enabled, supportPeriods: 2, accessUntil: '2026-10-19T00:00:00Z', ...state.snapshot } })
    if (url.pathname === `/v1/billing/checkout/${ATTEMPT}`) return route.fulfill({ json: { state: state.attemptState || 'pending' } })
    if (['/v1/billing/checkout', '/v1/billing/portal'].includes(url.pathname) && request.method() === 'POST') {
      mutations++
      expect(request.postDataJSON()).toEqual({})
      if (state.setup === 'preparing') { await held; if (!page.isClosed()) await route.fulfill({ status: 503, json: { error: 'fixture_hold_released' } }).catch(() => {}); return }
      return route.fulfill({ status: 401, json: { error: 'reauth_required' } })
    }
    if (url.pathname === '/v1/account/restores/inspect') {
      expect(request.method()).toBe('POST')
      expect(request.postDataJSON()).toEqual({ secret: SECRET })
      if (state.setup === 'restore-expired') return route.fulfill({ status: 401, json: { error: 'restore_invalid_or_expired' } })
      if (state.setup === 'restore-conflict') return route.fulfill({ status: 409, json: { error: 'restore_conflict' } })
      if (state.setup === 'restore-unavailable') return route.fulfill({ status: 503, json: { error: 'unavailable' } })
      if (state.setup === 'restore-429') return route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { error: 'rate_limited' } })
      return route.fulfill({ json: { label: 'Chrome extension', comparisonCode: 'A4C8E2', expiresAt: new Date(Date.now() + 900_000).toISOString() } })
    }
    if (url.pathname === '/v1/account/restores/approve') {
      approvals++
      expect(request.postDataJSON()).toEqual({ secret: SECRET, confirmed: true })
      return state.setup === 'restore-uncertain' ? route.abort('timedout') : route.fulfill({ status: 204 })
    }
    return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
  })
  return { release: () => release?.(), approvals: () => approvals, mutations: () => mutations }
}

async function enterState(page: Page, state: State) {
  await page.goto(state.path)
  if (state.setup === 'checkout-reauth' || state.setup === 'portal-reauth' || state.setup === 'preparing') {
    await page.getByRole('button', { name: state.setup === 'portal-reauth' ? 'Manage membership' : 'Continue to Stripe checkout', exact: true }).click()
    await expect(page.getByRole(state.setup === 'preparing' ? 'button' : 'link', { name: state.setup === 'preparing' ? 'Opening Stripe…' : 'Sign in again', exact: true })).toBeVisible()
  }
  if (state.setup === 'restore-confirmed' || state.setup === 'restore-uncertain') {
    await page.getByRole('checkbox', { name: /code matches the extension/i }).check()
    await page.getByRole('button', { name: 'Confirm restore' }).click()
  }
  if (state.setup?.startsWith('restore-')) {
    await expect(page).toHaveURL(/\/account\/restore$/)
    expect(await page.content()).not.toContain(SECRET)
  }
}

test('closed billing has one emphasized existing refresh action', async ({ page, baseURL }) => {
  expect(new URL(baseURL!).port).toBe('4174')
  const state = states.find(candidate => candidate.name === 'billing-none-closed-false')!
  const fixture = await installFixtures(page, state, 1440, [], baseURL!)
  try {
    await page.goto(state.path)
    await expect(page.getByRole('heading', { name: state.heading, exact: true })).toBeVisible()
    const primary = page.locator('#public-main').locator(PRIMARY_SELECTOR)
    await expect(primary, 'closed billing must emphasize its existing read-only Refresh status action').toHaveCount(1)
    await expect(primary).toHaveText('Refresh status')
  } finally { fixture.release() }
})

test('website state matrix has one primary action, accessible controls and local request evidence', async ({ browser, baseURL }) => {
  test.setTimeout(600_000)
  expect(new URL(baseURL!).port).toBe('4174')
  const observations: Observation[] = []
  const requests: RequestRecord[] = []
  try {
    for (const state of states) {
      for (const width of WIDTHS) {
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 900 }, reducedMotion: 'reduce' })
        const page = await context.newPage()
        const fixture = await installFixtures(page, state, width, requests, baseURL!)
        try {
          await enterState(page, state)
          const observation = await observe(page, state, width)
          observations.push(observation)
          if (state.setup?.startsWith('restore-')) expect(fixture.approvals()).toBe(['restore-confirmed', 'restore-uncertain'].includes(state.setup) ? 1 : 0)
          if (state.name.startsWith('static-')) expect(requests.filter(request => request.state === state.name && request.width === width)).toEqual([])
          if (state.setup === 'preparing' || state.setup === 'checkout-reauth' || state.setup === 'portal-reauth') expect(fixture.mutations()).toBe(1)
          if (PHASE === 'after') {
            expect.soft(observation.primaryNames, `${state.name} at ${width}px primary`).toEqual([state.primary])
            expect.soft(observation.failures, `${state.name} at ${width}px a11y observations`).toEqual([])
            if (state.setup === 'preparing' || state.setup === 'restore-ready' || state.setup === 'restore-429') await expect(page.locator('#public-main').locator(PRIMARY_SELECTOR)).toBeDisabled()
            if (state.setup === 'checkout-reauth' || state.setup === 'portal-reauth') {
              await expect(page.getByRole('button', { name: /Continue to Stripe checkout|Manage membership|Refresh status/ })).toHaveCount(0)
              await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', /returnTo=/)
            }
          }
        } finally { fixture.release(); await context.close() }
      }
    }
    // Use the real browser clock for the natural bounded confirmation budget.
    // A single state reaches the slow view, then is audited at every width.
    const slow: State = { ...billing('billing-confirming-bounded-slow', 'none', 'Still confirming your payment', 'Check again', false), path: `/account/billing/return?attempt=${ATTEMPT}`, attemptState: 'pending' }
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const started = Date.now()
    const fixture = await installFixtures(page, slow, 1440, requests, baseURL!)
    try {
      await page.goto(slow.path)
      await expect(page.getByRole('heading', { name: slow.heading, exact: true })).toBeVisible({ timeout: 165_000 })
      persist('real-clock-confirmation.json', { elapsedMs: Date.now() - started, fakeClockInstalled: false, expectedBackoffSeconds: [2, 3, 5, 8, 13, 20, 30, 30, 30], observedReadRequests: requests.filter(request => request.state === slow.name) })
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        const observation = await observe(page, slow, width)
        observations.push(observation)
        if (PHASE === 'after') {
          expect.soft(observation.primaryNames, `slow confirming at ${width}px`).toEqual(['Check again'])
          expect.soft(observation.failures, `slow confirming at ${width}px a11y`).toEqual([])
        }
      }
      expect(fixture.mutations()).toBe(0)
    } finally { fixture.release(); await context.close() }
    // Eager shared artwork may attempt a remote resource. The context route
    // aborts every such request before transmission; no external route continues.
    expect(requests.filter(request => new URL(request.url).origin !== new URL(baseURL!).origin && request.disposition !== 'external-aborted')).toEqual([])
  } finally {
    persist('observations.json', observations)
    persist('requests.json', requests)
    persist('coverage.json', { phase: PHASE, states: [...states.map(state => state.name), 'billing-confirming-bounded-slow'], widths: WIDTHS, screenshotWidths: [1440, 390], observations: observations.length, failures: observations.flatMap(observation => observation.failures.map(failure => ({ state: observation.state, width: observation.width, failure }))), blockedExternalRequests: requests.filter(request => request.disposition === 'external-aborted'), transmittedExternalRequests: [] })
  }
})

test('supporter action links meet the 44px touch target at desktop and mobile widths', async ({ browser, baseURL }) => {
  const geometries: unknown[] = []
  for (const width of [1440, 390]) {
    for (const state of [states[0], states.find(candidate => candidate.name === 'billing-none-closed-false')!]) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const fixture = await installFixtures(page, state, width, [], baseURL!)
      try {
        await enterState(page, state)
        await expect(page.getByRole('heading', { name: state.heading, exact: true })).toBeVisible()
        const targets = await page.locator('#public-main a[href]').evaluateAll(elements => elements.map(element => {
          const box = element.getBoundingClientRect()
          return { name: element.textContent?.replace(/\s+/g, ' ').trim(), href: element.getAttribute('href'), className: element.className, parentClass: element.parentElement?.className, width: box.width, height: box.height }
        }))
        geometries.push({ state: state.name, width, targets })
        persist('touch-target-geometries.json', geometries)
        for (const target of targets) {
          expect.soft(target.height, `${state.name} ${width}px ${target.name} (${target.className || target.parentClass}) touch height`).toBeGreaterThanOrEqual(44)
          expect.soft(target.width, `${state.name} ${width}px ${target.name} touch width`).toBeGreaterThanOrEqual(44)
        }
      } finally { fixture.release(); await context.close() }
    }
  }
})

test('confirming action respects real Retry-After and in-flight reads without starting checkout', async ({ browser, baseURL }) => {
  expect(new URL(baseURL!).port).toBe('4174')
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const state = { ...billing('billing-confirming-retry-after', 'pending', 'Confirming your payment', 'Check again', false) }
    const requests: RequestRecord[] = []
    const fixture = await installFixtures(page, state, width, requests, baseURL!)
    let reads = 0
    let release: (() => void) | undefined
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/v1/billing/supporter', async route => {
      reads++
      requests.push({ state: state.name, width, method: route.request().method(), url: route.request().url(), body: null, disposition: 'local-mocked' })
      if (reads === 1) return route.fulfill({ json: { schemaVersion: 1, status: 'pending', checkoutEnabled: false } })
      if (reads === 2) { await held; return route.fulfill({ status: 429, headers: { 'Retry-After': '2' }, json: { error: 'rate_limited' } }) }
      return route.fulfill({ json: { schemaVersion: 1, status: 'pending', checkoutEnabled: false } })
    })
    try {
      await page.goto(state.path)
      const primary = page.locator('#public-main .pulse-account-primary')
      await expect(primary).toHaveText('Check again')
      await primary.click()
      await expect(primary).toHaveText('Checking…')
      await expect(primary).toBeDisabled()
      expect(reads).toBe(2)
      if (EVIDENCE) await page.screenshot({ path: join(EVIDENCE, `after/billing-confirming-in-flight-${width}.png`), fullPage: true })
      release?.()
      await expect(primary).toHaveText('Check again')
      await expect(primary).toBeDisabled()
      const receivedAt = Date.now()
      await expect(primary).toBeEnabled({ timeout: 5000 })
      expect(Date.now() - receivedAt).toBeGreaterThanOrEqual(1700)
      expect(fixture.mutations()).toBe(0)
      expect(requests.filter(request => request.method !== 'GET')).toEqual([])
      persist(`retry-after-${width}.json`, { realClock: true, readRequests: reads, requests, durationMs: Date.now() - receivedAt })
    } finally { release?.(); fixture.release(); await context.close() }
  }
})
