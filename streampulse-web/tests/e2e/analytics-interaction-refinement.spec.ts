import { expect, test } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

for (const width of [390, 768, 1080, 1150, 1262, 1440, 1920]) {
  test(`hover stays stable and explicit inspector docks responsively at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installHubUxMock(page)
    const requests: string[] = []
    page.on('request', request => { if (request.url().includes('/hub/moments?')) requests.push(request.url()) })
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    await expect(chart).toBeVisible()
    await chart.scrollIntoViewIfNeeded()
    const before = await chart.boundingBox()
    await chart.hover({ position: { x: before!.width * .5, y: before!.height * .5 } })
    await expect(page.locator('.hx-chart-header__readout')).toHaveAttribute('data-active', 'true')
    const after = await chart.boundingBox()
    expect(after!.width).toBeCloseTo(before!.width, 0)
    expect(after!.height).toBeCloseTo(before!.height, 0)
    expect(requests).toHaveLength(0)
    await expect(page.locator('.figma-global-activity__inspector')).not.toBeVisible()
    await chart.click({ position: { x: before!.width * .5, y: before!.height * .5 } })
    const inspector = page.locator('.figma-global-activity__inspector')
    await expect(inspector).toBeVisible()
    const geometry = await inspector.evaluate(element => ({ top: element.getBoundingClientRect().top, left: element.getBoundingClientRect().left }))
    const plot = await chart.boundingBox()
    const docked = geometry.left >= plot!.x + plot!.width - 1
    const stacked = geometry.top >= plot!.y + plot!.height - 1
    expect(docked || stacked).toBe(true)
    const metricTiles = inspector.locator('.activity-bucket-inspector__summary-stats')
    await expect(metricTiles).toBeVisible()
    const selectedValues = await metricTiles.innerText()
    await chart.hover({ position: { x: plot!.width * .2, y: plot!.height * .5 } })
    await expect(page.locator('.hx-hover-status')).toContainText('Hover preview')
    await expect.poll(() => metricTiles.innerText()).toBe(selectedValues)
    await inspector.hover()
    await expect(page.locator('.hx-hover-status')).toContainText('Selected bucket')
    if (docked) {
      expect(plot!.width).toBeGreaterThanOrEqual(720)
      await expect.poll(async () => {
        const column = await page.locator('.figma-global-activity__chart-col').boundingBox()
        const rail = await inspector.boundingBox()
        return Math.abs(rail!.y - column!.y)
      }).toBeLessThan(1)
      const column = await page.locator('.figma-global-activity__chart-col').boundingBox()
      const rail = await inspector.boundingBox()
      expect(Math.abs(rail!.height - column!.height)).toBeLessThanOrEqual(2)
      const providers = await inspector.getByRole('region', { name: 'Selected bucket provider rates' }).boundingBox()
      expect(providers!.y + providers!.height).toBeLessThanOrEqual(rail!.y + rail!.height + 1)
      const largestSectionGap = await inspector.evaluate(element => {
        const sections = [
          '.activity-bucket-inspector__context',
          '.activity-bucket-inspector__matching',
          '.activity-bucket-inspector__providers',
        ].map(selector => element.querySelector(selector)!.getBoundingClientRect())
        return Math.max(...sections.slice(1).map((section, index) => section.top - sections[index].bottom))
      })
      expect(largestSectionGap).toBeLessThanOrEqual(32)
    }
    expect(await inspector.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await chart.focus()
    await page.keyboard.press('Escape')
    await expect(inspector).not.toBeVisible()
  })
}

for (const width of [1440, 1535, 1536, 1920]) {
  test(`outer Live Wire rail preserves chart canvas width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installHubUxMock(page)
    await page.goto('/analytics')
    const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
    const initial = await chart.boundingBox()
    await chart.click({ position: { x: initial!.width * .5, y: initial!.height * .5 } })
    await expect(page.locator('.figma-global-activity__inspector')).toBeVisible()
    const rail = page.locator('.figma-analytics__right-rail')
    await expect(rail).toHaveCount(1)
    const canvas = await chart.boundingBox()
    expect(canvas!.width).toBeGreaterThanOrEqual(720)
    if (width < 1536) {
      await expect(rail).toHaveCSS('position', 'static')
      const network = await page.locator('#section-network').boundingBox()
      const railBox = await rail.boundingBox()
      expect(railBox!.y).toBeGreaterThanOrEqual(network!.y + network!.height - 1)
    } else {
      await expect(rail).toHaveCSS('position', 'sticky')
      const center = await page.locator('.figma-analytics__center').boundingBox()
      const railBox = await rail.boundingBox()
      expect(railBox!.x).toBeGreaterThanOrEqual(center!.x + center!.width - 1)
    }
  })
}

