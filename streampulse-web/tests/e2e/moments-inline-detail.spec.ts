import { test, expect, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

// The approved 2026-10-06 Moments behaviour: a moment opens in line under its own
// row, the list keeps its width, and a click away (or Esc) closes it.

const detail = (page: Page) => page.getByRole('region', { name: /^Selected moment: / })
const rows = (page: Page) => page.locator('.moments-result')

/**
 * Per-minute rollups for one broadcast, in the shape `/streams/{id}/minutes`
 * returns, around the moment the hub listed at `at`. The broadcast starts off a
 * minute boundary, mid-second, as real ones do, and each offset is truncated to a
 * whole second as the backend does: int(MinuteTS - StartedAt), clamped at 0.
 */
async function installMinutes(page: Page, { streamId, login, offsetSeconds, at, chat, status = 200, through = 15 }: {
  streamId: string; login: string; offsetSeconds: number; chat: (relative: number) => number | 'missing'; status?: number
  /** The hub row's `at`: the moment's own minute. */
  at: number
  /** The latest minute (relative to the moment) the API has returned so far. */
  through?: number
}) {
  const now = Date.now()
  const momentMinute = Math.floor(at / 60_000)
  const startedAtMs = momentMinute * 60_000 - offsetSeconds * 1000 + 17_500
  const reads: URL[] = []
  await page.route(new RegExp(`/v1/portal/analytics/streams/${streamId}/minutes(?:\\?.*)?$`), route => {
    const url = new URL(route.request().url())
    reads.push(url)
    if (status !== 200) return route.fulfill({ status, json: { error: 'stream_unavailable' } })
    const after = Number(url.searchParams.get('afterOffset') ?? 0)
    const minutes = []
    for (let relative = -45; relative <= through; relative++) {
      const minuteMs = (momentMinute + relative) * 60_000
      const offset = Math.max(0, Math.trunc((minuteMs - startedAtMs) / 1000))
      if (minuteMs + 60_000 <= startedAtMs || offset < after) continue
      const value = chat(relative)
      minutes.push(value === 'missing'
        ? { offsetSeconds: offset, viewerAvg: 0, viewerSamples: 0, missing: true }
        : { offsetSeconds: offset, viewerAvg: 9000, viewerSamples: 4, ...(value ? { chatCount: value } : {}) })
    }
    return route.fulfill({ json: { streamId, channel: login, startedAt: new Date(startedAtMs).toISOString(), minutes, updatedAt: now } })
  })
  return reads
}

/** Earlier minutes near the stream's average, climbing into the moment's 393. */
const xqcChat = (relative: number) => relative === -12 ? 'missing' as const
  : relative === 0 ? 393 : Math.round(150 + ((relative * 37 + 100) % 60) + Math.max(0, 4 - Math.abs(relative)) * 40)

/** Records each transition that starts on an inline slot, or the fade of the detail inside it. */
async function recordInlineTransitions(page: Page) {
  await page.addInitScript(() => {
    const runs: string[] = []
    Object.assign(window, { inlineTransitions: runs })
    document.addEventListener('transitionrun', event => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.matches('.moments-inline')) runs.push(`slot ${event.propertyName}`)
      else if (target?.matches('.moments-detail') && target.closest('.moments-inline') && event.propertyName === 'opacity') runs.push('detail opacity')
    }, true)
  })
  return () => page.evaluate(() => [...(window as unknown as { inlineTransitions: string[] }).inlineTransitions])
}

/** Every click the document sees, by whether it landed inside the open slot. */
async function recordClicks(page: Page) {
  await page.evaluate(() => {
    const clicks: string[] = []
    Object.assign(window, { seenClicks: clicks })
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null
      clicks.push(target?.closest('#moments-selected-detail') ? 'inside' : 'outside')
    }, true)
  })
  return () => page.evaluate(() => [...(window as unknown as { seenClicks: string[] }).seenClicks])
}

const THIRD_MOMENT = { login: 'forsen', streamId: 's3', offsetSeconds: 360, label: 'Laugh spike', minutesBefore: 6 }

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ status: 503, json: { error: 'unmocked_endpoint' } }))
  await page.route(/\/v1\/public\/discovery\/ranked\/availability(?:\?.*)?$/, route => route.fulfill({ status: 404, contentType: 'text/plain', body: '404 page not found\n' }))
  await page.route('**/v1/portal/analytics/streams/*', route => {
    const streamId = new URL(route.request().url()).pathname.split('/').pop()
    const channel = ({ s1: 'xqc', s3: 'forsen' } as Record<string, string>)[streamId ?? ''] ?? 'sodapoppin'
    return route.fulfill({ json: { channel, stream: { streamId }, availability: { vodState: 'unavailable' } } })
  })
})

