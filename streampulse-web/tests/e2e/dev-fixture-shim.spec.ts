import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIT_EVIDENCE_DIR } from './helpers/driftAudit'
import {
  FIXTURE_BROADCASTS,
  FIXTURE_CREATOR,
  FIXTURE_HISTORY_URL,
  FIXTURE_MONTH,
  FIXTURE_MONTH_URL,
  FIXTURE_PAGE_SIZE,
  FIXTURE_TOTAL_DETECTIONS,
} from './helpers/discoveryFixture'

/**
 * Proves the documented local-viewing path actually works, rather than only the
 * in-test `page.route` interception:
 *
 *   npm run dev:fixtures                      (scripts/dev-discovery-fixture.mjs on :8099)
 *   VITE_ALLOW_LOCAL_BACKEND=1 npm run dev    (:5173)
 *   sessionStorage['sp.backendUrlOverride'] = 'http://127.0.0.1:8099'
 *
 * Nothing here is mocked in the browser — the portal makes real network calls to
 * the shim. Skips cleanly when the shim is not running or the local-backend
 * opt-in is absent, so it never fails CI for an unrelated reason.
 */

const SHIM_ORIGIN = process.env.SP_FIXTURE_ORIGIN?.trim() || 'http://127.0.0.1:8099'
const outDir = join(AUDIT_EVIDENCE_DIR, 'dev-shim')

