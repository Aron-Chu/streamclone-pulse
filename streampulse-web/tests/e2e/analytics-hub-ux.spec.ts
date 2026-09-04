import { test, expect } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
  assertNoWhiteAnalyticsSurfaces,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

test.describe('analytics hub UX (interaction)', () => {
  test.beforeEach(async ({ page }) => {
    await installHubUxMock(page)
  })

  test('hub search opens channel without metadata lookup', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let channelLookups = 0
    await page.route(/\/v1\/search(\?.*)?$/, async (route) => {
      const url = new URL(route.request().url())
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const streams =
        q.includes('newcreator')
          ? [{ login: 'newcreator', displayName: 'NewCreator', isLive: true }]
          : []
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ streams }),
      })
    })
    await page.route(/\/v1\/channels\/[^/]+/, async (route) => {
      channelLookups += 1
      await route.fulfill({ status: 404, body: '{}' })
    })
    await page.goto('/analytics')
    const search = page.getByPlaceholder(/search channels/i)
    await expect(search).toBeVisible()
    await page.locator('body').click({ position: { x: 8, y: 8 } })
    await page.keyboard.press('Control+KeyK')
    await expect(search).toBeFocused()
    await search.fill('newcreator')
    const channelLookupsBeforeOpen = channelLookups
    await page.getByRole('button', { name: /^open$/i }).click()
    await expect(page).toHaveURL(/\/analytics\/newcreator/)
    expect(channelLookups - channelLookupsBeforeOpen).toBe(0)
    await assertNoConsoleErrors(page, errors)
  })

  test('chart hover uses preview inspector styling without active fill', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    await expect(page.locator('.hx-chart2 .hx-chart-line--emotes').first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
    const inspector = page.locator('.activity-bucket-inspector')
    await expect(inspector).toHaveCount(1)
    await expect(inspector).toBeHidden()
    await expect(page.locator('.activity-context-rail')).toHaveAttribute('data-activity-rail-view', 'idle')
    const box = await chart.boundingBox()
    expect(box).toBeTruthy()
    await chart.hover({ position: { x: box!.width * 0.55, y: box!.height * 0.5 } })
    await expect(inspector).toBeVisible()
    await expect(page.locator('.activity-context-rail')).toHaveAttribute('data-activity-rail-view', 'preview')
    await expect(inspector).toHaveClass(/activity-bucket-inspector--preview/)
    await expect(inspector).not.toHaveClass(/activity-bucket-inspector--active/)
    await expect(inspector.getByText(/^Preview ·/)).toBeVisible()
    const tip = page.locator('.hx-chart-tip-slot .tip')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('Total emotes')
    await chart.hover({ position: { x: Math.max(8, box!.width * 0.05), y: box!.height * 0.5 } })
    await expect(tip).toBeVisible()
    await assertNoWhiteAnalyticsSurfaces(page)
    await assertNoConsoleErrors(page, errors)
  })

  test('hub chart chrome keeps plot height and compact header row', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/analytics')

    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    const chartBox = await chart.boundingBox()
    expect(chartBox?.height ?? 0).toBeGreaterThanOrEqual(220)

    const headerAlignment = await page.evaluate(() => {
      const windowEl = document.querySelector('.figma-global-activity__hub-chart .hx-chart-header__window')
      const actions = document.querySelector('.figma-global-activity__hub-chart .hx-chart-actions')
      if (!windowEl || !actions) return { ok: false, reason: 'missing window or actions' }
      const windowTop = windowEl.getBoundingClientRect().top
      const actionsTop = actions.getBoundingClientRect().top
      return { ok: Math.abs(windowTop - actionsTop) <= 4, windowTop, actionsTop }
    })
    expect(headerAlignment.ok, JSON.stringify(headerAlignment)).toBe(true)

    const chartAlignment = await page.evaluate(() => {
      const hubChart = document.querySelector('.figma-global-activity__hub-chart')
      const plot = document.querySelector('.figma-global-activity__hub-chart .hx-chart2')
      if (!hubChart || !plot) return { ok: false, reason: 'missing hub chart or plot' }
      const hubLeft = hubChart.getBoundingClientRect().left
      const plotLeft = plot.getBoundingClientRect().left
      return { ok: Math.abs(plotLeft - hubLeft) <= 6, hubLeft, plotLeft }
    })
    expect(chartAlignment.ok, JSON.stringify(chartAlignment)).toBe(true)

    await expect(page.locator('.figma-global-activity__hub-chart .hx-provider-lane__label').first()).toContainText(
      /7TV|TW|BT|FFZ/,
    )

    const axisGap = await page.evaluate(() => {
      const chart = document.querySelector('.figma-global-activity__hub-chart .hx-chart2')
      const axis = document.querySelector('.figma-global-activity__hub-chart .hx-axis')
      if (!chart || !axis) return { ok: false, reason: 'missing chart or axis' }
      const chartBottom = chart.getBoundingClientRect().bottom
      const axisTop = axis.getBoundingClientRect().top
      const gap = axisTop - chartBottom
      return { ok: gap <= 12, gap }
    })
    expect(axisGap.ok, JSON.stringify(axisGap)).toBe(true)

    await assertNoConsoleErrors(page, errors)
  })

  test('provider lanes stay fixed at the chart footer without header toggles', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/analytics')

    await expect(page.locator('.hx-provider-chips')).toHaveCount(0)
    const lanes = page.locator('.figma-global-activity__hub-chart .hx-provider-lanes')
    await expect(lanes).toBeVisible()
    await expect(lanes.locator('.hx-provider-lane')).toHaveCount(4)

    const geometry = await page.evaluate(() => {
      const plot = document.querySelector('.figma-global-activity__hub-chart .hx-chart2')
      const lanes = document.querySelector('.figma-global-activity__hub-chart .hx-provider-lanes')
      if (!plot || !lanes) return { ok: false, reason: 'missing plot or provider lanes' }
      const plotRect = plot.getBoundingClientRect()
      const lanesRect = lanes.getBoundingClientRect()
      return {
        ok: lanesRect.top >= plotRect.bottom - 1,
        plotBottom: plotRect.bottom,
        lanesTop: lanesRect.top,
      }
    })
    expect(geometry.ok, JSON.stringify(geometry)).toBe(true)
    await expect(lanes).toContainText('7TV')
    await expect(lanes).toContainText('TW')
    await expect(lanes).toContainText('BT')
    await expect(lanes).toContainText('FFZ')
    await expect(lanes.locator('[data-provider="sevenTv"] [data-provider-coverage]')).toHaveText(
      /measured buckets · partial/i,
    )
    await expect(page.locator('.figma-global-activity__hub-chart .hx-chart2')).toHaveAttribute(
      'aria-label',
      /coverage-qualified/i,
    )
    await assertNoConsoleErrors(page, errors)
  })

  test('provider lanes remain fixed and in-frame on mobile', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/analytics')

    const chart = page.locator('.figma-global-activity__hub-chart')
    const lanes = chart.locator('.hx-provider-lanes')
    await expect(chart.locator('.hx-chart2')).toBeVisible()
    await expect(chart.locator('.hx-provider-chips')).toHaveCount(0)
    await expect(lanes.locator('.hx-provider-lane')).toHaveCount(4)
    const geometry = await page.evaluate(() => {
      const plot = document.querySelector('.figma-global-activity__hub-chart .hx-chart2')
      const lanes = document.querySelector('.figma-global-activity__hub-chart .hx-provider-lanes')
      const shell = document.querySelector('.figma-global-activity__hub-chart')
      if (!plot || !lanes || !shell) return { ok: false, reason: 'missing chart geometry' }
      const plotRect = plot.getBoundingClientRect()
      const lanesRect = lanes.getBoundingClientRect()
      const shellRect = shell.getBoundingClientRect()
      return {
        ok: lanesRect.top >= plotRect.bottom - 1 && lanesRect.right <= shellRect.right + 1,
        plotBottom: plotRect.bottom,
        lanesTop: lanesRect.top,
        lanesRight: lanesRect.right,
        shellRight: shellRect.right,
      }
    })
    expect(geometry.ok, JSON.stringify(geometry)).toBe(true)
    await expect(lanes).toContainText(/7TV.*TW.*BT.*FFZ/s)
    await assertNoConsoleErrors(page, errors)
  })

  test('chart navigator supports brush, wheel zoom, shifted pan, keyboard, and reset locally', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let hubRangeRequests = 0
    page.on('request', (request) => {
      if (/\/v1\/public\/hub/.test(request.url()) && request.url().includes('activityWindow=24h')) {
        hubRangeRequests += 1
      }
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/analytics')

    const navigator = page.locator('[data-hub-chart-navigator]')
    const track = navigator.locator('.hx-chart-navigator__track')
    const chart = page.locator('[data-hub-chart-wheel-surface]')
    const start = navigator.getByRole('slider', { name: 'Chart view start' })
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', '0:239')
    await expect(navigator.locator('.hx-chart-navigator__controls')).toHaveCount(0)
    await expect(navigator.locator('[data-hub-chart-preset]')).toHaveCount(0)
    const initialRequests = hubRangeRequests

    const trackBox = await track.boundingBox()
    expect(trackBox).toBeTruthy()
    const brushStartX = trackBox!.x + trackBox!.width * 0.2
    const brushEndX = trackBox!.x + trackBox!.width * 0.7
    const brushY = trackBox!.y + trackBox!.height / 2
    await track.dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'mouse', button: 0, clientX: brushStartX, clientY: brushY })
    await navigator.dispatchEvent('pointermove', { pointerId: 41, pointerType: 'mouse', clientX: brushEndX, clientY: brushY })
    await navigator.dispatchEvent('pointerup', { pointerId: 41, pointerType: 'mouse', clientX: brushEndX, clientY: brushY })
    const brushed = await navigator.getAttribute('data-hub-chart-navigator-window')
    expect(brushed).toBe('48:167')

    const chartBox = await chart.boundingBox()
    expect(chartBox).toBeTruthy()
    const wheelX = chartBox!.x + chartBox!.width * 0.6
    const wheelY = chartBox!.y + chartBox!.height / 2
    await chart.dispatchEvent('wheel', { deltaY: -360, deltaX: 0, clientX: wheelX, clientY: wheelY })
    const wheelZoomed = await navigator.getAttribute('data-hub-chart-navigator-window')
    expect(wheelZoomed).not.toBe(brushed)

    await chart.dispatchEvent('wheel', { deltaY: 280, deltaX: 0, shiftKey: true, clientX: wheelX, clientY: wheelY })
    const panned = await navigator.getAttribute('data-hub-chart-navigator-window')
    expect(panned).not.toBe(wheelZoomed)

    await track.dblclick()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', '0:239')
    await start.press('ArrowRight')
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', '1:239')
    await start.press('Escape')
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', '0:239')
    expect(hubRangeRequests).toBe(initialRequests)
    await assertNoConsoleErrors(page, errors)
  })

  test('bucket locked chip matches filter styling without duplicate banner', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let historicalRequests = 0
    await page.route(/\/v1\/public\/hub\/moments(\?.*)?$/, async (route) => {
      historicalRequests += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          moments: [
            {
              login: 'xqc',
              displayName: 'xQc',
              streamId: 'hist-1',
              offsetSeconds: 600,
              score: 88,
              label: 'Corpus peak',
              source: 'corpus',
              confidence: 90,
              vodState: 'vod_ready',
              chatPerMin: 220,
              viewerDelta: 90,
              viewers: 42_000,
              topEmotes: [{ name: 'LULW', provider: '7tv', count: 120 }],
              at: Date.now() - 8 * 60 * 60 * 1000 + 120_000,
            },
          ],
        }),
      })
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/analytics')

    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    const box = await chart.boundingBox()
    expect(box).toBeTruthy()

    let selected = false
    for (const ratio of [0.82, 0.65, 0.45, 0.28, 0.15]) {
      await chart.click({ position: { x: Math.floor(box!.width * ratio), y: Math.floor(box!.height * 0.5) } })
      if (await page.locator('.pulse-moments-live__bucket-filter').isVisible()) {
        selected = true
        break
      }
    }
    expect(selected, 'expected an active chart bucket click to stick').toBe(true)
    expect(historicalRequests).toBeGreaterThanOrEqual(1)

    const bucketFilter = page.locator('.pulse-moments-live__bucket-filter')
    await expect(bucketFilter).toBeVisible()
    await expect(bucketFilter).toContainText(/Selected bucket/i)
    await expect(page.locator('.pulse-moments-live__diagnostics')).toBeVisible()
    await expect(page.locator('.pulse-moments__peak-label', { hasText: 'Corpus peak' }).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('.pulse-moments-live__banner')).toHaveCount(0)
    await expect(page.locator('.hx-bucket-cue__label')).toHaveCount(0)

    const chipStyles = await page.evaluate(() => {
      const bucket = document.querySelector('.pulse-moments-live__bucket-filter')
      const filter = document.querySelector('.pulse-moments-live__filter:not(.is-active)')
      if (!bucket || !filter) return { ok: false, reason: 'missing bucket filter or inactive filter chip' }
      const bucketStyle = getComputedStyle(bucket)
      const filterStyle = getComputedStyle(filter)
      const borderMatch = bucketStyle.borderColor === filterStyle.borderColor
      const backgroundMatch = bucketStyle.backgroundColor === filterStyle.backgroundColor
      return {
        ok: borderMatch && backgroundMatch,
        bucketBorder: bucketStyle.borderColor,
        filterBorder: filterStyle.borderColor,
        bucketBackground: bucketStyle.backgroundColor,
        filterBackground: filterStyle.backgroundColor,
      }
    })
    expect(chipStyles.ok, JSON.stringify(chipStyles)).toBe(true)

    await page.locator('.pulse-moments-live').click({ position: { x: 24, y: 24 } })
    await expect(bucketFilter).toHaveCount(0)
    await expect(page.locator('.activity-bucket-inspector--preview')).toHaveCount(0)
    await expect(page.locator('.activity-bucket-inspector--selected')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()

    await assertNoConsoleErrors(page, errors)
  })

  test('chart bucket selection shows diagnostics and loads historical corpus peaks', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let historicalRequests = 0
    await page.route(/\/v1\/public\/hub\/moments(\?.*)?$/, async (route) => {
      historicalRequests += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          moments: [
            {
              login: 'xqc',
              displayName: 'xQc',
              streamId: 'hist-1',
              offsetSeconds: 600,
              score: 88,
              label: 'Corpus peak',
              source: 'corpus',
              confidence: 90,
              vodState: 'vod_ready',
              chatPerMin: 220,
              viewerDelta: 90,
              viewers: 42_000,
              topEmotes: [{ name: 'LULW', provider: '7tv', count: 120 }],
              at: Date.now() - 8 * 60 * 60 * 1000 + 120_000,
            },
          ],
        }),
      })
    })
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toHaveClass(/hx-chart2--selectable/)
    const box = await chart.boundingBox()
    expect(box).toBeTruthy()
    let selected = false
    for (const ratio of [0.82, 0.65, 0.45, 0.28, 0.15]) {
      await chart.click({ position: { x: Math.floor(box!.width * ratio), y: Math.floor(box!.height * 0.5) } })
      if (await page.locator('.pulse-moments-live__bucket-filter').isVisible()) {
        selected = true
        break
      }
    }
    expect(selected, 'expected an active chart bucket click to stick').toBe(true)
    const diagnostics = page.locator('.pulse-moments-live__diagnostics')
    await expect(diagnostics).toBeVisible()
    await expect(diagnostics).toContainText(/Bucket/i)
    expect(historicalRequests, 'bucket click should fetch /v1/public/hub/moments').toBeGreaterThanOrEqual(1)
    await expect(page.locator('.pulse-moments__peak-label', { hasText: 'Corpus peak' }).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(diagnostics).toContainText(/Stored moments:/i)
    await expect(page.locator('.activity-bucket-inspector--moment')).toHaveCount(0)
    await expect(page.locator('.pulse-moments-live__side')).toBeVisible()
    await expect(page.locator('.pulse-moments__peak-row.is-active')).toHaveCount(0)
    await assertNoConsoleErrors(page, errors)
  })

  test('pulse moments table top emotes fit without horizontal scroll', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    const box = await chart.boundingBox()
    expect(box).toBeTruthy()
    let selected = false
    for (const ratio of [0.82, 0.65, 0.45, 0.28, 0.15]) {
      await chart.click({ position: { x: Math.floor(box!.width * ratio), y: Math.floor(box!.height * 0.5) } })
      if (await page.locator('.pulse-moments-live__bucket-filter').isVisible()) {
        selected = true
        break
      }
    }
    expect(selected, 'expected an active chart bucket click to stick').toBe(true)

    const firstRow = page.locator('.pulse-moments__peak-row').first()
    await expect(firstRow).toBeVisible()
    await firstRow.click()

    const layout = await page.evaluate(() => {
      const tableWrap = document.querySelector('.pulse-moments__table-wrap')
      if (!tableWrap) {
        return { ok: false, reason: 'missing table wrap' }
      }
      const wrapRect = tableWrap.getBoundingClientRect()
      const noHorizontalScroll = tableWrap.scrollWidth <= tableWrap.clientWidth + 1
      const emotes = Array.from(
        document.querySelectorAll('.pulse-moments__peak-row .pulse-moments__peak-emote'),
      )
      if (emotes.length < 1) {
        return { ok: false, reason: 'no peak emotes in table', noHorizontalScroll, emoteCount: 0 }
      }
      const emotesFullyVisible = emotes.every((node) => {
        const rect = node.getBoundingClientRect()
        return rect.right <= wrapRect.right + 1 && rect.width > 0
      })
      return {
        ok: noHorizontalScroll && emotesFullyVisible,
        reason: !noHorizontalScroll
          ? 'horizontal scroll'
          : !emotesFullyVisible
            ? 'emote clipped'
            : 'ok',
        noHorizontalScroll,
        emotesFullyVisible,
        emoteCount: emotes.length,
        scrollWidth: tableWrap.scrollWidth,
        clientWidth: tableWrap.clientWidth,
      }
    })

    expect(layout.ok, JSON.stringify(layout)).toBe(true)
    expect(layout.emoteCount).toBeGreaterThanOrEqual(1)
    await assertNoWhiteAnalyticsSurfaces(page)
    await assertNoConsoleErrors(page, errors)
  })

  test('featured rail shows top movers in emote signal and pool KPI uses poolSize', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.hub-live-rail-movers')).toHaveCount(0)
    await expect(page.getByTestId('live-pool-size')).toBeVisible()
    await expect(page.getByTestId('pool-wire')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
    await expect(page.locator('#section-emote-signal .figma-economy-grid')).toBeVisible()
    await expect(page.getByRole('link', { name: /xQc/i }).first()).toBeVisible()
    await expect(page.getByText('96', { exact: true }).first()).toBeVisible()
    await assertNoWhiteAnalyticsSurfaces(page)
    await assertNoConsoleErrors(page, errors)
  })

  test('Live Wire rail is chart-relative, selects its minute, and never nests navigation', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')

    const tape = page.getByRole('region', { name: 'Live Wire' })
    await expect(tape).toBeVisible()
    await expect(page.locator('.activity-context-rail .hub-live-wire--rail')).toHaveCount(1)
    await expect(tape.locator('a .hub-live-wire__event-card, .hub-live-wire__event-card a')).toHaveCount(0)
    await expect(tape.locator('.hub-live-wire__bar, [role="progressbar"]')).toHaveCount(0)

    const sodaCard = tape.getByRole('button', { name: /sodapoppin.*Inspect this activity bucket/i })
    await expect(sodaCard).toBeVisible()
    await expect(page.locator('.pulse-moments__peak-row.is-active')).toHaveCount(0)
    await expect(page.locator('.hx-bucket-cue--accent')).toHaveCount(0)
    await expect(page.getByTestId('bucket-inspector-linked-moment')).toHaveCount(0)
    await sodaCard.click()
    await expect(page.locator('.figma-global-activity__hub-chart .hx-chart2')).toHaveAttribute('data-selected', 'true')

    await assertNoWhiteAnalyticsSurfaces(page)
    await assertNoConsoleErrors(page, errors)
  })

  test('moment inspector top emote card layout after row select', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.pulse-moments-live')).toBeVisible()
    await page.locator('.pulse-moments__peak-row', { hasText: 'Twitch emote spike' }).click()

    await expect(page.locator('.activity-bucket-inspector--moment')).toHaveCount(0)
    await expect(page.getByLabel('Activity bucket inspector')).toBeVisible()
    await expect(page.getByTestId('bucket-inspector-linked-moment')).toBeVisible()
    await expect(page.locator('.activity-bucket-inspector .hub-moment-rail')).toHaveCount(0)

    const inspector = page.locator('.pulse-moments-live__side .pulse-moments__inspector')
    await expect(inspector).toBeVisible()

    const headerLayout = await inspector.evaluate((el) => {
      const headMain = el.querySelector('.pulse-moments__inspector-head-main')
      const timeBadge = el.querySelector('.pulse-moments__inspector-time-badge')
      const momentHead = el.querySelector('.pulse-moments__inspector-moment-head')
      if (!headMain || !timeBadge || !momentHead) {
        return { ok: false, reason: 'missing header blocks' }
      }
      const mainLeft = headMain.getBoundingClientRect().left
      const badgeLeft = timeBadge.getBoundingClientRect().left
      return {
        ok: mainLeft < badgeLeft && headMain.contains(momentHead),
        mainLeft,
        badgeLeft,
      }
    })
    expect(headerLayout.ok, JSON.stringify(headerLayout)).toBe(true)
    await expect(inspector.locator('.pulse-moments__inspector-moment-head')).toBeVisible()

    const emoteCard = inspector.locator('.pulse-moments__inspector-emote-card')
    await expect(emoteCard).toBeVisible()
    await expect(emoteCard.getByText('Top emote this minute')).toBeVisible()
    await expect(emoteCard.locator('.pulse-moments__inspector-top-emote-name')).toHaveText('DinoDance')
    await expect(emoteCard.locator('.pulse-moments__inspector-provider')).toHaveText('Twitch')
    await expect(emoteCard.locator('.pulse-moments__inspector-emote-stat-row strong')).toHaveText('123')
    await expect(emoteCard.getByText('uses this minute')).toBeVisible()
    await expect(emoteCard.getByText('of emotes')).toBeVisible()

    const kpiRow = inspector.locator('.pulse-moments__inspector-kpi-row')
    await expect(kpiRow).toBeVisible()
    await expect(kpiRow.getByText('Emotes / min')).toBeVisible()
    await expect(kpiRow.getByText('Chat / min')).toBeVisible()
    await expect(kpiRow.getByText('Viewers', { exact: true })).toBeVisible()
    await expect(kpiRow.locator('.pulse-moments__inspector-stat').nth(0).locator('strong')).toHaveText('133')
    await expect(kpiRow.locator('.pulse-moments__inspector-stat').nth(2).locator('strong')).toHaveText('12K viewers')

    await expect(inspector.getByRole('link', { name: 'Analytics' })).toBeVisible()

    await expect(emoteCard).toHaveScreenshot('moment-inspector-top-emote-card.png', {
      maxDiffPixelRatio: 0.04,
    })
    await assertNoConsoleErrors(page, errors)
  })

  test('idle activity rail shows Live Wire and keeps the inspector inactive', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const rail = page.locator('.activity-context-rail')
    const liveWire = rail.getByRole('region', { name: 'Live Wire' })
    await expect(liveWire).toBeVisible()
    await expect(liveWire.getByRole('heading', { name: 'Live Wire' })).toBeVisible()
    await expect(rail).toHaveAttribute('data-activity-rail-view', 'idle')
    await expect(rail.locator('.activity-context-rail__pane--inspector')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.figma-global-activity__annotation-lane')).toHaveCount(0)

    await assertNoConsoleErrors(page, errors)
  })

  test('embedded pulse moments side-by-side layout with inspector panel', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/analytics')

    await expect(page.locator('.pulse-moments-live__side')).toBeVisible()

    const layout = await page.evaluate(() => {
      const embedded = document.querySelector('.pulse-moments-live.pulse-moments-live--embedded')
      const grid = embedded?.querySelector('.pulse-moments-live__grid')
      const tableWrap = embedded?.querySelector('.pulse-moments__table-wrap')
      const side = embedded?.querySelector('.pulse-moments-live__side')
      if (!embedded || !grid || !tableWrap || !side) {
        return { ok: false, reason: 'expected embedded grid with side panel' }
      }
      const tableRect = tableWrap.getBoundingClientRect()
      const sideRect = side.getBoundingClientRect()
      const gridRect = grid.getBoundingClientRect()
      return {
        ok:
          tableRect.width < gridRect.width * 0.9 &&
          sideRect.left >= tableRect.right - 4 &&
          sideRect.width >= 220,
        sideBesideTable: sideRect.left >= tableRect.right - 4,
        sideMinWidth: sideRect.width >= 220,
      }
    })
    expect(layout.ok, JSON.stringify(layout)).toBe(true)

    await page.locator('.pulse-moments__peak-row').first().click()
    await expect(page.locator('.pulse-moments-live__side .pulse-moments__inspector')).toBeVisible()
    await expect(page.locator('.activity-bucket-inspector--moment')).toHaveCount(0)
    await expect(page.getByTestId('bucket-inspector-linked-moment')).toBeVisible()
    await expect(page.locator('.pulse-moments-live__side .emote-rank-row *[class*="share"]').first()).toBeVisible()

    await assertNoConsoleErrors(page, errors)
  })

  test('Live Wire exposes verified streamer-relative detections and browse controls', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const liveWire = page.getByRole('region', { name: 'Live Wire' })
    await expect(liveWire).toBeVisible()
    await expect(liveWire.getByText(/current streams · top detected moments/i)).toBeVisible()
    await expect(liveWire.getByRole('button', { name: 'Current streams' })).toHaveAttribute('aria-pressed', 'true')
    await expect(liveWire.getByLabel('Live Wire category')).toBeVisible()
    await expect(liveWire.getByLabel('Live Wire order')).toBeVisible()
    await expect(liveWire.getByRole('button', { name: /xQc.*Inspect this activity bucket/i })).toBeVisible()
    await assertNoConsoleErrors(page, errors)
  })

  test('global activity shell visual baseline', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await page.addStyleTag({ content: '.analytics-topnav { position: static !important; }' })
    await expect(page.locator('.figma-activity-hub')).toBeVisible()
    await expect(page.locator('.figma-global-activity')).toBeVisible()
    await expect(page.locator('.figma-global-activity .hx-chart2')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
    await assertNoWhiteAnalyticsSurfaces(page)
    await expect(page.locator('.figma-global-activity')).toHaveScreenshot('hub-global-activity-shell.png', {
      maxDiffPixelRatio: 0.04,
    })
    await assertNoConsoleErrors(page, errors)
  })
})