test('a moment opens in line under its row, keeps the list in place, and closes on a click away', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { momentAts } = await installHubUxMock(page, { withComparisons: true, momentOffsets: [5400, 7200] })
  await installMinutes(page, { streamId: 's1', login: 'xqc', offsetSeconds: 5400, at: momentAts[0], chat: xqcChat })
  await page.goto('/analytics/moments')
  await expect(rows(page)).toHaveCount(2)
  const list = page.locator('.moments-result-list')
  const before = await list.boundingBox()
  const pageWidth = () => page.evaluate(() => document.documentElement.clientWidth)
  const pageWidthBefore = await pageWidth()
  const tabsTop = await page.getByRole('tablist', { name: 'Moment views' }).evaluate(element => element.getBoundingClientRect().top)
  const first = rows(page).first()
  const primary = first.locator('.moments-card-primary')
  await expect(primary).toHaveAttribute('aria-expanded', 'false')
  await primary.click()

  const open = detail(page)
  await expect(open).toBeVisible()
  // Directly under its row, inside the same full-width list.
  expect(await first.evaluate(row => row.nextElementSibling?.id)).toBe('moments-selected-detail')
  await expect(primary).toHaveAttribute('aria-expanded', 'true')
  await expect(primary).toHaveAttribute('aria-controls', 'moments-selected-detail')
  // Only the open row controls the slot; the closed row claims nothing.
  await expect(rows(page).nth(1).locator('.moments-card-primary')).not.toHaveAttribute('aria-controls')
  await expect(page.locator('[aria-controls="moments-selected-detail"]')).toHaveCount(1)
  // The list keeps its width once the slot has opened. The tall detail makes the page
  // scroll; where a scrollbar takes room (a headed run on Windows) the list may narrow
  // by that much, never more.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))))
  const narrowed = before!.width - (await list.boundingBox())!.width
  const scrollbar = pageWidthBefore - await pageWidth()
  expect(narrowed).toBeGreaterThan(-0.5)
  expect(narrowed).toBeLessThan(scrollbar + 0.5)
  expect(await page.getByRole('tablist', { name: 'Moment views' }).evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(tabsTop, 0)
  await expect(page.locator('.moments-toolbar')).toBeVisible()
  await expect(page.locator('.has-selection, .is-reviewing')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Back to results/ })).toHaveCount(0)
  // The row above already names it: no identity block, title or date line.
  await expect(open.locator('h2, .moments-identity')).toHaveCount(0)
  await expect(open.locator('.moments-detail-head')).toContainText('1 of 2 loaded moments')
  await expect(open.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  // Left: what happened, then how unusual, then the emote reactions. Right: replay and actions.
  const main = open.locator('.moments-detail-main')
  await expect(main.locator(':scope > section')).toHaveCount(2)
  await expect(main.locator('.moments-measurement figure.moment-evidence-bars')).toBeVisible()
  expect(await main.evaluate(column => [...column.children].map(child => child.className))).toEqual(['moments-measurement', 'moments-reactions'])
  await expect(open.locator('.moments-detail-side .moment-replay-pending')).toBeVisible()
  await expect(open.locator('.moments-detail-side .moments-primary-actions').getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  const columns = await open.locator('.moments-detail-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(2)
  await expect(open.getByRole('figure', { name: 'Chat per minute around this moment' })).toBeVisible()
  await page.waitForTimeout(900)
  await page.screenshot({ path: testInfo.outputPath('inline-open-1440.png') })
  await page.screenshot({ path: testInfo.outputPath('inline-open-1440-full.png'), fullPage: true })

  // The row's own links and Save do not toggle it.
  await first.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(open).toBeVisible()

  // A click in the page margin, beside the content, closes it. (Its history step back is
  // covered by 'a click away steps back in history…' below.)
  await expect(page).toHaveURL(/offset=5400/)
  await page.mouse.click(8, 600)
  await expect(open).toHaveCount(0)
  await expect(page).not.toHaveURL(/offset=/)
  await expect(primary).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.moments-card-primary[aria-controls]')).toHaveCount(0)
  await page.waitForTimeout(250)
  await page.screenshot({ path: testInfo.outputPath('inline-click-away-closed-1440.png') })

  // The page header and the filters count as away too; focus stays where the reader clicked.
  await primary.click()
  await expect(open).toBeVisible()
  await page.getByRole('heading', { name: 'Moments', level: 1 }).click()
  await expect(open).toHaveCount(0)
  await primary.click()
  await expect(open).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Find loaded moments' })
  await search.click()
  await expect(open).toHaveCount(0)
  await expect(search).toBeFocused()
  await search.fill('xqc')
  await expect(rows(page)).toHaveCount(1)

  // Clicking the open row again closes it.
  await search.fill('')
  await primary.click()
  await expect(open).toBeVisible()
  await first.locator('.moments-result-evidence').click()
  await expect(open).toHaveCount(0)
})

test('Esc closes the open moment and returns focus to its row', async ({ page }) => {
  await installHubUxMock(page, { withComparisons: true })
  await page.goto('/analytics/moments')
  const first = rows(page).first()
  await first.locator('.moments-result-evidence').click()
  await expect(detail(page)).toBeVisible()
  await detail(page).getByRole('button', { name: 'Recheck source', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(detail(page)).toHaveCount(0)
  await expect(first.locator('.moments-card-primary')).toBeFocused()
  await expect(page).not.toHaveURL(/offset=/)
  // The Close button does the same.
  await first.locator('.moments-card-primary').press('Enter')
  await expect(detail(page)).toBeVisible()
  await detail(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(detail(page)).toHaveCount(0)
  await expect(first.locator('.moments-card-primary')).toBeFocused()
})

test('a press that starts inside the open moment and ends outside it is not a click away', async ({ page }) => {
  await installHubUxMock(page, { withComparisons: true })
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  await expect(detail(page)).toBeVisible()
  const clicks = await recordClicks(page)
  // Pressed on Close (a control, so nothing is selected) and released in the page margin.
  const close = (await detail(page).getByRole('button', { name: 'Close', exact: true }).boundingBox())!
  await page.mouse.move(close.x + close.width / 2, close.y + close.height / 2)
  await page.mouse.down()
  await page.mouse.move(6, 700, { steps: 4 })
  await page.mouse.up()
  // The browser sent the click to an ancestor outside the slot, with no text selected:
  // only where the press started tells it apart from a click away.
  expect(await clicks()).toEqual(['outside'])
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
  await page.waitForTimeout(300)
  await expect(detail(page)).toBeVisible()
  await expect(page).toHaveURL(/login=xqc&stream=s1&offset=120/)
})

test('selecting text outside the open moment is not a click away', async ({ page }) => {
  await installHubUxMock(page, { withComparisons: true })
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  await expect(detail(page)).toBeVisible()
  const clicks = await recordClicks(page)
  // A drag across the page heading to copy it: it starts and ends outside the slot.
  const heading = page.getByRole('heading', { name: 'Moments', level: 1 })
  const box = (await heading.boundingBox())!
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  expect(await clicks()).toEqual(['outside'])
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('Moments')
  await page.waitForTimeout(300)
  await expect(detail(page)).toBeVisible()
  await expect(page).toHaveURL(/login=xqc&stream=s1&offset=120/)
})

test('a row pressed while a close is stepping back opens once the step back lands', async ({ page }) => {
  await installHubUxMock(page, { withComparisons: true })
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  await expect(detail(page)).toBeVisible()
  await expect(page).toHaveURL(/login=xqc&stream=s1&offset=120/)
  // Esc steps history back, which lands a task later; the next row is pressed before it does.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.querySelectorAll<HTMLElement>('.moments-result .moments-card-primary')[1]!.click()
  })
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=240/)
  await expect.poll(() => rows(page).nth(1).evaluate(row => row.nextElementSibling?.id)).toBe('moments-selected-detail')
  await expect(detail(page)).toHaveCount(1)
  await page.waitForTimeout(1200)
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=240/)
  // It was pushed over the list: Back returns to the list, not past it.
  await page.goBack()
  await expect(page).toHaveURL(/\/analytics\/moments$/)
  await expect(detail(page)).toHaveCount(0)
})

