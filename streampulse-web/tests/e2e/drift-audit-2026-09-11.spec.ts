import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUDIT_EVIDENCE_DIR,
  AUDIT_ROUTES,
  AUDIT_WIDTHS,
  CHART_SURFACES,
  captureRouteSurface,
  probeHoverOcclusion,
  probeHoverTargets,
  probeWheelBehaviour,
  type RouteSurface,
} from './helpers/driftAudit'
import {
  FIXTURE_BROADCASTS,
  FIXTURE_HISTORY_URL,
  FIXTURE_MONTH_URL,
  FIXTURE_PAGE_SIZE,
  FIXTURE_TOTAL_DETECTIONS,
  installDiscoveryFixture,
} from './helpers/discoveryFixture'

/**
 * Live-surface half of the 2026-09-11 analytics drift audit. Runs in the
 * default `chromium` project against the dev server the Playwright config
 * starts, with the hosted API as the portal's backend — so it exercises real
 * data including the ohnePixel 2026-09-03 day.
 *
 * This spec captures evidence. It asserts only the handoff's hard acceptance
 * conditions; everything else is recorded for classification by hand.
 */

const surface = process.env.PORTAL_E2E_MOCKED === '1' ? 'mocked' : 'live'
const outDir = join(AUDIT_EVIDENCE_DIR, surface)

test.beforeAll(() => {
  mkdirSync(outDir, { recursive: true })
})