for (const zoom of [.8, 1, 1.25, 1.5, 2]) {
  test(`bucket breakdown fits at ${zoom * 100}% scaling and chart zoom remains local`, async ({ page }) => {
    await page.setViewportSize({ width: 1370, height: 986 })
    await installHubUxMock(page)
    await page.goto('/analytics')
    await page.evaluate(scale => { document.documentElement.style.zoom = String(scale) }, zoom)
    const sectionNav = page.locator('.hub-mobile-sections')
    await expect(sectionNav).toBeVisible()
    expect(await sectionNav.evaluate(el => getComputedStyle(el).gap)).not.toBe('normal')
    const momentsLink = sectionNav.getByRole('link', { name: 'Moments', exact: true })
    await momentsLink.click()
    await expect(momentsLink).toHaveAttribute('aria-current', 'location')
    expect(await sectionNav.getByRole('link').evaluateAll(links => links.every(link => link.getBoundingClientRect().height >= 44 * Number(document.documentElement.style.zoom) - 0.1))).toBe(true)
    const chart = page.locator('.hx-chart2')
    await chart.click()
    const context = page.getByRole('region', { name: 'Bucket breakdown' })
    await expect(context).toBeVisible()
    const inspector = page.locator('.figma-global-activity__inspector')
    expect(await inspector.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    await expect.poll(() => inspector.evaluate(el => {
      const bounds = el.getBoundingClientRect()
      const visible = el.querySelectorAll('.activity-bucket-inspector--summary :is(header, dt, dd, h4, li, a, button)')
      return Array.from(visible).filter(child => child.getClientRects().length > 0).flatMap(child => {
        const box = child.getBoundingClientRect()
        return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
          ? []
          : [{ element: child.tagName, text: child.textContent?.trim(), left: box.left, right: box.right, railLeft: bounds.left, railRight: bounds.right }]
      })
    })).toEqual([])
    await expect(inspector.locator('.activity-bucket-inspector__summary-stats')).toBeVisible()
    await expect(inspector.getByText('Chat / min')).toBeVisible()
    await expect(inspector.getByText('Emotes / min')).toBeVisible()
    await expect(inspector.getByRole('link', { name: /Inspect matching moments/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const navigator = page.locator('[data-hub-chart-navigator]')
  const initial = await navigator.getAttribute('data-hub-chart-navigator-window')
  const headerZoom = page.getByRole('button', { name: 'Zoom graph' })
  const chartRect = await chart.boundingBox()
  const zoomRect = await headerZoom.boundingBox()
  expect(zoomRect!.y + zoomRect!.height).toBeLessThan(chartRect!.y)
  await headerZoom.click()
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial!)
    await expect(page.locator('.hx-chart-header__zoom-status')).toContainText('of 240 buckets')
    await page.getByRole('button', { name: 'Show full range' }).click()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial!)
    await expect(headerZoom).toBeFocused()
    await expect(context).toBeVisible()
    await headerZoom.click()
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', initial!)
    await expect(context).toBeVisible()
    await navigator.locator('.hx-chart-navigator__track').dblclick()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', initial!)
  })
}

test('selected bucket has an in-panel Clear action and no clipped values at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1262, height: 1228 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const plot = await chart.boundingBox()
  await chart.click({ position: { x: plot!.width * .9, y: plot!.height * .5 } })
  const inspector = page.locator('.figma-global-activity__inspector')
  await expect(inspector).toBeVisible()
  await expect(inspector.getByText('Bucket selected')).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'Clear selected bucket' })).toHaveText('Clear selection')
  await expect.poll(async () => {
    const chartColumn = await page.locator('.figma-global-activity__chart-col').boundingBox()
    const summary = await inspector.boundingBox()
    return summary!.x - (chartColumn!.x + chartColumn!.width)
  }).toBeGreaterThanOrEqual(-1)
  const summary = await inspector.boundingBox()
  expect(summary!.y).toBeLessThan(1228)
  await page.mouse.move(0, 0)
  const readout = page.locator('.hx-chart-header__readout')
  await expect(readout).toContainText('Selected bucket')
  await expect(readout).not.toContainText('No interval selected')
  // The side column animates open (grid-template-columns, 240ms); judge containment at rest.
  await expect.poll(() => inspector.evaluate(el => {
    const bounds = el.getBoundingClientRect()
    return Array.from(el.querySelectorAll('.activity-bucket-inspector--summary :is(header, dt, dd, h4, li, a, button)')).filter(child => child.getClientRects().length > 0).every(child => {
      const box = child.getBoundingClientRect()
      return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
    })
  })).toBe(true)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.locator('.hx-hover-status')).not.toContainText('outside the zoomed view')
  await inspector.getByRole('button', { name: 'Clear selected bucket' }).click()
  await expect(inspector).not.toBeVisible()
})