test('a click away steps back in history, and browser Back from the next moment returns focus to its row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page, { withComparisons: true })
  // An entry before the list, so a Back past the list shows where it lands.
  await page.goto('/analytics/moments?view=saved')
  await page.getByRole('tab', { name: 'Latest' }).click()
  await expect(page).toHaveURL(/\/analytics\/moments\?view=recent$/)
  await expect(rows(page)).toHaveCount(2)
  const second = rows(page).nth(1).locator('.moments-card-primary')
  await rows(page).first().locator('.moments-card-primary').click()
  await expect(detail(page)).toBeVisible()
  await expect(page).toHaveURL(/login=xqc&stream=s1&offset=120/)
  // The page margin beside the content.
  await page.mouse.click(8, 600)
  await expect(detail(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/analytics\/moments\?view=recent$/)
  // The next moment closes by browser Back while focus is inside its detail.
  await second.click()
  await expect(detail(page)).toBeVisible()
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=240/)
  await detail(page).getByRole('button', { name: 'Close', exact: true }).focus()
  await page.goBack()
  await expect(page).toHaveURL(/\/analytics\/moments\?view=recent$/)
  await expect(detail(page)).toHaveCount(0)
  await expect(second).toBeFocused()
  // The click away stepped back instead of replacing the first moment's entry with a copy
  // of the list, so the entry behind the list is the one the reader came from.
  await page.goBack()
  await expect(page).toHaveURL(/\/analytics\/moments\?view=saved$/)
  await expect(detail(page)).toHaveCount(0)
})

