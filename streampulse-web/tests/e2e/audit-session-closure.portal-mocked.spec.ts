import { expect, test, type Page, type TestInfo } from './helpers/portalMockedTest'
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
    ['Latest viewers', '11.8K'],
    ['Average viewers', '10.9K'],
    ['Peak viewers', '11.8K'],
    ['Chat messages', '39.5K'],
    ['Emote uses', '25.4K'],
    ['Time tracked', '2h 30m'],
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

// Touch targets. Page controls keep 44 x 44 boxes. The d3 session chart
// (plan §1.2, pinned mock) keeps 26/32 px buttons: its toolbar reaches 44 px
// tall hit rows through ::after hit areas, and the shared d3 navigator (U2)
// draws 32 px buttons. Those groups are held to their hit rows and to the
// WCAG 2.5.8 24 px minimum; the 32 px navigator buttons are an owner question
// in the U8 report.
// d3-v2 session-original (U15): the meta line's Refresh icon and "Data: …"
// are the mockup's 24 px controls (WCAG 2.5.8 minimum); the Moments (i) is a
// 20 px circle with a 44 px hit area; Hide streams / Focus chart show from
// 1280 px only.
type TargetRule = { width: number; height: number; measure: 'box' | 'hit'; minDrawn?: number; fromWidth?: number }
const PAGE_RULE: TargetRule = { width: 44, height: 44, measure: 'box' }