test('explicit zoom reset preserves the locked bucket and peak scope', async ({ page }) => {
  await page.setViewportSize({ width: 1262, height: 1000 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const plot = await chart.boundingBox()
  expect(plot).toBeTruthy()
  await chart.click({ position: { x: plot!.width * .5, y: plot!.height * .5 } })
  const inspector = page.getByRole('complementary', { name: 'Activity bucket inspector' })
  await expect(inspector).toBeVisible()
  const lockedInterval = await inspector.locator('time').textContent()
  const bucketFilter = page.locator('.pulse-moments-live__bucket-filter')
  await expect(bucketFilter).toBeVisible()
  const filterText = await bucketFilter.textContent()

  const navigator = page.locator('[data-hub-chart-navigator]')
  const fullWindow = await navigator.getAttribute('data-hub-chart-navigator-window')
  await navigator.getByRole('button', { name: 'Zoom in' }).click()
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', fullWindow!)
  await expect(page.locator('.hx-chart-summary')).toContainText('Full loaded range:')

  await navigator.getByRole('button', { name: 'Reset zoom' }).click()
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', fullWindow!)
  await expect(page.locator('.hx-chart-summary')).not.toContainText('Full loaded range:')
  await expect(inspector).toBeVisible()
  await expect(inspector.locator('time')).toHaveText(lockedInterval!)
  await expect(bucketFilter).toHaveText(filterText!)
})

test('horizontal trackpad motion pans a zoomed chart while vertical scrolling remains available', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const navigator = page.locator('[data-hub-chart-navigator]')
  await expect(chart).toBeVisible()
  await navigator.getByRole('button', { name: 'Zoom in' }).click()
  const zoomedWindow = await navigator.getAttribute('data-hub-chart-navigator-window')
  await chart.hover()
  await page.mouse.wheel(400, 0)
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', zoomedWindow!)

  const pannedWindow = await navigator.getAttribute('data-hub-chart-navigator-window')
  const scrollBefore = await page.evaluate(() => scrollY)
  await page.mouse.wheel(0, 400)
  await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', pannedWindow!)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore)
})

test('a locked bucket can be brought back into a panned chart view', async ({ page }) => {
  await page.setViewportSize({ width: 1262, height: 1000 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  const plot = await chart.boundingBox()
  await chart.click({ position: { x: plot!.width * .1, y: plot!.height * .5 } })
  await expect(page.locator('.figma-global-activity__inspector')).toBeVisible()
  await expect(chart).toHaveAttribute('data-selected', 'true')
  const navigator = page.locator('[data-hub-chart-navigator]')
  await navigator.getByRole('slider', { name: 'Chart view start' }).focus()
  await page.keyboard.press('End')
  await expect(page.locator('.hx-hover-status')).toContainText('outside the zoomed view')
  await expect(chart).toHaveAttribute('data-selected', 'true')
  const pannedRange = await navigator.getAttribute('data-hub-chart-navigator-window')
  await navigator.getByRole('button', { name: 'Show selected bucket' }).click()
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', pannedRange!)
  await expect(page.locator('.hx-hover-status')).not.toContainText('outside the zoomed view')
  await expect(chart).toHaveAttribute('data-selected', 'true')
})

test('matching moments reclaim the idle inspector column and show reaction imagery', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 986 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const moments = page.locator('#section-pulse-moments')
  await expect(moments.locator('tbody tr').first()).toBeVisible()
  await expect(moments.locator('.pulse-moments-live__side')).toHaveCount(0)
  await expect(moments.locator('tbody tr').first().locator('td').nth(8)).toBeVisible()
  await page.locator('.hx-chart2').click()
  await expect(page.locator('.activity-bucket-inspector--summary')).toBeVisible()
  await page.locator('.figma-global-activity').screenshot({ path: 'test-results/compact-chart-inspector.png' })
})

test('Emote Market supports keyboard tabs and labels its active panel', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')
  const leaders = page.getByRole('tab', { name: 'Leaders', exact: true })
  await leaders.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Concentration', exact: true })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: 'Concentration', exact: true })).toBeVisible()
  await page.keyboard.press('Home')
  await expect(leaders).toHaveAttribute('aria-selected', 'true')
})

test('reduced motion suppresses preview and inspector entrances', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const chart = page.locator('.hx-chart2')
  await chart.hover()
  await expect(page.locator('.hx-chart-header__readout')).toHaveAttribute('data-active', 'true')
  await chart.click()
  const inspector = page.locator('.figma-global-activity__inspector')
  await expect(inspector).toBeVisible()
  expect(await inspector.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
})

test('Live Wire follows polling, holds a hovered row and resumes automatically', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.clock.install()
  await installHubUxMock(page)
  const firstResponse = page.waitForResponse(response => /\/v1\/public\/hub\?/.test(response.url()))
  await page.goto('/analytics')
  const payload = await (await firstResponse).json()
  const wire = page.getByRole('region', { name: 'Live Wire', exact: true })
  await expect(wire.getByText('Following newest')).toBeVisible()
  await page.route(/\/v1\/public\/hub(\?.*)?$/, route => route.fulfill({ json: payload }))
  const original = payload.livePulseMoments[0]
  payload.livePulseMoments = [{ ...original, publicMomentId: 'arrival-one', login: 'arrivalone', displayName: 'Arrival One', streamId: 'arrival-stream-one', at: await page.evaluate(() => Date.now() - 1000) }, ...payload.livePulseMoments]
  await page.clock.fastForward(60000)
  await expect(wire.getByText('Arrival One', { exact: true })).toBeVisible()
  const row = wire.locator('[data-stream-id="arrival-stream-one"]')
  await row.hover()
  const before = (await row.boundingBox())!.y - (await wire.boundingBox())!.y
  payload.livePulseMoments = [{ ...original, publicMomentId: 'arrival-two', login: 'arrivaltwo', displayName: 'Arrival Two', streamId: 'arrival-stream-two', at: await page.evaluate(() => Date.now() - 1000) }, ...payload.livePulseMoments]
  await page.clock.fastForward(60000)
  await expect(wire.getByRole('button', { name: 'Resume live · 1 new' })).toBeVisible()
  await expect(wire.getByText('Arrival Two', { exact: true })).toHaveCount(0)
  // The in-flow wire can move when the preceding activity section changes height.
  // Holding updates must keep the hovered row fixed within the wire itself.
  const after = (await row.boundingBox())!.y - (await wire.boundingBox())!.y
  expect(after).toBeCloseTo(before, 0)
  await page.mouse.move(5, 5)
  await expect(wire.getByText('Arrival Two', { exact: true })).toBeVisible()
})