test('opening another row closes the first and keeps the clicked row in place', async ({ page }) => {
  // Short enough that the second row sits below the fold under the open detail.
  await page.setViewportSize({ width: 1440, height: 600 })
  await installHubUxMock(page, { withComparisons: true })
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  await expect(detail(page)).toBeVisible()
  await page.waitForTimeout(400)
  const second = rows(page).nth(1)
  await second.scrollIntoViewIfNeeded()
  const evidence = (await second.locator('.moments-result-evidence').boundingBox())!
  const topBefore = (await second.boundingBox())!.y
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await page.mouse.click(evidence.x + evidence.width / 2, evidence.y + evidence.height / 2)
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=240/)
  await page.waitForTimeout(700)
  // The first detail collapsed above the clicked row; the page scrolled to hold it still.
  expect(Math.abs((await second.boundingBox())!.y - topBefore)).toBeLessThan(3)
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(scrollBefore)
  await expect(page.locator('.moments-inline')).toHaveCount(1)
  expect(await second.evaluate(row => row.nextElementSibling?.id)).toBe('moments-selected-detail')
  await expect(rows(page).first().locator('.moments-card-primary')).toHaveAttribute('aria-expanded', 'false')
})

test('Previous and Next move the detail in line and keep its top on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installHubUxMock(page, { withComparisons: true })
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  await page.waitForTimeout(400)
  const slot = page.locator('#moments-selected-detail')
  const top = (await slot.boundingBox())!.y
  await detail(page).getByRole('button', { name: 'Next moment', exact: true }).click()
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=240/)
  await expect(detail(page).locator('.moments-detail-head')).toContainText('2 of 2 loaded moments')
  await expect.poll(() => rows(page).nth(1).evaluate(row => row.nextElementSibling?.id)).toBe('moments-selected-detail')
  expect(Math.abs((await slot.boundingBox())!.y - top)).toBeLessThan(2)
  // At the end of the list focus stays on the control that still moves.
  await expect(detail(page).getByRole('button', { name: 'Previous moment', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/login=xqc&stream=s1&offset=120/)
  await expect.poll(() => rows(page).first().evaluate(row => row.nextElementSibling?.id)).toBe('moments-selected-detail')
  expect(Math.abs((await slot.boundingBox())!.y - top)).toBeLessThan(2)
})

test('Previous and Next keep focus on the control just used while both still move', async ({ page }) => {
  await installHubUxMock(page, { withComparisons: true, extraPulseMoments: [THIRD_MOMENT] })
  await page.goto('/analytics/moments')
  await expect(rows(page)).toHaveCount(3)
  await rows(page).first().locator('.moments-card-primary').click()
  const head = detail(page).locator('.moments-detail-head')
  await expect(head).toContainText('1 of 3 loaded moments')
  const next = detail(page).getByRole('button', { name: 'Next moment', exact: true })
  const previous = detail(page).getByRole('button', { name: 'Previous moment', exact: true })
  // Focus stays on the control, so the moment it opens is announced from a live region
  // outside the swapped slot, and the detail itself is named for that moment.
  const announcement = page.locator('[data-review-announcement]')
  await expect(announcement).toHaveAttribute('aria-live', 'polite')
  await expect(announcement).toHaveText('')
  await expect(page.getByRole('region', { name: 'Selected moment: Twitch emote spike, xQc, 2:00 into broadcast', exact: true })).toBeVisible()
  await next.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=240/)
  await expect(head).toContainText('2 of 3 loaded moments')
  await expect(next).toBeFocused()
  await expect(announcement).toHaveText('Moment 2 of 3: Chat spike, sodapoppin, 4:00 into broadcast')
  await expect(page.getByRole('region', { name: 'Selected moment: Chat spike, sodapoppin, 4:00 into broadcast', exact: true })).toBeVisible()
  expect(await announcement.evaluate(region => region.closest('#moments-selected-detail, [aria-busy="true"]'))).toBeNull()
  // A second Enter keeps going the same way.
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/login=forsen&stream=s3&offset=360/)
  await expect(head).toContainText('3 of 3 loaded moments')
  await expect(previous).toBeFocused()
  await expect(announcement).toHaveText('Moment 3 of 3: Laugh spike, forsen, 6:00 into broadcast')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=240/)
  await expect(head).toContainText('2 of 3 loaded moments')
  await expect(previous).toBeFocused()
  await expect.poll(() => rows(page).nth(1).evaluate(row => row.nextElementSibling?.id)).toBe('moments-selected-detail')
})

