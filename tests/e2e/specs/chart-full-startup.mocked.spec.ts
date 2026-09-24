import { readFileSync } from 'node:fs'
import { test, expect } from '../helpers/testFixtures.ts'
import { PULSE_ROOT_ID, assertNoUncaughtErrors, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

const ranges = [
  ['15 min', 900],
  ['30 min', 1800],
  ['1 hour', 3600],
  ['2 hours', 7200],
  ['4 hours', 14400],
  ['Full stream', Infinity],
] as const

for (const duration of [120, 21600]) {
  test(`Full startup and all range zoom controls on a ${duration}-second stream`, async ({
    extension, prepare, evidence,
  }, info) => {
    await prepare({
      storage: { defaultChartWindow: '60m', defaultChartWindowMigratedToFullV3: true },
    })
    const fixture = JSON.parse(readFileSync(
      new URL('../fixtures/api/pulse-live-ready.json', import.meta.url), 'utf8',
    ))
    const rollups = Array.from({ length: duration / 60 }, (_, index) => ({
      offsetSeconds: index * 60,
      chatCount: 30 + index % 11,
      totalEmoteCount: 10 + index % 4,
      sevenTvEmoteCount: 4,
      viewerCount: 800 + index,
      topEmotes: [],
    }))
    const payload = {
      ...fixture,
      startedAt: new Date(Date.now() - duration * 1000).toISOString(),
      currentOffsetSeconds: duration,
      coverageStartOffsetSeconds: 0,
      rollups: rollups.slice(-60),
      fullRollups: rollups,
      peaks: [],
      games: [],
      coverage: {
        ...fixture.coverage,
        coverageStartOffsetSeconds: 0,
        coverageEndOffsetSeconds: duration,
      },
    }
    await extension.context.route(
      'https://api.streampulse.stream/v1/extension/pulse/channels/fixturechan*',
      async route => {
        if (new URL(route.request().url()).pathname.endsWith('/fixturechan')) {
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
        } else {
          await route.fallback()
        }
      },
    )
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    const root = extension.page.locator(`#${PULSE_ROOT_ID}`)
    const chart = root.locator('svg[data-testid="pulse-overview-chart"]')
    const range = root.getByRole('combobox', { name: 'Chart time range' })
    const zoomIn = root.getByRole('button', { name: 'Zoom in chart', exact: true })
    const zoomOut = root.getByRole('button', { name: 'Zoom out chart', exact: true })
    const reset = root.getByRole('button', { name: 'Reset chart view', exact: true })
    const viewport = async () => chart.evaluate(element => ({
      start: Number(element.getAttribute('data-chart-viewport-start')),
      end: Number(element.getAttribute('data-chart-viewport-end')),
    }))
    const span = async () => {
      const current = await viewport()
      return current.end - current.start
    }
    await expect(chart).toBeVisible()
    await expect(range).toContainText('Full stream')
    await expect.poll(span).toBeCloseTo(duration, -1)

    for (const [label, limit] of ranges) {
      await range.click()
      await root.getByRole('option', { name: label, exact: true }).click()
      await expect(range).toContainText(label)
      const maximum = Math.min(limit, duration)
      await expect.poll(span).toBeCloseTo(maximum, -1)
      await expect(zoomOut).toBeDisabled()
      if (duration <= 300) {
        await expect(zoomIn).toBeDisabled()
      } else {
        await expect(zoomIn).toBeEnabled()
        await zoomIn.click()
        await expect.poll(span).toBeLessThan(maximum)
        const zoomed = await viewport()
        expect(zoomed.start).toBeGreaterThanOrEqual(0)
        expect(zoomed.end).toBeLessThanOrEqual(duration + 10)
        await zoomOut.click()
        await expect.poll(span).toBeCloseTo(maximum, -1)
        await zoomIn.click()
        await reset.click()
        await expect.poll(span).toBeCloseTo(maximum, -1)
      }
    }
    await expect.poll(() => extension.serviceWorker.evaluate(async () => (
      await chrome.storage.sync.get('defaultChartWindow')
    ).defaultChartWindow)).toBe('60m')

    if (duration > 300) {
      await range.click()
      await root.getByRole('option', { name: '15 min', exact: true }).click()
      for (let step = 0; step < 6 && await zoomIn.isEnabled(); step++) {
        const previousSpan = await span()
        await zoomIn.click()
        await expect.poll(span).toBeLessThan(previousSpan)
      }
      await expect(zoomIn).toBeDisabled()
      const thumb = root.locator('[data-chart-rail-thumb]')
      await thumb.scrollIntoViewIfNeeded()
      await thumb.hover()
      const startHandle = await root.locator('[data-chart-rail-handle="start"]').boundingBox()
      const endHandle = await root.locator('[data-chart-rail-handle="end"]').boundingBox()
      expect(startHandle).not.toBeNull()
      expect(endHandle).not.toBeNull()
      expect(endHandle!.x - startHandle!.x - startHandle!.width).toBeGreaterThanOrEqual(10)

      const before = await viewport()
      const box = (await thumb.boundingBox())!
      await extension.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await extension.page.mouse.down()
      await extension.page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 8 })
      await extension.page.mouse.up()
      await expect.poll(async () => (await viewport()).start).toBeLessThan(before.start)
      await expect.poll(span).toBeCloseTo(before.end - before.start, 1)
    }

    await range.click()
    await root.getByRole('option', { name: '1 hour', exact: true }).click()
    await extension.page.reload()
    await waitForPulseRoot(extension.page)
    await expect(range).toContainText('Full stream')
    await expect.poll(span).toBeCloseTo(duration, -1)
    await extension.page.screenshot({ path: info.outputPath(`full-startup-${duration}.png`) })
    assertNoUncaughtErrors(evidence)
  })
}
