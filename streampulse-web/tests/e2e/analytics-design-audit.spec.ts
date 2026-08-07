import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  attachHostedApiGuard,
  assertHostedApiOnly,
  clearBackendOverrides,
  waitForHostedApiTraffic,
} from './helpers/hostedApi'

const SESSION_PATH =
  process.env.ANALYTICS_E2E_SESSION_PATH?.trim() || '/analytics/caseoh_/2026-07-09'

type EvidenceStep = {
  step: string
  hubStatus?: number
  poolSize?: number | null
  hubState?: string | null
  poolText?: string | null
  liveWireSnippet?: string | null
  consoleErrors: string[]
  failedRequests: string[]
}

async function collectDomEvidence(page: Page): Promise<Omit<EvidenceStep, 'step' | 'consoleErrors' | 'failedRequests'>> {
  return page.evaluate(() => {
    const main = document.querySelector('main[data-hub-state]')
    const pool = document.querySelector('[data-testid="live-pool-size"]')
    const liveWire = document.querySelector('.hub-live-wire, #section-signal-wire')
    return {
      hubState: main?.getAttribute('data-hub-state') ?? null,
      poolText: pool?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      liveWireSnippet: liveWire?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 220) ?? null,
    }
  })
}

test.describe('analytics design audit (deterministic capture)', () => {
  test.beforeEach(async ({ page }) => {
    await clearBackendOverrides(page)
  })

  test('hub broken→healthy sequence + visual matrix', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const violations = attachHostedApiGuard(page)
    const outDir = testInfo.outputPath('hub-sequence')
    fs.mkdirSync(outDir, { recursive: true })

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
      (response) => response.url().includes('/v1/public/hub') && response.status() === 200,
      { timeout: 60_000 },
    )

    await page.goto('/analytics', { waitUntil: 'domcontentloaded' })

    // 01 — immediate first paint (may be loading / empty shell)
    await page.screenshot({
      path: path.join(outDir, '01-immediate-first-paint.png'),
      fullPage: false,
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

    await page.screenshot({
      path: path.join(outDir, '02-after-hub-response.png'),
      fullPage: false,
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
    if (poolSize != null && poolSize > 0) {
      await page.waitForFunction(
        (expected) => {
          const el = document.querySelector('[data-testid="live-pool-size"]')
          return el?.textContent?.includes(String(expected))
        },
        poolSize,
        { timeout: 45_000 },
      )
    }

    await page.screenshot({
      path: path.join(outDir, '03-after-ui-ready.png'),
      fullPage: false,
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
    await page.waitForTimeout(400)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await page.screenshot({
      path: path.join(outDir, '04-after-scroll-return.png'),
      fullPage: false,
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
    await page.screenshot({
      path: path.join(outDir, 'hub-1600-fold.png'),
      fullPage: false,
    })
    await page.screenshot({
      path: path.join(outDir, 'hub-1600-full.png'),
      fullPage: true,
    })

    const activity = page.locator('.figma-global-activity, #section-network').first()
    if (await activity.count()) {
      await activity.screenshot({ path: path.join(outDir, 'hub-1600-live-activity.png') })
    }
    const moments = page.locator('#section-pulse-moments, .pulse-moments-live--embedded').first()
    if (await moments.count()) {
      await moments.screenshot({ path: path.join(outDir, 'hub-1600-pulse-moments.png') })
    }

    // Mobile fold + chart transition
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-hub-state="ready"], [data-hub-state="empty"]').first().waitFor({
      timeout: 60_000,
    })
    await page.screenshot({
      path: path.join(outDir, 'hub-390-fold.png'),
      fullPage: false,
    })
    await page.evaluate(() => {
      document.getElementById('section-network')?.scrollIntoView({ block: 'start' })
    })
    await page.waitForTimeout(500)
    await page.screenshot({
      path: path.join(outDir, 'hub-390-chart-transition.png'),
      fullPage: false,
    })

    // Ready state must not claim hub unavailable when API returned a pool.
    const readyEvidence = evidence.find((e) => e.step === '03-after-ui-ready')
    expect(readyEvidence?.hubState).toMatch(/ready|empty/)
    if (poolSize != null && poolSize > 0) {
      expect(readyEvidence?.liveWireSnippet ?? '').not.toMatch(/hub unavailable/i)
      expect(readyEvidence?.poolText ?? '').toMatch(String(poolSize))
    }

    assertHostedApiOnly(violations)

    await testInfo.attach('hub-evidence', {
      path: path.join(outDir, 'evidence.json'),
      contentType: 'application/json',
    })
  })

  test('session visual matrix + chart crops', async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const outDir = testInfo.outputPath('session-matrix')
    fs.mkdirSync(outDir, { recursive: true })

    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    await clearBackendOverrides(page)
    const violations = attachHostedApiGuard(page)

    await page.goto(SESSION_PATH, { waitUntil: 'domcontentloaded' })
    await waitForHostedApiTraffic(page)
    await page.locator('main[aria-label*="Analytics for"], .analytics-console').first().waitFor({
      state: 'visible',
      timeout: 60_000,
    })
    await page.waitForTimeout(2500)

    await page.screenshot({
      path: path.join(outDir, 'session-1600-fold.png'),
      fullPage: false,
    })

    const chart = page.locator('[aria-label*="Analytics timeline chart"]').first()
    await expect(chart).toBeVisible({ timeout: 45_000 })

    const hiContext = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    })
    const hiPage = await hiContext.newPage()
    await clearBackendOverrides(hiPage)
    await hiPage.goto(SESSION_PATH, { waitUntil: 'domcontentloaded' })
    await waitForHostedApiTraffic(hiPage)
    const hiChart = hiPage.locator('[aria-label*="Analytics timeline chart"]').first()
    await hiChart.waitFor({ state: 'visible', timeout: 60_000 })
    await hiPage.waitForTimeout(2000)
    await hiChart.screenshot({ path: path.join(outDir, 'session-1600-chart.png') })

    const box = await hiChart.boundingBox()
    if (box) {
      // Hover mid / tall-bar region
      await hiPage.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.72)
      await hiPage.waitForTimeout(400)
      await hiChart.screenshot({ path: path.join(outDir, 'session-chart-hover-bar.png') })
      // Right edge
      await hiPage.mouse.move(box.x + box.width * 0.92, box.y + box.height * 0.55)
      await hiPage.waitForTimeout(400)
      await hiChart.screenshot({ path: path.join(outDir, 'session-chart-hover-right.png') })
    }

    await hiContext.close()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(SESSION_PATH, { waitUntil: 'domcontentloaded' })
    await waitForHostedApiTraffic(page)
    await page.waitForTimeout(2500)
    await page.screenshot({
      path: path.join(outDir, 'session-390-fold.png'),
      fullPage: false,
    })
    await page.locator('[aria-label*="Analytics timeline chart"]').first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await page.screenshot({
      path: path.join(outDir, 'session-390-chart-pixels.png'),
      fullPage: false,
    })

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
    await context.close()
  })

})
