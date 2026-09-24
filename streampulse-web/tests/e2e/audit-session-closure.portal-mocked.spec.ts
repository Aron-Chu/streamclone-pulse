import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildStatus,
  buildStreamRecord,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  PORTAL_STARTED_AT,
  PORTAL_STREAM_ID,
} from './helpers/portalAcceptanceHarness'

const LATE_LEGACY_ENDED_AT = '2026-07-26T11:59:00.000Z'
const LAST_MEASURED_AT = '2026-07-25T23:57:27.000Z'
const OFFLINE_DETECTED_AT = '2026-07-26T00:02:27.000Z'
const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
] as const

async function assertPopulatedSession(page: Page) {
  const expectedCards = [
    ['Last measured viewers', '11.8K'],
    ['Average viewers', '10.9K'],
    ['Peak viewers', '11.8K'],
    ['Measured chat', '39.5K'],
    ['Measured emote uses', '25.4K'],
    ['Measured span', '2h 30m'],
  ] as const

  for (const [label, value] of expectedCards) {
    const card = page.locator('.sc-stat-card').filter({ hasText: label })
    await expect(card, `${label} remains populated`).toHaveCount(1)
    await expect(card).toContainText(value)
    await expect(card).not.toContainText('-')
  }

  await expect(page.getByRole('region', { name: 'Session activity chart' })).toBeVisible()
  await expect(page.locator('[data-chart-data-alternative]')).toHaveCount(1)
}

async function recordFonts(page: Page, testInfo: TestInfo, width: number) {
  await page.evaluate(() => document.fonts.ready)
  const fonts = await page.evaluate(() => {
    const pick = (selector: string) => {
      const node = document.querySelector(selector)
      return node ? getComputedStyle(node).fontFamily : null
    }
    return {
      body: getComputedStyle(document.body).fontFamily,
      heading: pick('.analytics-console h1'),
      stat: pick('.sc-stat-card__value'),
      chart: pick('[data-session-chart-stack]'),
    }
  })
  expect(fonts.body).toBeTruthy()
  expect(fonts.heading).toBeTruthy()
  expect(fonts.stat).toBeTruthy()
  const path = testInfo.outputPath(`computed-fonts-${width}.json`)
  writeFileSync(path, `${JSON.stringify(fonts, null, 2)}\n`, 'utf8')
  await testInfo.attach(`computed-fonts-${width}.json`, { path, contentType: 'application/json' })
}

async function assertTouchTargets(page: Page, width: number) {
  const evidence: Array<{
    group: string
    text?: string
    width: number
    height: number
    display: string
    minWidth: string
    minHeight: string
  }> = []
  const targets = [
    ['header actions', page.locator('.analytics-console header button:visible')],
    ['session tabs', page.locator('[data-session-details-tabs] [role="tab"]:visible')],
    ['chart focus', page.locator('[data-chart-focus-bar] button:visible')],
    ['chart zoom', page.locator('[data-chart-viewport-controls] button:visible')],
    ['data alternative disclosure', page.locator('[data-chart-data-alternative] > summary:visible')],
    ['minute pagination', page.locator('[data-chart-data-alternative] button:visible')],
  ] as const
  for (const [label, locator] of targets) {
    await expect(locator.first(), `${label} exists at ${width}px`).toBeVisible()
    const boxes = await locator.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        width: box.width,
        height: box.height,
        text: node.textContent?.trim(),
        display: style.display,
        minWidth: style.minWidth,
        minHeight: style.minHeight,
      }
    }))
    for (const box of boxes) {
      const diagnostic = `${box.text} (${box.display}; min ${box.minWidth} × ${box.minHeight})`
      expect(box.width, `${label} width at ${width}px: ${diagnostic}`).toBeGreaterThanOrEqual(44)
      expect(box.height, `${label} height at ${width}px: ${diagnostic}`).toBeGreaterThanOrEqual(44)
      evidence.push({ group: label, ...box })
    }
  }
  return evidence
}