test('a deep link opens in line under its row and scrolls it into view', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 640 })
  const { momentAts } = await installHubUxMock(page, { withComparisons: true, momentOffsets: [5400, 7200] })
  await installMinutes(page, { streamId: 's2', login: 'sodapoppin', offsetSeconds: 7200, at: momentAts[1], chat: relative => relative === 0 ? 280 : 120 + ((relative * 23 + 90) % 45) })
  await page.goto('/analytics/moments?view=recent&login=sodapoppin&stream=s2&offset=7200')
  const second = rows(page).nth(1)
  await expect(detail(page)).toBeVisible()
  expect(await second.evaluate(row => row.nextElementSibling?.id)).toBe('moments-selected-detail')
  await expect(second.locator('.moments-card-primary')).toHaveAttribute('aria-expanded', 'true')
  await expect(second.locator('.moments-card-primary')).toBeFocused()
  await expect(second).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await expect(detail(page).getByRole('figure', { name: 'Chat per minute around this moment' })).toHaveAttribute('data-state', 'ready')
  // One column on a phone; the filters stay reachable.
  expect(await detail(page).locator('.moments-detail-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(1)
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.waitForTimeout(900)
  await page.screenshot({ path: testInfo.outputPath('inline-open-390.png') })
  await detail(page).getByRole('figure', { name: 'Chat per minute around this moment' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('inline-open-390-chart.png') })
  await page.screenshot({ path: testInfo.outputPath('inline-open-390-full.png'), fullPage: true })
})

