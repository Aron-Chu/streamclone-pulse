import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  attachHubRequestTracker,
  auditOutputDir,
  writeCaptureArtifact,
} from './helpers/designAuditCapture'
import {
  attachHostedApiGuard,
  assertHostedApiOnly,
  clearBackendOverrides,
} from './helpers/hostedApi'
import { installHubUxMock } from './helpers/hubUxMock'
import {
  PORTAL_LOGIN,
  PORTAL_STREAM_ID,
  assertNoUnexpected,
  installPortalAcceptanceHarness,
} from './helpers/portalAcceptanceHarness'

/**
 * Deterministic analytics visual audit: the hub and one session page, both on local
 * mocks. It used to open a hosted July day, which failed once that day aged out of
 * the hosted retention window.
 */
const LOGIN = PORTAL_LOGIN
const STREAM_ID = PORTAL_STREAM_ID
const SESSION_PATH = `/analytics/${LOGIN}/${STREAM_ID}`

type EvidenceStep = {
  step: string
  hubStatus?: number
  poolSize?: number | null
  hubState?: string | null
  poolText?: string | null
  momentsSnippet?: string | null
  consoleErrors: string[]
  failedRequests: string[]
}

/** Any API read the mocks do not answer fails here; it never reaches the hosted API. Routes added later take precedence. */
async function blockUnmockedApi(page: Page): Promise<void> {
  await page.route('**/v1/**', (route) => route.fulfill({ status: 503, json: { error: 'unmocked_endpoint' } }))
}

/** Lets a hover or scroll paint before the next capture, without a fixed sleep. */
async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function collectDomEvidence(page: Page): Promise<Omit<EvidenceStep, 'step' | 'consoleErrors' | 'failedRequests'>> {
  return page.evaluate(() => {
    const main = document.querySelector('main[data-hub-state]')
    // Scope text is published by the hero after the pool loads.
    const pool = document.querySelector('.hv5-scope:not([data-wait])')
    const moments = document.querySelector('#top-moments')
    return {
      hubState: main?.getAttribute('data-hub-state') ?? null,
      poolText: pool?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      momentsSnippet: moments?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 220) ?? null,
    }
  })
}

/**
 * Opens the harness session and lets its staged enrichment land. The harness runs a fake
 * clock (as `openAnalyticsSession` does), so advance it rather than wait in real time.
 */
async function openSession(page: Page): Promise<void> {
  await page.goto(SESSION_PATH, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('region', { name: new RegExp(`Analytics for ${LOGIN}`, 'i') })).toBeVisible({ timeout: 30_000 })
  for (let i = 0; i < 3; i += 1) await page.clock.runFor(2_000)
}