test.describe('portal session closure acceptance (mocked)', () => {
  test('numeric session remains truthful, operable, and responsive', async ({ page }, testInfo) => {
    const requestMethods: Array<{ method: string; url: string }> = []
    page.on('request', request => requestMethods.push({ method: request.method(), url: request.url() }))

    const harness = await installPortalAcceptanceHarness(page)
    const minutes = buildMinutes({ count: 150, withEmotes: true })
    harness.setMinutesPayload(minutes)

    const unknownLifecycleStream = buildStreamRecord({
      endedAt: LATE_LEGACY_ENDED_AT,
      lifecycleState: 'unknown',
      lifecycleObservedAt: LAST_MEASURED_AT,
      lifecycleDetectedAt: OFFLINE_DETECTED_AT,
      measuredStartAt: PORTAL_STARTED_AT,
      measuredEndAt: LAST_MEASURED_AT,
      measuredSpanSeconds: 9_000,
      currentViewers: 0,
      viewerSamples: 600,
    })
    const detail = buildDetail({
      state: 'historical',
      analyticsQuality: 'limited',
      chatCoveragePct: 99.5,
      chatCoverage: {
        coveragePct: 99.5,
        partial: false,
        chatSpanMinutes: 150,
        streamSpanMinutes: 150,
      },
      availability: {
        liveDvrState: 'unknown',
        vodState: 'unavailable',
        chartState: 'usable',
        chartUsable: true,
        coveragePct: 99.5,
      },
      stream: unknownLifecycleStream,
    })
    harness.detail.setFallback({ kind: 'json', body: detail })
    harness.status.setFallback({
      kind: 'json',
      body: buildStatus({
        state: 'unknown',
        stream: unknownLifecycleStream,
        chatCoveragePct: 99.5,
        chatCoverage: {
          coveragePct: 99.5,
          partial: false,
          chatSpanMinutes: 150,
          streamSpanMinutes: 150,
        },
        availability: {
          liveDvrState: 'unknown',
          vodState: 'unavailable',
          chartState: 'usable',
          chartUsable: true,
          coveragePct: 99.5,
        },
      }),
    })
    harness.streams.setFallback({
      kind: 'json',
      body: {
        channel: 'xqc',
        items: [unknownLifecycleStream],
        updatedAt: Date.parse(LAST_MEASURED_AT),
      },
    })
    // The shared acceptance harness predates lifecycle evidence and hardcodes
    // the channel-live read as live. Keep this closure fixture truthful without
    // changing that shared harness: no live session is currently confirmed.
    await page.route(/\/channels\/xqc\/live(?:\?|$)/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        channel: 'xqc',
        state: 'offline',
        stream: null,
        rollups: [],
        updatedAt: Date.parse(OFFLINE_DETECTED_AT),
      }),
    }))

    await page.setViewportSize(VIEWPORTS[0])
    await openAnalyticsSession(page)
    await expect(page).toHaveURL(new RegExp(`/analytics/xqc/${PORTAL_STREAM_ID}$`))
    expect(harness.counter.count(`/streams/${PORTAL_STREAM_ID}`)).toBeGreaterThan(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Deterministic portal acceptance fixture' })).toBeVisible()
    await expect(page.getByText(/Session lifecycle unknown/i).first()).toBeVisible()
    await expect(page.getByText(/11h 31m|Ended Jul|exact end time/i)).toHaveCount(0)

    await assertPopulatedSession(page)

    const quality = page.locator('[data-data-quality-disclosure]')
    await expect(quality).toHaveCount(1)
    await quality.locator('summary').click()
    await expect(quality).toContainText('Chat measured: 99.5% of the timeline')
    await expect(quality).toContainText('600 samples')
    await expect(quality).toContainText('VOD: unavailable')
    await expect(quality).not.toContainText('Broadcast end window')
    await quality.locator('summary').click()
    await expect(quality).not.toHaveAttribute('open', '')

    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(3)
    await tabs.nth(0).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Emotes' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(page.getByRole('tab', { name: 'Status' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Home')
    await expect(page.getByRole('tab', { name: 'Moments' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('tab', { name: 'Status' })).toHaveAttribute('aria-selected', 'true')

    const dataAlternative = page.locator('[data-chart-data-alternative]')
    await dataAlternative.locator('summary').click()
    await expect(dataAlternative.getByText('Page 1 of 2')).toBeVisible()
    await expect(dataAlternative.locator('tbody tr')).toHaveCount(120)
    const pinnedDataRow = dataAlternative.locator('[data-chart-selected-data-row]')
    await expect(pinnedDataRow).toHaveCount(0)
    await dataAlternative.getByRole('button', { name: 'Earlier minutes' }).click()
    await expect(dataAlternative.getByText('Page 2 of 2')).toBeVisible()
    await expect(dataAlternative.locator('tbody tr')).toHaveCount(30)
    await expect(dataAlternative.locator('tbody tr').first()).toContainText('0:00')
    await expect(dataAlternative.locator('tbody tr').last()).toContainText('29:00')
    await expect(dataAlternative.locator('tbody tr').last().locator('th, td')).toHaveCount(4)

    const beforeRefresh = harness.counter.count(`/streams/${PORTAL_STREAM_ID}`)
    await page.getByRole('button', { name: 'Refresh data' }).click()
    await expect(page).toHaveURL(new RegExp(`/analytics/xqc/${PORTAL_STREAM_ID}$`))
    await expect(page.getByText(/^Refreshed /)).toBeVisible()
    expect(harness.counter.count(`/streams/${PORTAL_STREAM_ID}`)).toBeGreaterThan(beforeRefresh)

    const contextualPath = `/analytics/xqc/${PORTAL_STREAM_ID}?context=session-closure#t=120`
    await page.goto(contextualPath)
    await assertPopulatedSession(page)
    await page.reload()
    await assertPopulatedSession(page)
    expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(contextualPath)

    await page.goto(`/s/xqc/${PORTAL_STREAM_ID}?ref=session-closure#t=90`)
    await expect(page).toHaveURL(new RegExp(`/analytics/xqc/${PORTAL_STREAM_ID}\\?ref=session-closure#t=90$`))
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/analytics/xqc/${PORTAL_STREAM_ID}\\?context=session-closure#t=120$`))
    await assertPopulatedSession(page)
    const restoredDataAlternative = page.locator('[data-chart-data-alternative]')
    if (await restoredDataAlternative.getAttribute('open') === null) {
      await restoredDataAlternative.locator('summary').click()
    }
    await expect(restoredDataAlternative.getByRole('button', { name: 'Earlier minutes' })).toBeVisible()
    const restoredPinnedRow = restoredDataAlternative.locator('[data-chart-selected-data-row]')
    await expect(restoredPinnedRow).toHaveCount(1)
    await expect(restoredPinnedRow).toContainText('(pinned)')
    await expect(restoredPinnedRow.locator('th, td')).toHaveCount(4)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await assertPopulatedSession(page)
      const overflow = await page.evaluate(() => ({
        html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }))
      expect(overflow.html, `html overflow at ${viewport.width}px`).toBeLessThanOrEqual(1)
      expect(overflow.body, `body overflow at ${viewport.width}px`).toBeLessThanOrEqual(1)

      if (viewport.width === 360 || viewport.width === 1440) {
        const targetEvidence = await assertTouchTargets(page, viewport.width)
        const targetEvidencePath = testInfo.outputPath(`computed-control-targets-${viewport.width}.json`)
        writeFileSync(targetEvidencePath, `${JSON.stringify(targetEvidence, null, 2)}\n`, 'utf8')
        await testInfo.attach(`computed-control-targets-${viewport.width}.json`, {
          path: targetEvidencePath,
          contentType: 'application/json',
        })
        await recordFonts(page, testInfo, viewport.width)
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
        await page.screenshot({
          path: testInfo.outputPath(`session-closure-${viewport.width}.png`),
          fullPage: true,
          animations: 'disabled',
        })
      }
    }

    const publicPosts = requestMethods.filter(({ method, url }) =>
      method === 'POST' && (url.includes('/analytics') || url.includes('/v1/portal/')),
    )
    expect(publicPosts, 'public session navigation and refresh must remain read-only').toEqual([])
    await assertNoUnexpected(harness)
  })
})