test('a deep link keeps its selection through a click or Esc while its feed is still loading', async ({ page }) => {
  let release!: () => void
  const recentHubGate = new Promise<void>(resolve => { release = resolve })
  await installHubUxMock(page, { withComparisons: true, recentHubGate })
  await page.goto('/analytics/moments?login=sodapoppin&stream=s2&offset=240')
  await expect(page.locator('.moments-loading')).toBeVisible()
  await expect(detail(page)).toHaveCount(0)
  // Nothing is on screen to click away from yet.
  await page.getByRole('heading', { level: 1 }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await expect(page).toHaveURL(/\?login=sodapoppin&stream=s2&offset=240$/)
  release()
  await expect(detail(page)).toBeVisible()
  expect(await rows(page).nth(1).evaluate(row => row.nextElementSibling?.id)).toBe('moments-selected-detail')
  // Shown, it closes as usual.
  await page.keyboard.press('Escape')
  await expect(detail(page)).toHaveCount(0)
})

test('a deep link outside the loaded list stands alone at the top of the list', async ({ page }) => {
  await installHubUxMock(page, { withComparisons: true })
  await page.route('**/v1/portal/analytics/streams/s9/recap', route => route.fulfill({ json: {
    login: 'xqc', streamId: 's9', topMoments: [{ offsetSeconds: 600, reasons: ['chat_spike'], topEmotes: [{ code: 'KEKW', count: 5, provider: 'seventv' }] }],
  } }))
  await page.goto('/analytics/moments?login=xqc&stream=s9&offset=600')
  const open = detail(page)
  await expect(open.getByRole('heading', { name: 'Chat spike', exact: true })).toBeVisible()
  await expect(open.getByText('Selection outside loaded matches', { exact: true })).toBeVisible()
  await expect(open.locator('.moments-identity')).toBeVisible()
  // It leads the results: directly under their heading, ahead of the list.
  expect(await page.locator('#moments-selected-detail').evaluate(card => card.parentElement?.className)).toBe('moments-results')
  expect(await page.locator('#moments-selected-detail').evaluate(card => Boolean(card.compareDocumentPosition(document.querySelector('.moments-result-list')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
  await expect(rows(page)).toHaveCount(2)
  await expect(open.getByRole('heading', { name: 'Chat spike' })).toBeFocused()
  // The minutes read failed (unmocked 503): it says so, offers a retry, and never invents bars
  // or claims this part of the broadcast has no data.
  await expect(open.getByText(/Chat per minute couldn’t be loaded\./)).toBeVisible()
  await expect(open.getByRole('button', { name: 'Retry chat per minute', exact: true })).toBeVisible()
  await expect(open.getByText('Chat per minute isn’t available for this part of the broadcast.')).toHaveCount(0)
  await expect(open.locator('.moment-minutes__bar')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(open).toHaveCount(0)
  await expect(page).toHaveURL(/\/analytics\/moments$/)
})

test('the minute chart draws measured minutes against the earlier average', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const { momentAts } = await installHubUxMock(page, { withComparisons: true, momentOffsets: [5400, 7200] })
  const reads = await installMinutes(page, { streamId: 's1', login: 'xqc', offsetSeconds: 5400, at: momentAts[0], chat: xqcChat })
  await page.goto('/analytics/moments')
  await expect(rows(page)).toHaveCount(2)
  // Lazy: nothing is read until a moment opens.
  expect(reads).toHaveLength(0)
  await rows(page).first().locator('.moments-card-primary').click()
  const chart = detail(page).getByRole('figure', { name: 'Chat per minute around this moment' })
  await expect(chart).toHaveAttribute('data-state', 'ready')
  expect(reads).toHaveLength(1)
  // The bounded tail read the stream timeline uses, starting just before the window.
  expect(Number(reads[0].searchParams.get('afterOffset'))).toBe(5400 - 31 * 60)
  // 41 minutes, one flagged missing: 40 bars, and the moment's own minute lit.
  await expect(chart.locator('.moment-minutes__bar')).toHaveCount(40)
  await expect(chart.locator('.moment-minutes__bar[data-relative="-12"]')).toHaveCount(0)
  await expect(chart.locator('.moment-minutes__bar[data-moment="true"]')).toHaveAttribute('data-relative', '0')
  await expect(chart.locator('.moment-minutes__baseline')).toHaveCount(1)
  const caption = chart.locator('figcaption > span')
  await expect(caption).toHaveText('2.5× the earlier average')
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /This minute: 393 chat per minute\. Earlier average: 160 per minute\..*40 of 41 minutes measured\./)
  await expect(chart.locator('.moment-minutes__axis')).toContainText('30 min before')
  await expect(chart.locator('.moment-minutes__axis em')).toHaveText('this moment')
  await expect(chart.locator('.moment-minutes__legend')).toContainText('Earlier average 160/min')
  // Measure bars only once the slot, fade and bar growth have finished moving them.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))))
  const bar = await chart.locator('.moment-minutes__bar[data-moment="true"]').boundingBox()
  await page.mouse.move(bar!.x + bar!.width / 2, bar!.y + bar!.height - 4)
  await expect(caption).toHaveText('This minute · 393 chat / min')
  const earlier = await chart.locator('.moment-minutes__bar[data-relative="-5"]').boundingBox()
  await page.mouse.move(earlier!.x + earlier!.width / 2, earlier!.y + earlier!.height - 2)
  await expect(caption).toHaveText(`5 min before · ${xqcChat(-5)} chat / min`)
  await page.waitForTimeout(900)
  await page.screenshot({ path: testInfo.outputPath('chart-hover-1440.png') })
  await page.mouse.move(4, 4)
  await expect(caption).toHaveText('2.5× the earlier average')
  // Reopening within the minute reuses the read.
  await page.keyboard.press('Escape')
  await rows(page).first().locator('.moments-card-primary').click()
  await expect(chart).toHaveAttribute('data-state', 'ready')
  expect(reads).toHaveLength(1)
})

test('the minute chart draws nothing before the broadcast started or past the latest minute returned', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Four minutes into a live broadcast whose rollups have reached three minutes after the moment.
  const { momentAts } = await installHubUxMock(page, { withComparisons: true, momentOffsets: [240, 7200] })
  const reads = await installMinutes(page, { streamId: 's1', login: 'xqc', offsetSeconds: 240, at: momentAts[0], chat: xqcChat, through: 3 })
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  const chart = detail(page).getByRole('figure', { name: 'Chat per minute around this moment' })
  await expect(chart).toHaveAttribute('data-state', 'ready')
  expect(Number(reads[0].searchParams.get('afterOffset'))).toBe(0)
  await expect(chart.locator('.moment-minutes__bar')).toHaveCount(8)
  expect(await chart.locator('svg [data-relative]').evaluateAll(marks => marks.map(mark => Number(mark.getAttribute('data-relative')))))
    .toEqual([-4, -3, -2, -1, 0, 1, 2, 3])
  // Only the minutes inside the broadcast so far are counted; the rest are named.
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /This minute: 393 chat per minute\..* 8 of 8 minutes measured\. The first 26 minutes came before the broadcast started\. The last 7 minutes aren’t available yet\.$/)
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))))
  const plot = (await chart.locator('svg').boundingBox())!
  const caption = chart.locator('figcaption > span')
  const pointAt = (index: number) => page.mouse.move(plot.x + plot.width * ((index + 0.5) / 41), plot.y + plot.height - 4)
  await pointAt(10)
  await expect(caption).toHaveText('20 min before · no data')
  await pointAt(37)
  await expect(caption).toHaveText('7 min after · no data')
  await pointAt(30)
  await expect(caption).toHaveText('This minute · 393 chat / min')
})