async function shimReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${SHIM_ORIGIN}/v1/public/discovery?month=${FIXTURE_MONTH}&login=${FIXTURE_CREATOR}`, {
      signal: AbortSignal.timeout(4000),
    })
    return response.ok
  } catch {
    return false
  }
}

test.describe('dev discovery fixture shim', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    mkdirSync(outDir, { recursive: true })
  })

  test.beforeEach(async ({ page }) => {
    // The override is read at request time via sessionStorage, so it must be
    // set before any app code runs.
    await page.addInitScript(origin => {
      sessionStorage.setItem('sp.backendUrlOverride', origin)
    }, SHIM_ORIGIN)
  })

  test('the stored day is browsable through the shim', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    test.skip(!(await shimReachable()), `fixture shim not reachable at ${SHIM_ORIGIN} — run npm run dev:fixtures`)

    await page.setViewportSize({ width: 1440, height: 900 })

    const discoveryCalls: string[] = []
    // Record every discovery request regardless of origin, so a request that
    // went to the hosted API instead of the shim is visible rather than silent.
    const allDiscoveryCalls: string[] = []
    const failedRequests: string[] = []
    const consoleErrors: string[] = []
    page.on('request', request => {
      if (!request.url().includes('/v1/public/discovery')) return
      allDiscoveryCalls.push(request.url())
      if (request.url().startsWith(SHIM_ORIGIN)) discoveryCalls.push(request.url())
    })
    page.on('requestfailed', request => {
      failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`)
    })
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
    })
    page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`))

    await page.goto(FIXTURE_HISTORY_URL, { waitUntil: 'domcontentloaded' })
    const overrideAfterLoad = await page.evaluate(() =>
      sessionStorage.getItem('sp.backendUrlOverride'),
    )

    const sections = page.locator('.moments-broadcast')
    const rendered = await sections
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)

    const evidence = {
      shimOrigin: SHIM_ORIGIN,
      rendered,
      discoveryCallsThroughShim: discoveryCalls.length,
      overrideAfterLoad,
      allDiscoveryCalls,
      failedRequests,
      consoleErrors,
      bodyText: (await page.locator('#analytics-main').innerText().catch(() => '')).slice(0, 500),
      broadcastCount: await sections.count(),
      heading: (await page.locator('.moments-results h2').first().textContent())?.trim() ?? '',
      legendVisible: await page.locator('.discovery-calendar__legend').isVisible().catch(() => false),
      measuredDayCells: await page
        .locator('.discovery-calendar__days button[data-state="measured"]')
        .count(),
    }
    writeFileSync(join(outDir, 'shim-history.json'), JSON.stringify(evidence, null, 2))
    await page.screenshot({ path: join(outDir, 'shim-history-1440.png'), fullPage: true })
    await testInfo.attach('shim-history-1440.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    // If the override were ignored the portal would hit the hosted 503 instead.
    expect(
      evidence.discoveryCallsThroughShim,
      'the portal did not route discovery through the shim — is VITE_ALLOW_LOCAL_BACKEND=1 set?',
    ).toBeGreaterThan(0)
    expect(rendered, 'no broadcast section rendered from the shim').toBe(true)
    expect(evidence.broadcastCount).toBe(FIXTURE_BROADCASTS.length)
    // Arrival is one bounded catalogue page, not the whole day.
    expect(evidence.heading).toMatch(
      new RegExp(`${FIXTURE_PAGE_SIZE} shown across ${FIXTURE_BROADCASTS.length} broadcasts`),
    )
    // The 503 path renders no day cells at all; these prove real data arrived.
    expect(evidence.measuredDayCells, 'the calendar rendered no measured days').toBeGreaterThan(0)
    expect(evidence.legendVisible, 'the intensity legend did not render').toBe(true)

    // Walking the real pagination over HTTP reaches the whole day.
    const loadMore = page.getByRole('button', { name: /Load more indexed moments/i })
    for (let guard = 0; guard < 10 && (await loadMore.count()); guard += 1) {
      await loadMore.click()
      await page.waitForTimeout(500)
    }
    await expect(page.locator('.moments-results h2')).toContainText(
      `${FIXTURE_TOTAL_DETECTIONS} shown`,
    )
    await page.screenshot({ path: join(outDir, 'shim-history-loaded-1440.png'), fullPage: true })
  })

  test('the year overview is browsable through the shim', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    test.skip(!(await shimReachable()), `fixture shim not reachable at ${SHIM_ORIGIN} — run npm run dev:fixtures`)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(FIXTURE_MONTH_URL, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Year overview' }).click()

    const grid = page.locator('.discovery-year__grid')
    const rendered = await grid
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)

    const cells = await page
      .locator('.discovery-year__grid button[data-state="measured"]')
      .count()
    writeFileSync(
      join(outDir, 'shim-year.json'),
      JSON.stringify({ rendered, measuredCells: cells }, null, 2),
    )
    await page.screenshot({ path: join(outDir, 'shim-year-1440.png'), fullPage: true })
    await testInfo.attach('shim-year-1440.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    expect(rendered, 'the year heatmap did not render from the shim').toBe(true)
    expect(cells, 'the year heatmap rendered no measured days').toBeGreaterThan(0)
  })
})

/**
 * The `?spBackend=` convenience, so the whole local-viewing workflow is one
 * clickable URL rather than a console command. Deliberately outside the describe
 * above so no override is pre-seeded — the parameter has to do the work.
 */
test.describe('dev backend query override', () => {
  test('?spBackend= points the portal at the shim and then cleans itself out of the URL', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    test.skip(!(await shimReachable()), `fixture shim not reachable at ${SHIM_ORIGIN} — run npm run dev:fixtures`)

    await page.setViewportSize({ width: 1440, height: 900 })
    const separator = FIXTURE_HISTORY_URL.includes('?') ? '&' : '?'
    await page.goto(`${FIXTURE_HISTORY_URL}${separator}spBackend=${encodeURIComponent(SHIM_ORIGIN)}`, {
      waitUntil: 'domcontentloaded',
    })

    const sections = page.locator('.moments-broadcast')
    const rendered = await sections
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)

    const evidence = {
      rendered,
      broadcastCount: await sections.count(),
      storedOverride: await page.evaluate(() => sessionStorage.getItem('sp.backendUrlOverride')),
      finalUrl: page.url(),
    }
    writeFileSync(join(outDir, 'shim-query-override.json'), JSON.stringify(evidence, null, 2))
    await testInfo.attach('shim-query-override.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    expect(rendered, 'the stored day did not render via ?spBackend=').toBe(true)
    expect(evidence.broadcastCount).toBe(FIXTURE_BROADCASTS.length)
    expect(evidence.storedOverride, 'the override was not persisted for the session').toBe(
      SHIM_ORIGIN,
    )
    // The parameter must not survive, so it cannot ride along on a shared link.
    expect(evidence.finalUrl, 'spBackend stayed in the URL').not.toContain('spBackend')
    // ...but the rest of the query must be intact.
    expect(evidence.finalUrl).toContain('day=2026-09-03')
  })
})
