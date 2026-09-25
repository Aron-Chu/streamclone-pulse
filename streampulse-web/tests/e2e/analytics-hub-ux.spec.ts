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
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
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

  test('chart hover updates the compact readout without opening a bucket inspector', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    await expect(page.locator('.hx-chart2 .hx-chart-line--emotes').first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
    await expect(page.locator('.figma-global-activity__inspector')).toBeHidden()
    const box = await chart.boundingBox()
    expect(box).toBeTruthy()
    const readout = page.locator('.hx-chart-header__readout')
    await expect(readout).toContainText('No interval selected')
    await expect(readout).toContainText('Hover to preview · click a bucket to filter moments')
    await chart.hover({ position: { x: box!.width * 0.55, y: box!.height * 0.5 } })
    await expect(readout).toHaveAttribute('data-active', 'true')
    await expect(readout.locator('.hx-hover-interval')).not.toContainText('No interval selected')
    await expect(readout.locator('.hx-hover-metrics')).toContainText('Viewers')
    await expect(readout.locator('.hx-hover-metrics')).toContainText('Chat/min')
    await expect(readout.locator('.hx-hover-metrics')).toContainText('Emotes/min')
    const firstInterval = await readout.locator('.hx-hover-interval').textContent()
    await expect(page.locator('.figma-global-activity__inspector')).toBeHidden()
    await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
    await chart.hover({ position: { x: Math.max(8, box!.width * 0.05), y: box!.height * 0.5 } })
    await expect(readout.locator('.hx-hover-interval')).not.toHaveText(firstInterval ?? '')
    const hoveredBox = await chart.boundingBox()
    expect(hoveredBox).toBeTruthy()
    expect(Math.abs(hoveredBox!.width - box!.width)).toBeLessThanOrEqual(2)
    await expect(page.locator('.figma-global-activity__inspector')).toBeHidden()
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
      /full bucket coverage · lower bound/i,
    )
    await expect(page.locator('.figma-global-activity__hub-chart .hx-chart2')).toHaveAttribute(
      'aria-label',
      /complete configured-roster coverage/i,
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

  test('Pulse Moments cards keep their channel and rates readable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/analytics')
    const table = page.locator('.figma-activity-hub .pulse-moments-live--embedded .pulse-moments__table')
    await expect(table.locator('tbody tr').first()).toBeVisible()
    const geometry = await page.evaluate(() => {
      const wrap = document.querySelector('.figma-activity-hub .pulse-moments-live--embedded .pulse-moments__table-wrap')
      const table = wrap?.querySelector('table')
      const channel = table?.querySelector('tbody tr td[data-label="Channel"]')
      const row = table?.querySelector('tbody tr')
      const time = row?.querySelector('td[data-label="Time"]')
      const chat = row?.querySelector('td[data-label="Chat/min"]')
      const emotes = row?.querySelector('td[data-label="Emotes/min"]')
      if (!wrap || !table || !row || !channel || !time || !chat || !emotes) return null
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        scrollWidth: wrap.scrollWidth,
        visibleWidth: wrap.clientWidth,
        tableWidth: table.getBoundingClientRect().width,
        rowDisplay: getComputedStyle(row).display,
        channelWidth: channel.getBoundingClientRect().width,
        timeWidth: time.getBoundingClientRect().width,
        chatWidth: chat.getBoundingClientRect().width,
        emotesWidth: emotes.getBoundingClientRect().width,
        chatOverflow: chat.scrollWidth > chat.clientWidth,
        emotesOverflow: emotes.scrollWidth > emotes.clientWidth,
        chatDirection: getComputedStyle(chat).flexDirection,
        emotesDirection: getComputedStyle(emotes).flexDirection,
        chatWhiteSpace: getComputedStyle(chat).whiteSpace,
        emotesWhiteSpace: getComputedStyle(emotes).whiteSpace,
        chatLabel: getComputedStyle(chat, '::before').content,
        emotesLabel: getComputedStyle(emotes, '::before').content,
      }
    })
    expect(geometry).toBeTruthy()
    expect(geometry!.pageWidth).toBeLessThanOrEqual(geometry!.viewportWidth)
    expect(geometry!.rowDisplay).toBe('grid')
    expect(geometry!.channelWidth).toBeGreaterThanOrEqual(80)
    expect(geometry!.timeWidth).toBeGreaterThan(0)
    expect(geometry!.chatWidth).toBeGreaterThanOrEqual(70)
    expect(geometry!.emotesWidth).toBeGreaterThanOrEqual(70)
    expect(geometry!.chatOverflow).toBe(false)
    expect(geometry!.emotesOverflow).toBe(false)
    expect(geometry!.chatDirection).toBe('column')
    expect(geometry!.emotesDirection).toBe('column')
    expect(geometry!.chatWhiteSpace).toBe('nowrap')
    expect(geometry!.emotesWhiteSpace).toBe('nowrap')
    expect(geometry!.chatLabel).toContain('Chat/min')
    expect(geometry!.emotesLabel).toContain('Emotes/min')
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
    await expect(navigator.getByRole('button', { name: 'Zoom in' })).toBeVisible()
    await expect(navigator.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
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
    await chart.dispatchEvent('wheel', { deltaY: -360, deltaX: 0, altKey: true, clientX: wheelX, clientY: wheelY })
    const wheelZoomed = await navigator.getAttribute('data-hub-chart-navigator-window')
    expect(wheelZoomed).not.toBe(brushed)

    await chart.dispatchEvent('wheel', { deltaY: 280, deltaX: 0, shiftKey: true, clientX: wheelX, clientY: wheelY })
    const panned = await navigator.getAttribute('data-hub-chart-navigator-window')
    expect(panned).not.toBe(wheelZoomed)

    await track.dblclick()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', '0:239')
    await navigator.getByRole('button', { name: 'Zoom in' }).click()
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', '0:239')
    await navigator.getByRole('button', { name: 'Zoom out' }).click()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', '0:239')
    await start.press('ArrowRight')
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', '1:239')
    await start.press('Escape')
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', '0:239')
    expect(hubRangeRequests).toBe(initialRequests)
    await assertNoConsoleErrors(page, errors)
  })

  test('activity range follows the URL and fetches once per selection', async ({ page }) => {
    await installHubUxMock(page, { matchActivityWindow: true })
    const requestedRanges: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/public/hub') {
        requestedRanges.push(new URL(request.url()).searchParams.get('activityWindow') ?? '')
      }
    })
    await page.goto('/analytics?window=24h')
    const range = page.getByRole('button', { name: 'Activity time window: 24h' })
    await expect(range).toBeVisible()
    await range.click()
    await page.getByRole('option', { name: '7d' }).click()
    await expect(page).toHaveURL(/\/analytics\?window=7d$/)
    await expect(page.getByRole('button', { name: 'Activity time window: 7d' })).toBeVisible()
    await expect.poll(() => requestedRanges.filter((value) => value === '7d').length).toBe(1)
    await page.waitForTimeout(350)
    expect(requestedRanges.filter((value) => value === '7d').length).toBe(1)
    // Dev StrictMode remounts the initial hook, but URL selection must not
    // trigger a second request for the newly selected range.
    expect(requestedRanges.filter((value) => value === '24h').length).toBeGreaterThanOrEqual(1)
  })

  test('bucket lock keeps its compact summary beside the chart at 1262px', async ({ page }) => {
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
    await page.setViewportSize({ width: 1262, height: 1228 })
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
    await expect(page.getByRole('complementary', { name: 'Activity bucket inspector' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Activity bucket inspector' })).toContainText('Bucket selected')
    await expect(page.locator('.pulse-moments__peak-label', { hasText: 'Corpus peak' }).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('.pulse-moments-live__banner')).toHaveCount(0)
    await expect(page.locator('.hx-bucket-cue__label')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const reveal = document.querySelector('.figma-global-activity__inspector .inspector-reveal')
      const content = reveal?.querySelector('.inspector-reveal__content')
      return reveal && content ? Math.abs(reveal.getBoundingClientRect().height - content.getBoundingClientRect().height) : Infinity
    })).toBeLessThanOrEqual(1)
    const layout = await page.evaluate(() => {
      const body = document.querySelector('.figma-global-activity__body')?.getBoundingClientRect()
      const plot = document.querySelector('.figma-global-activity__chart-col')?.getBoundingClientRect()
      const inspector = document.querySelector('.figma-global-activity__inspector')?.getBoundingClientRect()
      const link = document.querySelector('.activity-bucket-inspector__moments-link')?.getBoundingClientRect()
      return body && plot && inspector && link ? {
        plotWidth: plot.width,
        plotTop: plot.top,
        plotRight: plot.right,
        inspectorTop: inspector.top,
        inspectorLeft: inspector.left,
        inspectorRight: inspector.right,
        bodyRight: body.right,
        bodyBottom: body.bottom,
        linkBottom: link.bottom,
      } : null
    })
    expect(layout).toBeTruthy()
    expect(layout!.plotWidth).toBeGreaterThanOrEqual(800)
    expect(layout!.inspectorLeft).toBeGreaterThanOrEqual(layout!.plotRight - 2)
    expect(layout!.inspectorTop).toBeLessThanOrEqual(layout!.plotTop + 24)
    expect(layout!.inspectorRight).toBeLessThanOrEqual(layout!.bodyRight + 2)
    expect(layout!.linkBottom).toBeLessThanOrEqual(layout!.bodyBottom + 2)

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

    await page.getByRole('button', { name: /clear selected chart bucket/i }).click()
    await expect(bucketFilter).toHaveCount(0)
    await expect(page.locator('.activity-bucket-inspector--preview')).toHaveCount(0)
    await expect(page.locator('.activity-bucket-inspector--selected')).toHaveCount(0)
    await expect(page.locator('.figma-global-activity__inspector')).toBeHidden()
    await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()

    await assertNoConsoleErrors(page, errors)
  })

  test('chart bucket selection filters moments and loads historical corpus peaks', async ({ page }) => {
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
    const bucketFilter = page.locator('.pulse-moments-live__bucket-filter')
    await expect(bucketFilter).toContainText(/Selected bucket/i)
    const inspector = page.getByRole('complementary', { name: 'Activity bucket inspector' })
    await expect(inspector).toBeVisible()
    await expect(inspector).toContainText('Bucket activity')
    await expect(inspector.getByRole('link', { name: /inspect matching moments/i })).toHaveAttribute('href', '#section-pulse-moments')
    expect(historicalRequests, 'bucket click should fetch /v1/public/hub/moments').toBeGreaterThanOrEqual(1)
    await expect(page.locator('.pulse-moments__peak-label', { hasText: 'Corpus peak' }).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('.activity-bucket-inspector--moment')).toHaveCount(0)
    await expect(page.locator('.pulse-moments-live__side')).toHaveCount(0)
    await expect(page.locator('.pulse-moments-live__grid')).toHaveAttribute('data-has-selection', 'false')
    await expect(page.locator('.pulse-moments__peak-row.is-active')).toHaveCount(0)
    await assertNoConsoleErrors(page, errors)
  })

  test('moment selector and selected emote evidence fit without horizontal scroll', async ({ page }) => {
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
      const selectedInspector = document.querySelector('.pulse-moments-live__side .pulse-moments__inspector')
      if (!tableWrap || !selectedInspector) {
        return { ok: false, reason: 'missing table wrap or selected inspector' }
      }
      const inspectorRect = selectedInspector.getBoundingClientRect()
      const noHorizontalScroll = tableWrap.scrollWidth <= tableWrap.clientWidth + 1
      const emotes = Array.from(
        document.querySelectorAll('.pulse-moments-live__side .pulse-moments__inspector-emote-card'),
      )
      if (emotes.length < 1) {
        return { ok: false, reason: 'no selected-moment emote evidence', noHorizontalScroll, emoteCount: 0 }
      }
      const emotesFullyVisible = emotes.every((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left >= inspectorRect.left - 1 && rect.right <= inspectorRect.right + 1 && rect.width > 0
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

  test('pulse moments table stays readable without horizontal scrolling after the page stack collapses', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    for (const viewport of [{ width: 700, height: 900, card: false }, { width: 390, height: 844, card: true }]) {
      await page.setViewportSize(viewport)
      await page.goto('/analytics')
      const table = page.locator('.figma-activity-hub .pulse-moments-live--embedded .pulse-moments__table')
      await expect(table).toBeVisible()
      const layout = await table.evaluate((element, card) => {
        const table = element as HTMLTableElement
        const wrap = table.closest('.pulse-moments__table-wrap') as HTMLElement | null
        const firstRow = table.tBodies[0]?.rows[0]
        const categoryCell = firstRow?.cells[2]
        const viewerCell = firstRow?.cells[7]
        return {
          noHorizontalScroll: Boolean(wrap) && wrap!.scrollWidth <= wrap!.clientWidth + 1,
          noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
          tableLayout: getComputedStyle(table).tableLayout,
          rowDisplay: firstRow ? getComputedStyle(firstRow).display : '',
          categoryDisplay: categoryCell ? getComputedStyle(categoryCell).display : '',
          categoryBottom: categoryCell?.getBoundingClientRect().bottom ?? 0,
          momentTop: firstRow?.cells[4]?.getBoundingClientRect().top ?? 0,
          channelWidth: firstRow?.cells[1]?.getBoundingClientRect().width ?? 0,
          viewerDisplay: viewerCell ? getComputedStyle(viewerCell).display : '',
          expectedCard: card,
        }
      }, viewport.card)
      expect(layout.noHorizontalScroll, JSON.stringify(layout)).toBe(true)
      expect(layout.noPageOverflow, JSON.stringify(layout)).toBe(true)
      expect(layout.viewerDisplay).toBe('none')
      if (viewport.card) {
        expect(layout.rowDisplay).toBe('grid')
        expect(layout.categoryDisplay).not.toBe('none')
        expect(layout.channelWidth).toBeGreaterThan(120)
        expect(layout.momentTop).toBeGreaterThanOrEqual(layout.categoryBottom)
      } else {
        expect(layout.tableLayout).toBe('fixed')
        expect(layout.categoryDisplay).toBe('none')
      }
    }
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

  test('Live Wire tape is chart-relative, selects its minute, and never nests navigation', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')

    const tape = page.getByRole('region', { name: 'Live Wire' })
    await expect(tape).toBeVisible()
    await expect(page.locator('.figma-global-activity__annotation-lane .hub-live-wire')).toHaveCount(0)
    await expect(tape.locator('a .hub-live-wire__event-card')).toHaveCount(0)
    await expect(tape.locator('.hub-live-wire__event-card a')).not.toHaveCount(0)
    await expect(tape.locator('.hub-live-wire__bar')).toHaveCount(0)
    await expect(tape.locator('[role="progressbar"]')).toHaveCount(0)
    await expect(tape.locator('.hub-live-wire__rail-metrics').first()).toContainText(/chat/i)
    await expect(tape.locator('.hub-live-wire__rail-metrics').first()).toContainText(/emotes/i)

    const sodaCard = tape.locator('[data-stream-id="s2"]').getByRole('button', { name: /^Show .* on chart$/ })
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

    const emoteCardBounds = await emoteCard.boundingBox()
    expect(emoteCardBounds?.height).toBeGreaterThanOrEqual(114)
    expect(emoteCardBounds?.height).toBeLessThanOrEqual(117)
    // Vite dev and production preview differ by one rasterized font pixel.
    // Keep the visual comparison stable while checking the natural height above.
    await emoteCard.evaluate((element) => {
      element.style.boxSizing = 'border-box'
      element.style.height = '116px'
    })
    await expect(emoteCard).toHaveScreenshot('moment-inspector-top-emote-card.png', {
      maxDiffPixelRatio: 0.04,
    })
    await assertNoConsoleErrors(page, errors)
  })

  test('idle shared sidecar shows Live Wire instead of the retired default inspector', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const liveDesk = page.getByRole('region', { name: 'Live Wire' })
    await expect(liveDesk).toBeVisible()
    await expect(liveDesk.getByRole('heading', { name: 'Live Wire' })).toBeVisible()
    await expect(page.locator('.figma-global-activity__inspector')).toBeHidden()

    await assertNoConsoleErrors(page, errors)
  })

  test('embedded moments list uses full width until explicit selection opens its side inspector', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/analytics')

    await expect(page.locator('.pulse-moments-live__side')).toHaveCount(0)
    await expect(page.locator('.pulse-moments-live__grid')).toHaveAttribute('data-has-selection', 'false')
    await expect(page.locator('.pulse-moments__peak-row').first()).toBeVisible()
    const idleLayout = await page.evaluate(() => {
      const embedded = document.querySelector('.pulse-moments-live.pulse-moments-live--embedded')
      const grid = embedded?.querySelector('.pulse-moments-live__grid')
      const tableWrap = embedded?.querySelector('.pulse-moments__table-wrap')
      if (!embedded || !grid || !tableWrap) {
        return { ok: false, reason: 'expected embedded moments grid and table' }
      }
      const tableRect = tableWrap.getBoundingClientRect()
      const gridRect = grid.getBoundingClientRect()
      return {
        ok: tableRect.width >= gridRect.width * 0.9,
        tableWidth: tableRect.width,
        gridWidth: gridRect.width,
      }
    })
    expect(idleLayout.ok, JSON.stringify(idleLayout)).toBe(true)

    await page.locator('.pulse-moments__peak-row').first().click()
    const side = page.locator('.pulse-moments-live__side')
    await expect(side).toBeVisible()
    await expect(page.locator('.pulse-moments-live__grid')).toHaveAttribute('data-has-selection', 'true')
    const layout = await page.evaluate(() => {
      const embedded = document.querySelector('.pulse-moments-live.pulse-moments-live--embedded')
      const grid = embedded?.querySelector('.pulse-moments-live__grid')
      const tableWrap = embedded?.querySelector('.pulse-moments__table-wrap')
      const side = embedded?.querySelector('.pulse-moments-live__side')
      if (!embedded || !grid || !tableWrap || !side) {
        return { ok: false, reason: 'expected selected moment inspector beside table' }
      }
      const tableRect = tableWrap.getBoundingClientRect()
      const sideRect = side.getBoundingClientRect()
      const gridRect = grid.getBoundingClientRect()
      return {
        ok: tableRect.width < gridRect.width * 0.9 && sideRect.left >= tableRect.right - 4 && sideRect.width >= 220,
        sideBesideTable: sideRect.left >= tableRect.right - 4,
        sideMinWidth: sideRect.width >= 220,
      }
    })
    expect(layout.ok, JSON.stringify(layout)).toBe(true)
    await expect(page.locator('.pulse-moments-live__side .pulse-moments__inspector')).toBeVisible()
    await expect(page.locator('.activity-bucket-inspector--moment')).toHaveCount(0)
    await expect(page.getByTestId('bucket-inspector-linked-moment')).toBeVisible()
    await expect(page.locator('.pulse-moments-live__side .emote-rank-row *[class*="share"]').first()).toBeVisible()

    await assertNoConsoleErrors(page, errors)
  })

  test('idle Live Wire exposes verified streamer-relative detections', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await installHubUxMock(page, { withComparisons: true })
    await page.goto('/analytics')
    const liveDesk = page.getByRole('region', { name: 'Live Wire' })
    await expect(liveDesk).toBeVisible()
    // The multiplier is the headline; the full streamer-relative claim rides
    // along on the chip rather than spending a line of its own.
    await expect(liveDesk.locator('.hub-live-wire__magnitude').first()).toHaveAttribute(
      'title',
      /this stream's earlier average/i,
    )
    await expect(liveDesk.getByRole('button', { name: /Show xQc.*on chart/i })).toBeVisible()
    await assertNoConsoleErrors(page, errors)
  })

  test('desktop activity sidecar cannot create a blank tail below the chart', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto('/analytics')
    await expect(page.locator('.figma-global-activity__hub-chart')).toBeVisible()

    const geometry = await page.evaluate(() => {
      const body = document.querySelector('.figma-global-activity__body')
      const chart = document.querySelector('.figma-global-activity__chart-col')
      const inspector = document.querySelector('.figma-global-activity__inspector')
      const moments = document.querySelector('#section-pulse-moments')
      if (!body || !chart || !inspector || !moments) {
        return { ok: false, reason: 'missing activity layout element' }
      }
      const bodyRect = body.getBoundingClientRect()
      const chartRect = chart.getBoundingClientRect()
      const inspectorRect = inspector.getBoundingClientRect()
      const momentsRect = moments.getBoundingClientRect()
      const inspectorStyle = getComputedStyle(inspector)
      return {
        ok:
          inspectorStyle.display === 'none' &&
          Math.abs(bodyRect.bottom - chartRect.bottom) <= 2 &&
          momentsRect.top - bodyRect.bottom <= 24,
        bodyBottom: bodyRect.bottom,
        chartBottom: chartRect.bottom,
        inspectorBottom: inspectorRect.bottom,
        momentsTop: momentsRect.top,
        inspectorDisplay: inspectorStyle.display,
      }
    })
    expect(geometry.ok, JSON.stringify(geometry)).toBe(true)
    await assertNoConsoleErrors(page, errors)
  })

  test('global activity shell keeps its plot, readout, navigator, and coverage in frame', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await page.addStyleTag({ content: '.analytics-topnav { position: static !important; }' })
    await expect(page.locator('.figma-activity-hub')).toBeVisible()
    await expect(page.locator('.figma-global-activity')).toBeVisible()
    await expect(page.locator('.figma-global-activity .hx-chart2')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Live Wire' })).toBeVisible()
    await assertNoWhiteAnalyticsSurfaces(page)
    await expect(page.locator('.hx-chart-header__readout')).toBeVisible()
    await expect(page.locator('.hx-chart-navigator')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Emote provider sparklines' }).locator('.hx-provider-lane')).toHaveCount(4)
    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('.figma-global-activity')
      const plot = shell?.querySelector('.hx-plot-stack__plot--chart')
      const navigator = shell?.querySelector('.hx-chart-navigator')
      const providers = shell?.querySelector('.hx-provider-lanes')
      if (!shell || !plot || !navigator || !providers) return { ok: false, reason: 'missing chart region' }
      const shellRect = shell.getBoundingClientRect()
      const plotRect = plot.getBoundingClientRect()
      const navigatorRect = navigator.getBoundingClientRect()
      const providerRect = providers.getBoundingClientRect()
      return {
        ok: shellRect.width <= window.innerWidth + 2 && plotRect.width >= 720 && plotRect.height >= 360 &&
          navigatorRect.top >= plotRect.bottom - 2 && providerRect.top >= navigatorRect.bottom - 2 &&
          providerRect.right <= shellRect.right + 2 && providerRect.bottom <= shellRect.bottom + 2,
        shellWidth: shellRect.width,
        plotWidth: plotRect.width,
        plotHeight: plotRect.height,
        navigatorBelowPlot: navigatorRect.top >= plotRect.bottom - 2,
        providersBelowNavigator: providerRect.top >= navigatorRect.bottom - 2,
        providersInShell: providerRect.right <= shellRect.right + 2 && providerRect.bottom <= shellRect.bottom + 2,
      }
    })
    expect(geometry.ok, JSON.stringify(geometry)).toBe(true)
    await assertNoConsoleErrors(page, errors)
  })
})