test.describe('analytics design audit (deterministic capture)', () => {
  test.beforeEach(async ({ page }) => {
    await clearBackendOverrides(page)
  })

  test('hub broken→healthy sequence + visual matrix', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const violations = attachHostedApiGuard(page)
    await blockUnmockedApi(page)
    // Delay the hub so the first capture is the loading state, as on a slow phone.
    await installHubUxMock(page, { hubDelayMs: 1_200 })
    const outDir = auditOutputDir(testInfo, 'hub-sequence')
    const hubHits = attachHubRequestTracker(page)

    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.failure()?.errorText ?? 'fail'} ${req.url()}`)
    })

    await page.setViewportSize({ width: 1600, height: 1000 })

    const hubWait = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/v1/public/hub' && response.status() === 200,
      { timeout: 60_000 },
    )

    await page.goto('/analytics', { waitUntil: 'domcontentloaded' })

    // 01 — immediate first paint (may be loading / empty shell)
    await writeCaptureArtifact(page, outDir, '01-immediate-first-paint', {
      phase: 'loading',
      fixture: 'hub-delayed',
      interaction: 'fold',
      firstPaintHubRequests: [...hubHits],
    })
    const evidence: EvidenceStep[] = [
      {
        step: '01-immediate-first-paint',
        ...(await collectDomEvidence(page)),
        consoleErrors: [...consoleErrors],
        failedRequests: [...failedRequests],
      },
    ]

    const hubResponse = await hubWait
    const hubJson = (await hubResponse.json()) as { poolSize?: number }
    const poolSize = hubJson.poolSize ?? null
    expect(poolSize, 'the ready hub mock serves a pool').toBeGreaterThan(0)

    await writeCaptureArtifact(page, outDir, '02-after-hub-response', {
      phase: 'loading',
      fixture: 'hub-ready',
      interaction: 'fold',
    })
    evidence.push({
      step: '02-after-hub-response',
      hubStatus: hubResponse.status(),
      poolSize,
      ...(await collectDomEvidence(page)),
      consoleErrors: [...consoleErrors],
      failedRequests: [...failedRequests],
    })

    await page.locator('[data-hub-state="ready"], [data-hub-state="empty"]').first().waitFor({
      timeout: 60_000,
    })
    await expect(page.locator('.hv5-scope:not([data-wait])')).toContainText(poolSize!.toLocaleString('en-US'), { timeout: 45_000 })

    await writeCaptureArtifact(page, outDir, '03-after-ui-ready', {
      phase: 'ready',
      fixture: 'hub-ready',
      interaction: 'fold',
    })
    evidence.push({
      step: '03-after-ui-ready',
      hubStatus: hubResponse.status(),
      poolSize,
      ...(await collectDomEvidence(page)),
      consoleErrors: [...consoleErrors],
      failedRequests: [...failedRequests],
    })

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForFunction(() => window.scrollY > 8, null, { timeout: 10_000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 10_000 })
    await nextPaint(page)
    await writeCaptureArtifact(page, outDir, '04-after-scroll-return', {
      phase: 'ready',
      fixture: 'hub-ready',
      interaction: 'fold',
    })
    evidence.push({
      step: '04-after-scroll-return',
      hubStatus: hubResponse.status(),
      poolSize,
      ...(await collectDomEvidence(page)),
      consoleErrors: [...consoleErrors],
      failedRequests: [...failedRequests],
    })

    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2))

    // Fixed visual matrix (desktop)
    await writeCaptureArtifact(page, outDir, 'hub-1600-fold', { phase: 'ready', fixture: 'hub-ready', interaction: 'fold' })
    await writeCaptureArtifact(page, outDir, 'hub-1600-full', { phase: 'ready', fixture: 'hub-ready', interaction: 'full', fullPage: true })

    const activity = page.locator('.figma-global-activity, #section-network').first()
    if (await activity.count()) {
      await activity.screenshot({ path: path.join(outDir, 'hub-1600-live-activity.png') })
    }
    const moments = page.locator('#top-moments').first()
    if (await moments.count()) {
      await moments.screenshot({ path: path.join(outDir, 'hub-1600-top-moments.png') })
    }

    // Mobile fold + chart transition
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-hub-state="ready"], [data-hub-state="empty"]').first().waitFor({
      timeout: 60_000,
    })
    await writeCaptureArtifact(page, outDir, 'hub-390-fold', { phase: 'ready', fixture: 'hub-ready', interaction: 'fold' })
    await page.evaluate(() => {
      document.getElementById('section-network')?.scrollIntoView({ block: 'start' })
    })
    await nextPaint(page)
    await writeCaptureArtifact(page, outDir, 'hub-390-chart-transition', { phase: 'ready', fixture: 'hub-ready', interaction: 'fold' })

    // Ready state must not claim the hub is unavailable when the API returned a pool.
    const readyEvidence = evidence.find((e) => e.step === '03-after-ui-ready')
    expect(readyEvidence?.hubState).toBe('ready')
    expect(readyEvidence?.poolText ?? '').toContain(poolSize!.toLocaleString('en-US'))
    expect(readyEvidence?.momentsSnippet ?? '').not.toMatch(/hub unavailable/i)

    assertHostedApiOnly(violations)

    await testInfo.attach('hub-evidence', {
      path: path.join(outDir, 'evidence.json'),
      contentType: 'application/json',
    })
  })

  test('session visual matrix + chart crops', async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const outDir = auditOutputDir(testInfo, 'session-matrix')

    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    await clearBackendOverrides(page)
    const violations = attachHostedApiGuard(page)
    // The harness answers every API and media read from fixtures and blocks any other host.
    const harness = await installPortalAcceptanceHarness(page)

    await openSession(page)
    const chart = page.locator('[aria-label*="Analytics timeline chart"]').first()
    await expect(chart).toBeVisible({ timeout: 45_000 })
    await writeCaptureArtifact(page, outDir, 'session-1600-fold', { phase: 'ready', fixture: 'portal-acceptance-harness', interaction: 'fold' })

    const hiContext = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    })
    const hiPage = await hiContext.newPage()
    await clearBackendOverrides(hiPage)
    const hiViolations = attachHostedApiGuard(hiPage)
    const hiHarness = await installPortalAcceptanceHarness(hiPage)
    await openSession(hiPage)
    const hiChart = hiPage.locator('[aria-label*="Analytics timeline chart"]').first()
    await expect(hiChart).toBeVisible({ timeout: 45_000 })
    await hiChart.screenshot({ path: path.join(outDir, 'session-1600-chart.png') })

    const box = await hiChart.boundingBox()
    if (box) {
      // Hover mid / tall-bar region
      await hiPage.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.72)
      await nextPaint(hiPage)
      await hiChart.screenshot({ path: path.join(outDir, 'session-chart-hover-bar.png') })
      // Right edge
      await hiPage.mouse.move(box.x + box.width * 0.92, box.y + box.height * 0.55)
      await nextPaint(hiPage)
      await hiChart.screenshot({ path: path.join(outDir, 'session-chart-hover-right.png') })
    }

    assertHostedApiOnly(hiViolations)
    await assertNoUnexpected(hiHarness)
    await hiContext.close()

    await page.setViewportSize({ width: 390, height: 844 })
    await openSession(page)
    await writeCaptureArtifact(page, outDir, 'session-390-fold', { phase: 'ready', fixture: 'portal-acceptance-harness', interaction: 'fold' })
    const phoneChart = page.locator('[aria-label*="Analytics timeline chart"]').first()
    await expect(phoneChart).toBeVisible({ timeout: 45_000 })
    await phoneChart.scrollIntoViewIfNeeded()
    await nextPaint(page)
    await writeCaptureArtifact(page, outDir, 'session-390-chart-pixels', { phase: 'ready', fixture: 'portal-acceptance-harness', interaction: 'fold' })

    // Light a11y smoke
    const a11y = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => ({
        tag: h.tagName,
        text: (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      }))
      const buttons = [...document.querySelectorAll('button')].slice(0, 40).map((b) => {
        const r = b.getBoundingClientRect()
        return {
          label: (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          h: Math.round(r.height),
          w: Math.round(r.width),
        }
      })
      const smallTargets = buttons.filter((b) => b.h > 0 && b.h < 32 && b.w > 0 && b.w < 32)
      return { headings, smallTargetCount: smallTargets.length, sampleSmall: smallTargets.slice(0, 8) }
    })
    fs.writeFileSync(path.join(outDir, 'a11y-smoke.json'), JSON.stringify(a11y, null, 2))
    expect(a11y.headings.some((h) => h.tag === 'H1')).toBeTruthy()

    assertHostedApiOnly(violations)
    await assertNoUnexpected(harness)
    await context.close()
  })

})