test('at phone width a minute readout never moves the plot under the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  // The second moment has no comparison, so its caption carries no line of its own until a press.
  const { momentAts } = await installHubUxMock(page, { withComparisons: true, momentOffsets: [5400, 7200] })
  await installMinutes(page, { streamId: 's2', login: 'sodapoppin', offsetSeconds: 7200, at: momentAts[1], chat: relative => relative === 0 ? 1280 : 1100 + ((relative * 23 + 90) % 45) })
  await page.goto('/analytics/moments')
  await rows(page).nth(1).locator('.moments-card-primary').click()
  const chart = detail(page).getByRole('figure', { name: 'Chat per minute around this moment' })
  await expect(chart).toHaveAttribute('data-state', 'ready')
  const caption = chart.locator('figcaption > span')
  await expect(caption).toHaveText('')
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))))
  const plot = chart.locator('.moment-minutes__plot')
  await plot.scrollIntoViewIfNeeded()
  const top = (await plot.boundingBox())!.y
  const bar = (await chart.locator('.moment-minutes__bar[data-relative="-10"]').boundingBox())!
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height - 2)
  await expect(caption).toHaveText(/^10 min before · [\d,.]+ chat \/ min$/)
  expect(Math.abs((await plot.boundingBox())!.y - top)).toBeLessThan(0.5)
  await page.mouse.move(4, 4)
  await expect(caption).toHaveText('')
  expect(Math.abs((await plot.boundingBox())!.y - top)).toBeLessThan(0.5)
})

test('the chart omits the average line without a baseline, and a failed read can be retried in place', async ({ page }) => {
  const { momentAts } = await installHubUxMock(page, { momentOffsets: [5400, 7200] })
  await installMinutes(page, { streamId: 's1', login: 'xqc', offsetSeconds: 5400, at: momentAts[0], chat: xqcChat })
  const failed = await installMinutes(page, { streamId: 's2', login: 'sodapoppin', offsetSeconds: 7200, at: momentAts[1], chat: () => 10, status: 503 })
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  const chart = detail(page).getByRole('figure', { name: 'Chat per minute around this moment' })
  await expect(chart).toHaveAttribute('data-state', 'ready')
  await expect(chart.locator('.moment-minutes__bar')).toHaveCount(40)
  await expect(chart.locator('.moment-minutes__baseline')).toHaveCount(0)
  await expect(chart.locator('figcaption > span')).toHaveText('')
  await expect(chart.locator('.moment-minutes__legend')).not.toContainText('Earlier average')
  await detail(page).getByRole('button', { name: 'Next moment', exact: true }).click()
  // A 503 is a failed read, not a fact about the broadcast.
  await expect(detail(page).getByText(/Chat per minute couldn’t be loaded\./)).toBeVisible()
  await expect(detail(page).getByText('Chat per minute isn’t available for this part of the broadcast.')).toHaveCount(0)
  await expect(detail(page).locator('.moment-minutes__bar')).toHaveCount(0)
  // The API client retries a 5xx once by itself before the chart says the read failed.
  const failedReads = failed.length
  expect(failedReads).toBeGreaterThan(0)
  // The backend recovers; Retry reads again without closing or reopening the moment.
  const recovered = await installMinutes(page, { streamId: 's2', login: 'sodapoppin', offsetSeconds: 7200, at: momentAts[1], chat: relative => relative === 0 ? 280 : 120 })
  await detail(page).getByRole('button', { name: 'Retry chat per minute', exact: true }).click()
  await expect(chart).toHaveAttribute('data-state', 'ready')
  await expect(chart.locator('.moment-minutes__bar')).toHaveCount(41)
  expect(recovered).toHaveLength(1)
  expect(failed).toHaveLength(failedReads)
  await expect(page).toHaveURL(/login=sodapoppin&stream=s2&offset=7200/)
})