async function assertTouchTargets(page: Page, width: number) {
  const evidence: Array<{
    group: string
    text?: string
    width: number
    height: number
    hitWidth: number
    hitHeight: number
    display: string
    minWidth: string
    minHeight: string
  }> = []
  const targets = [
    ['header actions', page.locator('.analytics-console [data-session-header-actions] button:visible'), { ...PAGE_RULE, fromWidth: 1280 }],
    ['meta line controls', page.locator('.analytics-console [data-session-meta] button:visible'), { width: 24, height: 24, measure: 'box' }],
    ['moments info', page.locator('[data-session-details-tabs] [data-session-info]:visible'), { width: 44, height: 44, measure: 'hit', minDrawn: 20 }],
    ['session tabs', page.locator('[data-session-details-tabs] [role="tab"]:visible'), PAGE_RULE],
    ['chart focus', page.locator('[data-chart-focus-bar] button:visible'), { width: 24, height: 44, measure: 'hit' }],
    ['chart zoom', page.locator('[data-session-chart-navigator] .hx-chart-navigator__toolbar button:visible'), { width: 32, height: 32, measure: 'hit' }],
    ['data alternative disclosure', page.locator('[data-chart-data-alternative] > summary:visible'), PAGE_RULE],
    ['minute pagination', page.locator('[data-chart-data-alternative] button:visible'), PAGE_RULE],
  ] as const satisfies ReadonlyArray<readonly [string, unknown, TargetRule]>
  for (const [label, locator, rule] of targets as ReadonlyArray<readonly [string, ReturnType<Page['locator']>, TargetRule]>) {
    if (rule.fromWidth && width < rule.fromWidth) {
      await expect(locator, `${label} hidden below ${rule.fromWidth}px (at ${width}px)`).toHaveCount(0)
      continue
    }
    await expect(locator.first(), `${label} exists at ${width}px`).toBeVisible()
    const boxes = await locator.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      // The hit area: the box plus an absolutely placed ::before / ::after.
      let left = box.left, right = box.right, top = box.top, bottom = box.bottom
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(node, pseudo)
        if (ps.content === 'none' || ps.content === 'normal' || ps.position !== 'absolute' || ps.display === 'none') continue
        const px = (value: string) => (value.endsWith('px') ? Number.parseFloat(value) : Number.NaN)
        const [l, r, t, b] = [px(ps.left), px(ps.right), px(ps.top), px(ps.bottom)]
        if (Number.isFinite(l)) left = Math.min(left, box.left + l)
        if (Number.isFinite(r)) right = Math.max(right, box.right - r)
        if (Number.isFinite(t)) top = Math.min(top, box.top + t)
        if (Number.isFinite(b)) bottom = Math.max(bottom, box.bottom - b)
      }
      return {
        width: box.width,
        height: box.height,
        hitWidth: right - left,
        hitHeight: bottom - top,
        text: node.textContent?.trim(),
        display: style.display,
        minWidth: style.minWidth,
        minHeight: style.minHeight,
      }
    }))
    for (const box of boxes) {
      const diagnostic = `${box.text} (${box.display}; min ${box.minWidth} × ${box.minHeight}; hit ${box.hitWidth} × ${box.hitHeight})`
      const measured = rule.measure === 'hit' ? { width: box.hitWidth, height: box.hitHeight } : box
      expect(measured.width, `${label} width at ${width}px: ${diagnostic}`).toBeGreaterThanOrEqual(rule.width)
      expect(measured.height, `${label} height at ${width}px: ${diagnostic}`).toBeGreaterThanOrEqual(rule.height)
      if (rule.measure === 'hit') expect(Math.min(box.width, box.height), `${label} drawn size at ${width}px: ${diagnostic}`).toBeGreaterThanOrEqual(rule.minDrawn ?? 24)
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
    // d3-v2 session-original: the lifecycle row rides on the meta line's
    // "Started" item (its title, plus a visually hidden status for screen readers).
    const lifecycle = page.locator('[data-session-meta] [data-session-lifecycle-row]')
    await expect(lifecycle).toHaveCount(1)
    await expect(lifecycle).toHaveAttribute('title', /Session lifecycle unknown/)
    await expect(lifecycle.getByRole('status')).toHaveText(/Session lifecycle unknown/)
    await expect(page.getByText(/11h 31m|Ended Jul|exact end time/i)).toHaveCount(0)

    await assertPopulatedSession(page)

    // The Data quality disclosure is now "Data: <label>" on the meta line; it
    // opens the Status tab, which lists the same facts.
    await expect(page.locator('[data-data-quality-disclosure]')).toHaveCount(0)
    const data = page.locator('[data-session-meta] button[data-data-quality]')
    await expect(data).toHaveCount(1)
    const qualityLabel = await data.getAttribute('data-quality-label')
    expect(qualityLabel).toMatch(/^(Good|Limited|Partial|No data)$/)
    await expect(data).toHaveText(`Data: ${qualityLabel}`)
    await data.click()
    await expect(page.getByRole('tab', { name: 'Status' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Status' })).toBeFocused()
    const facts = page.locator('#session-panel-status [data-data-quality-facts]')
    await expect(facts).toBeVisible()
    const fact = (term: string) => facts.locator('div').filter({ has: page.locator('dt', { hasText: term }) }).locator('dd')
    await expect(fact('Data quality')).toHaveText(qualityLabel!)
    await expect(fact('Chat coverage')).toHaveText('99.5% of stream minutes')
    await expect(fact('Viewer samples')).toContainText('600')
    await expect(fact('VOD')).toHaveText('unavailable')
    await expect(page.locator('#session-panel-status [data-broadcast-end-window]')).toHaveCount(0)

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
    const pageLabel = dataAlternative.locator('[data-chart-data-page-label]')
    // Pages count from the stream start: the newest page, shown first, is 2 of 2.
    await expect(pageLabel).toHaveText(/ · 2 of 2$/)
    await expect(dataAlternative.locator('tbody tr')).toHaveCount(120)
    const pinnedDataRow = dataAlternative.locator('[data-chart-selected-data-row]')
    await expect(pinnedDataRow).toHaveCount(0)
    await dataAlternative.getByRole('button', { name: 'Earlier minutes' }).click()
    await expect(pageLabel).toHaveText(/^00:00:00–00:29:00 · 1 of 2$/)
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