test.describe('drift audit 2026-09-11', () => {
  test.describe.configure({ mode: 'serial' })

  for (const width of AUDIT_WIDTHS) {
    test(`route surface matrix @ ${width}`, async ({ page }, testInfo) => {
      test.setTimeout(240_000)
      await page.setViewportSize({ width, height: 900 })

      const rows: RouteSurface[] = []
      for (const route of AUDIT_ROUTES) {
        const row = await captureRouteSurface(page, route)
        rows.push(row)
        await page.screenshot({
          path: join(outDir, `${route.slug}-${width}-top.png`),
          fullPage: false,
        })
        await testInfo.attach(`${route.slug}-${width}.png`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      }

      writeFileSync(join(outDir, `routes-${width}.json`), JSON.stringify(rows, null, 2))

      // Acceptance: no document-level horizontal overflow at any target width.
      const overflowing = rows.filter(row => row.horizontalOverflow > 1)
      expect(
        overflowing.map(row => `${row.slug}: +${row.horizontalOverflow}px`),
        `horizontal overflow at ${width}px`,
      ).toEqual([])

      // Acceptance: hosted compatibility URLs reach an intentional destination.
      const explore = rows.filter(row => row.slug.startsWith('explore'))
      for (const row of explore) {
        expect(row.notFound, `${row.requestedPath} must not be Page not found`).toBe(false)
        expect(row.finalUrl, `${row.requestedPath} must resolve into Moments`).toContain(
          '/analytics/moments',
        )
      }
    })
  }

  for (const width of [1440, 1920] as const) {
    test(`hub chart wheel semantics @ ${width}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/analytics', { waitUntil: 'domcontentloaded' })

      await page
        .locator(CHART_SURFACES.hub)
        .first()
        .waitFor({ state: 'attached', timeout: 60_000 })
      // Alt/Shift gestures are inert until the navigator actually has buckets
      // to move (`HubChartNavigator` returns early when maxIndex <= 1), so wait
      // for real data rather than measuring a loading skeleton.
      const navigatorReady = await page
        .waitForFunction(
          () => {
            const node = document.querySelector('[data-hub-chart-navigator-window]')
            const window = node?.getAttribute('data-hub-chart-navigator-window')
            if (!window) return false
            const [start, end] = window.split(':').map(Number)
            return Number.isFinite(start) && Number.isFinite(end) && end - start >= 1
          },
          { timeout: 60_000 },
        )
        .then(() => true)
        .catch(() => false)

      const probe = await probeWheelBehaviour(page, CHART_SURFACES.hub)
      writeFileSync(
        join(outDir, `wheel-hub-${width}.json`),
        JSON.stringify({ navigatorReady, ...probe }, null, 2),
      )
      await testInfo.attach(`wheel-hub-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      expect(probe.chartFound, 'the hub chart wheel surface was not found').toBe(true)
      const { plain, altZoomIn, altZoomOutAtFullRange } = probe

      // Guard against a false pass: the pointer must really be over the chart.
      expect(plain!.pointerInsideChart, 'plain-wheel pointer was not over the chart').toBe(true)
      expect(altZoomIn!.pointerInsideChart, 'alt-wheel pointer was not over the chart').toBe(true)
      // And the modifier must actually reach the page.
      expect(
        altZoomIn!.prevented.every(record => record.altKey),
        'Alt was not delivered with the wheel event',
      ).toBe(true)

      // Acceptance: ordinary vertical scrolling never stalls over the chart.
      expect(plain!.scrolled, 'ordinary wheel over the chart must scroll the page').toBe(true)
      expect(
        plain!.prevented.some(record => record.prevented),
        'ordinary wheel over the chart must not be preventDefault()ed',
      ).toBe(false)

      // The boundary rule: with nothing left to zoom out to, the chart must not
      // consume the gesture and the page keeps scrolling.
      expect(
        altZoomOutAtFullRange!.prevented.some(record => record.prevented),
        'Alt+wheel at full range must not be consumed',
      ).toBe(false)
      expect(
        altZoomOutAtFullRange!.scrolled,
        'Alt+wheel at full range must still scroll the page',
      ).toBe(true)

      // Only claim the documented gesture works when the navigator had data.
      if (navigatorReady) {
        expect(
          altZoomIn!.prevented.some(record => record.prevented),
          'Alt+wheel zooming in must be consumed by the chart',
        ).toBe(true)
        expect(altZoomIn!.scrolled, 'Alt+wheel zooming in must not scroll the page').toBe(false)
      }
    })
  }

  test('console chart wheel semantics @ 1440', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/analytics/ohnepixel/317718621667', { waitUntil: 'domcontentloaded' })

    // This is the surface that actually renders PulseMultiSignalChart. If the
    // stream no longer resolves upstream the chart never mounts, which is
    // recorded as unavailable evidence instead of passing vacuously.
    const charted = await page
      .locator(CHART_SURFACES.console)
      .first()
      .waitFor({ state: 'attached', timeout: 60_000 })
      .then(() => true)
      .catch(() => false)

    const probe = charted ? await probeWheelBehaviour(page, CHART_SURFACES.console) : null
    writeFileSync(
      join(outDir, 'wheel-console-1440.json'),
      JSON.stringify({ charted, ...(probe ?? {}) }, null, 2),
    )
    await testInfo.attach('wheel-console-1440.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })

    test.skip(!charted, 'console chart did not mount — upstream stream data unavailable')

    const { plain, altZoomIn, altZoomOutAtFullRange } = probe!
    expect(plain!.pointerInsideChart, 'plain-wheel pointer was not over the chart').toBe(true)
    expect(plain!.scrolled, 'ordinary wheel over the console chart must scroll the page').toBe(true)
    expect(
      plain!.prevented.some(record => record.prevented),
      'ordinary wheel over the console chart must not be preventDefault()ed',
    ).toBe(false)
    expect(
      altZoomIn!.prevented.some(record => record.prevented),
      'Alt+wheel zooming in must be consumed by the console chart',
    ).toBe(true)
    // Same boundary rule as the hub: nothing left to apply means nothing consumed.
    expect(
      altZoomOutAtFullRange!.prevented.some(record => record.prevented),
      'Alt+wheel at full range must not be consumed by the console chart',
    ).toBe(false)
  })

  for (const width of [1120, 1440, 1920] as const) {
    test(`hub inspector stays adjacent to the chart with Live Wire present @ ${width}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/analytics', { waitUntil: 'domcontentloaded' })

      const surface = page.locator(CHART_SURFACES.hub).first()
      await surface.waitFor({ state: 'attached', timeout: 60_000 })
      await surface.scrollIntoViewIfNeeded()
      await page.waitForTimeout(2500)

      // Bucket selection is a click on the chart surface itself.
      const before = await surface.boundingBox()
      expect(before, 'the hub chart surface had no box').not.toBeNull()
      await page.mouse.click(before!.x + before!.width * 0.5, before!.y + before!.height * 0.5)

      const inspector = page.locator('.figma-global-activity__inspector[data-active="true"]')
      const inspectorActive = await inspector
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false)

      const boxes = {
        chart: await surface.boundingBox(),
        inspector: inspectorActive ? await inspector.boundingBox() : null,
        liveWire: await page.locator('.analytics-discovery-layout__wire').first().boundingBox(),
        rightRail: await page.locator('.figma-analytics__right-rail').first().boundingBox(),
      }
      // Which rule actually lays this out, so any fix targets the real cause.
      const layout = await page.evaluate(() => {
        const read = (selector: string) => {
          const node = document.querySelector(selector)
          if (!node) return null
          const style = getComputedStyle(node)
          return {
            selector,
            width: node.getBoundingClientRect().width,
            display: style.display,
            gridTemplateColumns: style.gridTemplateColumns,
            containerType: style.containerType,
          }
        }
        return {
          frame: read('.figma-analytics__frame'),
          hub: read('.figma-activity-hub'),
          discovery: read('.analytics-discovery-layout'),
          body: read('.figma-global-activity__body'),
        }
      })

      // Opening the inspector narrows the chart, which makes the fixed-width
      // hover tooltip cover a larger share of the plot it is explaining.
      const occlusionWithInspector = await probeHoverOcclusion(
        page,
        CHART_SURFACES.hub,
        '.hx-chart-tip-slot .tip',
      )
      writeFileSync(
        join(outDir, `hub-inspector-${width}.json`),
        JSON.stringify(
          {
            width,
            inspectorActive,
            chartWidthBeforeSelection: before!.width,
            chartWidthAfterSelection: boxes.chart?.width ?? null,
            occlusionWithInspector,
            layout,
            boxes,
          },
          null,
          2,
        ),
      )
      await page.screenshot({ path: join(outDir, `hub-inspector-${width}.png`) })
      await testInfo.attach(`hub-inspector-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      test.skip(!inspectorActive, 'no bucket became selectable — hub activity data unavailable')

      // Acceptance: selected detail stays within practical reach of the chart
      // it describes, even with the Live Wire rail present.
      expect(
        Math.abs(boxes.inspector!.y - boxes.chart!.y),
        'the bucket inspector drifted more than a viewport from the chart',
      ).toBeLessThan(900)
    })
  }

  for (const width of [390, 1440] as const) {
    test(`activity calendar reads as one control @ ${width}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      await installDiscoveryFixture(page)
      await page.setViewportSize({ width, height: 900 })
      await page.goto(FIXTURE_MONTH_URL, { waitUntil: 'domcontentloaded' })

      const grid = page.locator('.discovery-calendar__days')
      await grid.waitFor({ state: 'visible', timeout: 30_000 })
      const legend = page.locator('.discovery-calendar__legend')
      await legend.waitFor({ state: 'visible', timeout: 15_000 })

      const evidence = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.discovery-calendar__days button')]
        const swatch = (node: Element) => getComputedStyle(node).backgroundColor
        return {
          levelsPresent: [
            ...new Set(
              cells
                .map(cell => cell.getAttribute('data-level'))
                .filter((level): level is string => level != null),
            ),
          ].sort(),
          states: [...new Set(cells.map(cell => cell.getAttribute('data-state')))].sort(),
          legendRampSwatches: [
            ...document.querySelectorAll('.discovery-calendar__legend-ramp i'),
          ].map(swatch),
          legendKeys: [...document.querySelectorAll('.discovery-calendar__legend-key')].map(
            node => node.textContent?.trim() ?? '',
          ),
          // Compare a day cell against the legend swatch for the same level.
          cellSwatchesByLevel: Object.fromEntries(
            ['0', '1', '2', '3', '4'].map(level => [
              level,
              swatch(
                cells.find(cell => cell.getAttribute('data-level') === level) ??
                  document.body,
              ),
            ]),
          ),
        }
      })
      writeFileSync(
        join(outDir, `calendar-${width}.json`),
        JSON.stringify(evidence, null, 2),
      )
      await page.screenshot({ path: join(outDir, `calendar-${width}.png`), fullPage: true })
      await testInfo.attach(`calendar-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      // The fixture is built so every ramp level is exercised.
      expect(evidence.levelsPresent, 'not every intensity level rendered').toEqual([
        '0',
        '1',
        '2',
        '3',
        '4',
      ])
      // One legend, carrying the ramp plus the two off-ramp states.
      expect(evidence.legendRampSwatches).toHaveLength(5)
      expect(evidence.legendKeys.join(' | ')).toContain('No measurement')
      expect(evidence.legendKeys.join(' | ')).toMatch(/0 (detected moments|chat messages|emote uses)/)
      // Calendar and heatmap are one encoding: legend swatch === cell fill.
      for (const [level, swatch] of Object.entries(evidence.cellSwatchesByLevel)) {
        expect(swatch, `level ${level} cell does not match its legend swatch`).toBe(
          evidence.legendRampSwatches[Number(level)],
        )
      }
      // The rejected green ramp must be gone: cyan means blue ≥ green channel.
      for (const swatch of evidence.legendRampSwatches) {
        const [, red, green, blue] = /rgba?\((\d+), (\d+), (\d+)/.exec(swatch) ?? []
        expect(Number(blue), `${swatch} is not on a cyan ramp`).toBeGreaterThanOrEqual(
          Number(green),
        )
        expect(Number(blue), `${swatch} is not cool-toned`).toBeGreaterThanOrEqual(Number(red))
      }
    })
  }

  for (const width of [390, 1440] as const) {
    test(`stored day groups detections by broadcast @ ${width}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      await installDiscoveryFixture(page)

      // Every catalogue read, to prove card count does not multiply requests.
      const catalogueReads: string[] = []
      page.on('request', request => {
        if (request.url().includes('/v1/public/discovery')) catalogueReads.push(request.url())
      })

      await page.setViewportSize({ width, height: 900 })
      await page.goto(FIXTURE_HISTORY_URL, { waitUntil: 'domcontentloaded' })

      const sections = page.locator('.moments-broadcast')
      await sections.first().waitFor({ state: 'visible', timeout: 30_000 })

      const readsAfterFirstPage = catalogueReads.length
      const rowsAfterFirstPage = await page.locator('.moments-broadcast__open').count()

      // Walk the bounded pagination to the end of the day.
      const loadMore = page.getByRole('button', { name: /Load more indexed moments/i })
      for (let guard = 0; guard < 10 && (await loadMore.count()); guard += 1) {
        await loadMore.click()
        await page.waitForTimeout(600)
      }
      const rowsBeforeDisclosure = await page.locator('.moments-broadcast__open').count()
      const readsBeforeDisclosure = catalogueReads.length
      // The default state readers actually land on, with every page loaded.
      await page.screenshot({
        path: join(outDir, `broadcasts-${width}-capped.png`),
        fullPage: true,
      })

      // Clustered mode must actually fold adjacent minutes, not just cap rows.
      const clusteredRows = await page.locator('.moments-broadcast__open').count()
      const foldedRows = await page.locator('.moments-broadcast__open[data-cluster-size]').count()

      // Then expand each broadcast's own disclosure so every detection is reachable.
      const expanders = page.getByRole('button', { name: /Show all .* loaded detections/i })
      for (let guard = 0; guard < 10 && (await expanders.count()); guard += 1) {
        await expanders.first().click()
        await page.waitForTimeout(250)
      }

      const evidence = await page.evaluate(() => {
        const sections = [...document.querySelectorAll('.moments-broadcast')]
        return {
          broadcastCount: sections.length,
          streamIds: sections.map(
            section => section.querySelector('.moments-broadcast__stream-id')?.textContent?.trim() ?? '',
          ),
          rowsPerBroadcast: sections.map(
            section => section.querySelectorAll('.moments-broadcast__open').length,
          ),
          // One shared locator strip per broadcast, never one per row.
          stripsPerBroadcast: sections.map(
            section => section.querySelectorAll('.moments-broadcast__strip-track').length,
          ),
          svgsInsideSections: sections.reduce(
            (total, section) => total + section.querySelectorAll('svg').length,
            0,
          ),
          iframes: document.querySelectorAll('iframe').length,
          heading: document.querySelector('.moments-results h2')?.textContent?.trim() ?? '',
        }
      })

      const totalRows = evidence.rowsPerBroadcast.reduce((sum, count) => sum + count, 0)
      writeFileSync(
        join(outDir, `broadcasts-${width}.json`),
        JSON.stringify(
          { width, readsAfterFirstPage, rowsAfterFirstPage, rowsBeforeDisclosure, readsBeforeDisclosure, clusteredRows, foldedRows, catalogueReads: catalogueReads.length, totalRows, ...evidence },
          null,
          2,
        ),
      )
      await page.screenshot({ path: join(outDir, `broadcasts-${width}.png`), fullPage: true })
      await testInfo.attach(`broadcasts-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      // Acceptance: distinct broadcasts on one day stay distinct.
      expect(evidence.broadcastCount, 'the day did not split into its broadcasts').toBe(
        FIXTURE_BROADCASTS.length,
      )
      expect(new Set(evidence.streamIds).size, 'broadcasts share a stream id').toBe(
        FIXTURE_BROADCASTS.length,
      )
      expect(evidence.streamIds.sort()).toEqual(
        FIXTURE_BROADCASTS.map(broadcast => broadcast.streamId).slice().sort(),
      )

      // Acceptance: all detections reachable, but not all at once.
      expect(rowsAfterFirstPage, 'the first page was not bounded').toBeLessThanOrEqual(
        FIXTURE_PAGE_SIZE,
      )
      expect(totalRows, 'not every detection became reachable').toBe(FIXTURE_TOTAL_DETECTIONS)
      // Even with every page loaded, a busy broadcast does not dump every row
      // until the reader asks — and asking costs no further request.
      expect(
        rowsBeforeDisclosure,
        'all detections rendered before the per-broadcast disclosure was opened',
      ).toBeLessThan(FIXTURE_TOTAL_DETECTIONS)
      expect(catalogueReads.length, 'expanding rows issued a request').toBe(readsBeforeDisclosure)
      // Blueprint: cluster duplicate peaks rather than listing adjacent minutes.
      expect(foldedRows, 'no row folded adjacent detections together').toBeGreaterThan(0)
      expect(clusteredRows, 'clustered view showed more rows than the raw cap').toBeLessThanOrEqual(
        FIXTURE_BROADCASTS.length * 12,
      )

      // Acceptance: card count does not multiply requests or chart mounts.
      expect(evidence.stripsPerBroadcast, 'more than one strip per broadcast').toEqual(
        evidence.rowsPerBroadcast.map(() => 1),
      )
      expect(evidence.svgsInsideSections, 'a chart was mounted per detection row').toBe(0)
      expect(evidence.iframes, 'a player was mounted without an explicit action').toBe(0)
      expect(
        catalogueReads.length,
        'catalogue reads grew faster than pages',
      ).toBeLessThanOrEqual(6)

      expect(evidence.heading).toContain(`${FIXTURE_BROADCASTS.length} broadcasts`)

      // Selecting a detection row must open the inspector, agree with the
      // broadcast's locator strip, and not overflow the narrowed results column.
      await page.locator('.moments-broadcast__open').nth(3).click()
      await page.locator('.moments-detail').waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForTimeout(1200)
      const selection = await page.evaluate(() => ({
        selectedRows: document.querySelectorAll('.moments-broadcast__table tbody tr.is-selected').length,
        selectedStripTicks: document.querySelectorAll('.moments-broadcast__strip-track i[data-selected="true"]').length,
        inspectorVisible: Boolean(document.querySelector('.moments-detail')),
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        tableOverflow: [...document.querySelectorAll('.moments-broadcast__table')].map(
          table => table.scrollWidth - (table.parentElement?.clientWidth ?? table.scrollWidth),
        ),
      }))
      writeFileSync(
        join(outDir, `broadcast-selection-${width}.json`),
        JSON.stringify(selection, null, 2),
      )
      await page.screenshot({
        path: join(outDir, `broadcast-selection-${width}.png`),
        fullPage: false,
      })

      expect(selection.inspectorVisible, 'selecting a row did not open the inspector').toBe(true)
      // Exactly one row and one strip tick agree on the selection.
      expect(selection.selectedRows, 'the selected row is not marked').toBe(1)
      expect(selection.selectedStripTicks, 'the strip does not agree with the selected row').toBe(1)
      expect(
        selection.horizontalOverflow,
        'reviewing a detection introduced horizontal overflow',
      ).toBeLessThanOrEqual(1)
      for (const overflow of selection.tableOverflow) {
        expect(overflow, 'the detections table overflows its column').toBeLessThanOrEqual(1)
      }
    })
  }

  for (const width of [768, 1440, 1920] as const) {
    test(`hover states @ ${width}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width, height: 900 })

      await page.goto('/analytics', { waitUntil: 'domcontentloaded' })
      const surface = page.locator(CHART_SURFACES.hub).first()
      await surface.waitFor({ state: 'attached', timeout: 60_000 })
      await surface.scrollIntoViewIfNeeded()
      await page.waitForTimeout(2500)

      const occlusion = await probeHoverOcclusion(
        page,
        CHART_SURFACES.hub,
        '.hx-chart-tip-slot .tip',
      )
      await page.screenshot({ path: join(outDir, `hover-chart-${width}.png`) })

      const hubHovers = [
        ...(await probeHoverTargets(page, '.hub-live-wire__rail-card')),
        ...(await probeHoverTargets(page, '.analytics-discovery-layout__moments-link', 1)),
      ]

      await page.goto('/analytics/moments', { waitUntil: 'domcontentloaded' })
      await page
        .locator('.moments-result')
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 })
      const momentHovers = [
        ...(await probeHoverTargets(page, '.moments-result')),
        ...(await probeHoverTargets(page, '.moments-row-emotes span')),
        ...(await probeHoverTargets(page, '.moment-category-card', 2)),
      ]
      await page.screenshot({ path: join(outDir, `hover-moments-${width}.png`) })

      const hovers = [...hubHovers, ...momentHovers]
      writeFileSync(
        join(outDir, `hover-${width}.json`),
        JSON.stringify({ width, occlusion, hovers }, null, 2),
      )
      await testInfo.attach(`hover-moments-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      // Hovering must never move the element under the pointer.
      const shifted = hovers.filter(result => result.found && result.shifted)
      expect(
        shifted.map(result => `${result.selector}[${result.index}]`),
        'hover moved the hovered target',
      ).toEqual([])
    })
  }

  for (const width of [1440, 1920] as const) {
    test(`selection adjacency and playback gating @ ${width}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width, height: 900 })

      // Count every Twitch player request for the whole test, including ones
      // issued before any click.
      const playerRequests: string[] = []
      await page.route('**://player.twitch.tv/**', route => {
        playerRequests.push(route.request().url())
        return route.fulfill({ status: 204, body: '' })
      })

      await page.goto('/analytics/moments', { waitUntil: 'domcontentloaded' })
      const firstCard = page.locator('.moments-result .moments-card-primary').first()
      await firstCard.waitFor({ state: 'visible', timeout: 60_000 })

      const requestsBeforeSelection = playerRequests.length
      await firstCard.click()
      const detail = page.locator('.moments-detail')
      await detail.waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(2500)

      const selectedBox = await page.locator('.moments-result.is-selected').first().boundingBox()
      const detailBox = await detail.boundingBox()
      const requestsAfterSelection = playerRequests.length

      // Item 7: gated playback. The button only exists when a VOD mapping was
      // verified, so its absence is recorded rather than asserted away.
      const loadButton = page.locator('[data-vod-player-mounted="false"]')
      const loadButtonPresent = (await loadButton.count()) > 0
      let requestsAfterLoad: number | null = null
      let mountedPlayers: number | null = null
      if (loadButtonPresent) {
        await loadButton.first().click()
        await page.waitForTimeout(2500)
        requestsAfterLoad = playerRequests.length
        mountedPlayers = await page.locator('[data-vod-player-mounted="true"]').count()
      }

      const evidence = {
        width,
        requestsBeforeSelection,
        requestsAfterSelection,
        loadButtonPresent,
        requestsAfterLoad,
        mountedPlayers,
        selectedBox,
        detailBox,
        verticalGap:
          selectedBox && detailBox ? Math.abs(detailBox.y - selectedBox.y) : null,
      }
      writeFileSync(
        join(outDir, `selection-${width}.json`),
        JSON.stringify(evidence, null, 2),
      )
      await testInfo.attach(`selection-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      // Acceptance: no playback request before an explicit user action.
      expect(requestsBeforeSelection, 'a player was requested before any selection').toBe(0)
      expect(requestsAfterSelection, 'selecting a card must not request playback').toBe(0)
      if (loadButtonPresent) {
        expect(mountedPlayers, 'at most one player may be mounted').toBeLessThanOrEqual(1)
        expect(requestsAfterLoad, 'loading the preview should request the player').toBeGreaterThan(
          0,
        )
      }

      // Acceptance: a selected card and its inspector stay in reach of each other.
      expect(selectedBox, 'no selected card was found').not.toBeNull()
      expect(detailBox, 'no inspector was found').not.toBeNull()
      expect(
        Math.abs(detailBox!.y - selectedBox!.y),
        'the inspector must stay adjacent to the selected card',
      ).toBeLessThan(900)
    })
  }
})
