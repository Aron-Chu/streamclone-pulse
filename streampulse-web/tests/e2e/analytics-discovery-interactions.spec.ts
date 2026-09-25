import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

for (const width of [390, 768, 1440]) {
test(`a detection keeps its reaction headline and exact identity between Live Wire and Moments at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  await installHubUxMock(page, { withComparisons: true })
  await page.goto('/analytics')
  const wireRow = page.getByRole('region', { name: 'Live Wire' }).locator('[data-stream-id="s1"]').first()
  const headline = "Emotes 3.3× this stream's earlier average"
  // Both surfaces state the ratio compactly and keep the full claim on the
  // element itself, so the headline cannot drift between them.
  await expect(wireRow.locator('.hub-live-wire__magnitude')).toHaveText('3.3×')
  await expect(wireRow.locator('.hub-live-wire__magnitude')).toHaveAttribute('title', headline)
  await expect(wireRow.getByRole('link', { name: /^Stream analytics for / })).toHaveAttribute('href', '/analytics/xqc/s1#t=120')
  await expect(wireRow.getByRole('link', { name: /^Open moment for / })).toHaveAttribute('href', /\/analytics\/moments\?view=recent&login=xqc&stream=s1&offset=120/)
  await wireRow.getByRole('link', { name: /^Open moment for / }).click()
  const open = page.locator('[data-discovery-key=\'["xqc","s1",120]\']')
  const result = page.locator('.moments-result').filter({ has: open })
  await expect(page).toHaveURL(/stream=s1&offset=120/)
  await expect(page.getByRole('region', { name: 'Selected moment', exact: true })).toContainText('Twitch emote spike')
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(open).toBeFocused()
  // The row states the same signal and ratio compactly and carries the full
  // headline on the ratio itself, so the two surfaces cannot drift apart.
  await expect(result).toContainText('Emotes 3.3×')
  await expect(result.locator('.moments-result-ratio')).toHaveAttribute('title', headline)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
}

test('hover and Save cannot replace a moment pinned from Live Wire', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')
  const wire = page.getByRole('region', { name: 'Live Wire' })
  const row = wire.locator('[data-stream-id="s1"]').first()
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await row.getByRole('button', { name: /^Show .* on chart$/ }).click()
  await expect(row.getByRole('button', { name: /^Show .* on chart$/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(chart).toHaveAttribute('data-selected', 'true')
  const inspector = page.locator('[aria-label="Moment Inspector"]')
  await expect(inspector).toContainText('Twitch emote spike')
  const before = (await inspector.textContent())!
  const bounds = await chart.boundingBox()
  await chart.hover({ position: { x: bounds!.width * .5, y: bounds!.height * .5 } })
  await expect(inspector).toHaveText(before)
  await expect(row.getByRole('button', { name: /^Show .* on chart$/ })).toHaveAttribute('aria-pressed', 'true')
  await row.getByRole('button', { name: /^Save / }).click()
  const afterSaveY = await page.evaluate(() => scrollY)
  await expect(row.getByRole('button', { name: /^Remove saved / })).toBeFocused()
  await expect(inspector).toHaveText(before)
  await expect(chart).toHaveAttribute('data-selected', 'true')
  expect(await page.evaluate(() => scrollY)).toBe(afterSaveY)
  await expect(row.getByRole('link', { name: /^Stream analytics for / })).toHaveAttribute('href', '/analytics/xqc/s1#t=120')
  await row.getByRole('link', { name: /^Stream analytics for / }).click()
  await expect(page).toHaveURL(/\/analytics\/xqc\/s1#t=120$/)
  await page.goBack()
  await expect(row.getByRole('button', { name: /^Remove saved / })).toBeVisible()
  await expect(row.getByRole('button', { name: /^Show .* on chart$/ })).toHaveAttribute('aria-pressed', 'true')
  await chart.focus()
  await page.keyboard.press('Escape')
  await expect(chart).not.toHaveAttribute('data-selected', 'true')
  await expect(row.getByRole('button', { name: /^Remove saved / })).toBeVisible()
})

test('touch-sized layout keeps the selected moment while saving from the rail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const row = page.getByRole('region', { name: 'Live Wire' }).locator('[data-stream-id="s1"]').first()
  await row.getByRole('button', { name: /^Show .* on chart$/ }).click()
  await row.getByRole('button', { name: /^Save / }).click()
  await expect(row.getByRole('button', { name: /^Remove saved / })).toHaveAttribute('aria-pressed', 'true')
  await expect(row.getByRole('button', { name: /^Show .* on chart$/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[aria-label="Moment Inspector"]')).toContainText('Twitch emote spike')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test('320px Live Wire keeps exact-bucket actions touch-sized and pairwise separate', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await installHubUxMock(page)
  await page.goto('/analytics')
  const row = page.getByRole('region', { name: 'Live Wire' }).locator('[data-stream-id="s1"]').first()
  const actions = row.getByRole('group', { name: /^Actions for / }).locator('a, button')
  await expect(actions).toHaveCount(4)
  const boxes = await actions.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
  }))
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(320)
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
  }
  expect(boxes[0].bottom).toBeLessThanOrEqual(Math.min(...boxes.slice(1).map((box) => box.top)))
  for (let left = 0; left < boxes.length; left++) {
    for (let right = left + 1; right < boxes.length; right++) {
      const a = boxes[left]
      const b = boxes[right]
      const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      expect(overlaps, `actions ${left} and ${right} overlap: ${JSON.stringify({ a, b })}`).toBe(false)
    }
  }
  await expect(row.getByRole('link', { name: /^Open moment for / })).toHaveAttribute('href', /stream=s1&offset=120/)
  await expect(row.getByRole('link', { name: /^Stream analytics for / })).toHaveAttribute('href', '/analytics/xqc/s1#t=120')
  await expect(row.getByRole('button', { name: /^Show .* on chart$/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test('keyboard bucket selection and the Live Wire ticker remain independent', async ({ page }) => {
  await installHubUxMock(page)
  await page.goto('/analytics')
  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  await expect(chart).toBeVisible()
  await chart.focus()
  await page.keyboard.press('ArrowRight')
  // The fixture contains a historical gap after its first bucket. End targets
  // an actual measured bucket; gaps must not be manufactured into selections.
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(chart).toHaveAttribute('data-selected', 'true')
  const wire = page.getByRole('region', { name: 'Live Wire' })
  // The rail carries every loaded detection; it no longer narrows them, so the
  // independence that matters is that its own follow controls never disturb the
  // chart's committed bucket selection.
  await expect(wire.locator('[data-stream-id="s1"]')).toHaveCount(1)
  await expect(wire.locator('[data-stream-id="s2"]')).toHaveCount(1)
  await wire.getByRole('button', { name: 'Pause' }).click()
  await expect(chart).toHaveAttribute('data-selected', 'true')
  await wire.getByRole('button', { name: /^Resume live/ }).click()
  await expect(chart).toHaveAttribute('data-selected', 'true')
  await chart.focus()
  await page.keyboard.press('Escape')
  await expect(chart).not.toHaveAttribute('data-selected', 'true')
  await expect(wire.locator('[data-stream-id="s1"]')).toHaveCount(1)
})