test('a click away while scrolled past the open moment keeps the rows on screen still', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  const now = Date.now()
  // Enough saved moments to scroll an open detail wholly off the top of the screen.
  const items = Array.from({ length: 16 }, (_, index) => ({
    key: JSON.stringify(['xqc', `s${index + 1}`, 600]), login: 'xqc', streamId: `s${index + 1}`, offsetSeconds: 600, label: `Saved spike ${index + 1}`,
    provenance: 'saved', savedAt: now - index, at: now - (index + 1) * 60_000, displayName: 'xqc', category: 'Just Chatting', chatPerMin: 200 + index, emotesPerMin: 40,
  }))
  await page.addInitScript(value => localStorage.setItem('streampulse.saved-moments.v2', JSON.stringify({ version: 2, legacyMerged: true, items: value })), items)
  await page.goto('/analytics/moments?view=saved')
  await expect(rows(page)).toHaveCount(16)
  await rows(page).first().locator('.moments-card-primary').click()
  await expect(detail(page)).toBeVisible()
  await expect(detail(page).locator('.moment-minutes-note, .moment-minutes[data-state="ready"]')).toBeVisible()
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))))
  await page.waitForTimeout(700)
  // Scroll the open detail wholly above the screen, with later rows in view.
  const slotBottom = await page.locator('#moments-selected-detail').evaluate(slot => slot.getBoundingClientRect().bottom + window.scrollY)
  await page.evaluate(y => window.scrollTo(0, y + 60), slotBottom)
  await expect.poll(() => page.locator('#moments-selected-detail').evaluate(slot => slot.getBoundingClientRect().bottom)).toBeLessThan(0)
  const watched = await rows(page).evaluateAll(list => list.findIndex(row => row.getBoundingClientRect().top >= 0))
  expect(watched).toBeGreaterThan(0)
  const row = rows(page).nth(watched)
  const before = (await row.boundingBox())!.y
  const scrollBefore = await page.evaluate(() => window.scrollY)
  // The page margin beside the list.
  await page.mouse.click(8, 600)
  await expect(detail(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/analytics\/moments\?view=saved$/)
  await page.waitForTimeout(700)
  // The rows the reader was looking at stay put; the page scrolled up by the closed height.
  expect(Math.abs((await row.boundingBox())!.y - before)).toBeLessThan(3)
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(scrollBefore)
  expect(await page.evaluate(() => document.documentElement.style.overflowAnchor)).toBe('')
})

test('reduced motion opens, closes and draws the chart without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { momentAts } = await installHubUxMock(page, { withComparisons: true, momentOffsets: [5400, 7200] })
  await installMinutes(page, { streamId: 's1', login: 'xqc', offsetSeconds: 5400, at: momentAts[0], chat: xqcChat })
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  const slot = page.locator('.moments-inline')
  await expect(slot).toHaveClass(/is-open/)
  expect(await slot.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
  expect(await slot.locator('.moments-detail').evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  const bar = detail(page).locator('.moment-minutes__bar').first()
  await expect(bar).toBeVisible()
  expect(await bar.evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  expect(await bar.getAttribute('style')).toBeNull()
  // Instant: the slot leaves without ever entering its collapsing state.
  await page.evaluate(() => {
    const seen = { closing: false }
    ;(window as unknown as { inlineSeen: typeof seen }).inlineSeen = seen
    new MutationObserver(() => { if (document.querySelector('.moments-inline.is-closing')) seen.closing = true })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  })
  await page.keyboard.press('Escape')
  await expect(page.locator('.moments-inline')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { inlineSeen: { closing: boolean } }).inlineSeen.closing)).toBe(false)
})

test('motion: the slot grows from 0fr and the detail fades in', async ({ page }) => {
  await installHubUxMock(page, { withComparisons: true })
  const transitions = await recordInlineTransitions(page)
  await page.goto('/analytics/moments')
  await rows(page).first().locator('.moments-card-primary').click()
  const slot = page.locator('.moments-inline')
  await expect(slot).toHaveClass(/is-open/)
  const transition = await slot.evaluate(element => ({ property: getComputedStyle(element).transitionProperty, duration: getComputedStyle(element).transitionDuration, easing: getComputedStyle(element).transitionTimingFunction }))
  expect(transition).toEqual({ property: 'grid-template-rows', duration: '0.28s', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
  // The opening really animated: the slot was drawn collapsed before it grew.
  await expect.poll(async () => (await transitions()).sort()).toEqual(['detail opacity', 'slot grid-template-rows'])
  await expect.poll(() => slot.evaluate(element => getComputedStyle(element).gridTemplateRows)).not.toBe('0px')
  await expect.poll(() => slot.locator('.moments-detail').evaluate(element => getComputedStyle(element).opacity)).toBe('1')
})

test('motion: a deep link shows the open moment without replaying the opening', async ({ page }) => {
  await installHubUxMock(page, { withComparisons: true })
  const transitions = await recordInlineTransitions(page)
  await page.goto('/analytics/moments?view=recent&login=sodapoppin&stream=s2&offset=240')
  await expect(detail(page)).toBeVisible()
  await expect(page.locator('.moments-inline')).toHaveClass(/is-open/)
  await page.waitForTimeout(600)
  expect(await transitions()).toEqual([])
  expect(await page.locator('.moments-inline .moments-detail').evaluate(element => getComputedStyle(element).opacity)).toBe('1')
})
