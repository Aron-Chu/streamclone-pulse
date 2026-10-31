import { expect, test, type Page } from './helpers/portalMockedTest'
import {
  assertNoUnexpected,
  buildDetail,
  buildMinutes,
  buildRecap,
  buildStatus,
  buildStreamRecord,
  installPortalAcceptanceHarness,
  openAnalyticsSession,
  PORTAL_STARTED_AT,
  PORTAL_STREAM_ID,
  PORTAL_VOD_ID,
  type PortalHarness,
} from './helpers/portalAcceptanceHarness'

// d3-v2 session-original page shell (U15, 2026-10-15): what the mockup
// renders by default. Header without badges, one meta line, plain stat
// labels, a sticky stream list from 1280 px, the Moments (i) beside the tabs,
// and the centre column ending level with the right one.

const ENDED_AT = '2026-07-26T00:00:00.000Z'
const MOMENTS = 12
const STREAMS = 40
const MOMENTS_TIP = 'Ranked by how strongly chat reacted, not by clip quality.'

function olderStreams(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const started = Date.parse(PORTAL_STARTED_AT) - (i + 1) * 86_400_000
    return buildStreamRecord({
      streamId: String(320_567_744_900 - i),
      title: `Older broadcast ${i + 1}`,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(started + 3 * 3_600_000).toISOString(),
      lifecycleState: 'confirmed_ended',
      currentViewers: 0,
      vodId: '',
    })
  })
}

async function installSessionPage(page: Page): Promise<PortalHarness> {
  const harness = await installPortalAcceptanceHarness(page)
  harness.setMinutesPayload({ ...buildMinutes({ count: 150, withEmotes: true }), coverageStartOffsetSeconds: 54 })
  const stream = buildStreamRecord({ endedAt: ENDED_AT, vodId: PORTAL_VOD_ID, currentViewers: 0 })
  const vodFacts = {
    vodId: PORTAL_VOD_ID,
    vodAlignSeconds: 0,
    vodDurationSeconds: 150 * 60,
    vodTiming: { state: 'verified' },
  }
  const availability = {
    liveDvrState: 'ended',
    vodState: 'linked',
    vodId: PORTAL_VOD_ID,
    chartState: 'usable',
    chartUsable: true,
    coveragePct: 99.5,
  }
  harness.detail.setFallback({
    kind: 'json',
    body: buildDetail({ state: 'ended', ...vodFacts, coverageStartOffsetSeconds: 54, availability, stream }),
  })
  harness.status.setFallback({ kind: 'json', body: buildStatus({ state: 'ended', ...vodFacts, availability, stream }) })
  // The harness resets its streams fallback on every request, so this list
  // gets its own route (registered later, so it wins).
  const streamList = { channel: 'xqc', items: [stream, ...olderStreams(STREAMS - 1)], updatedAt: Date.parse(ENDED_AT) }
  await page.route(/\/channels\/xqc\/streams(?:\?|$)/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(streamList),
  }))
  harness.setRecapPayload(buildRecap({
    streamId: PORTAL_STREAM_ID,
    vodId: PORTAL_VOD_ID,
    durationSeconds: 150 * 60,
    topMoments: Array.from({ length: MOMENTS }, (_, i) => ({
      offsetSeconds: 300 + i * 600,
      score: 95 - i * 4,
      chatCount: 400 - i * 20,
      emoteCount: 200 - i * 10,
      viewerCount: 11_000,
    })),
  }))
  // No live session is confirmed for this ended fixture.
  await page.route(/\/channels\/xqc\/live(?:\?|$)/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ channel: 'xqc', state: 'offline', stream: null, rollups: [], updatedAt: Date.parse(ENDED_AT) }),
  }))
  return harness
}

async function openSessionPage(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height })
  const harness = await installSessionPage(page)
  await openAnalyticsSession(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Deterministic portal acceptance fixture' })).toBeVisible()
  await expect(page.locator('[data-session-meta] [data-session-watch-vod]')).toBeVisible()
  return harness
}

test.describe('analytics session page shell, d3-v2 session-original (mocked)', () => {
  test('header: no badges, one meta line, the two actions at the top right, plain stat labels', async ({ page }) => {
    const harness = await openSessionPage(page, 1440)
    const header = page.locator('[data-session-header]')
    await expect(header.locator('[data-session-header-badges]')).toHaveCount(0)
    await expect(header.getByText('xqc · Stream timeline & moments')).toHaveCount(0)

    const items = page.locator('[data-session-meta] .ssp-meta > .mi')
    await expect(items).toHaveCount(7)
    const texts = (await items.allTextContents()).map(text => text.trim())
    expect(texts[0]).toBe('xQc')
    expect(texts[1]).toBe('Just Chatting')
    expect(texts[2]).toMatch(/^Started /)
    // An ended stream names its end ("Ended 12h ago"); the read time is for live and unknown sessions.
    expect(texts[3]).toMatch(/^(Ended|Updated|Refreshed) /)
    expect(texts[4]).toBe('First 54s not tracked')
    expect(texts[5]).toBe('Watch VOD')
    expect(texts[6]).toMatch(/^Data: (Good|Limited|Partial|No data)$/)
    await expect(items.nth(4)).toHaveAttribute('data-coverage-start')
    // One line at 1440 px.
    const tops = await items.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)))
    expect(Math.max(...tops) - Math.min(...tops), `meta item tops ${tops.join(',')}`).toBeLessThanOrEqual(2)

    const vod = page.locator('[data-session-meta] [data-session-watch-vod]')
    await expect(vod).toHaveAttribute('href', `https://www.twitch.tv/videos/${PORTAL_VOD_ID}`)
    await expect(vod).toHaveAttribute('target', '_blank')

    // "Refresh data" is the icon beside "Ended" / "Updated", not a text button.
    const refresh = page.getByRole('button', { name: 'Refresh data' })
    await expect(refresh).toHaveCount(1)
    await expect(refresh).toHaveText('')
    await expect(items.nth(3).getByRole('button', { name: 'Refresh data' })).toHaveCount(1)

    const actions = page.locator('[data-session-header-actions]')
    await expect(actions.getByRole('button')).toHaveText(['Hide streams', 'Focus chart'])
    const [headerBox, actionsBox, titleBox] = await Promise.all([
      header.boundingBox(), actions.boundingBox(), page.getByRole('heading', { level: 1 }).boundingBox(),
    ])
    expect(Math.abs(headerBox!.x + headerBox!.width - (actionsBox!.x + actionsBox!.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(actionsBox!.y - titleBox!.y)).toBeLessThanOrEqual(12)

    const labels = await page.locator('[data-session-stat-row] .sc-stat-card__label').allTextContents()
    // This fixture is an ended stream, so its first figure is the viewers at the end.
    expect(labels).toEqual(['Viewers at end', 'Average viewers', 'Peak viewers', 'Chat messages', 'Emote uses', 'Time tracked'])

    await expect(page.getByText('Up to 100 recent stored streams')).toHaveCount(0)
    await expect(page.getByText(/Synced only/)).toHaveCount(0)
    await expect(page.locator('[data-live-current-row]')).toHaveCount(0)
    await expect(page.getByText(/open the full VOD/i)).toHaveCount(0)
    await expect(page.locator('[data-session-status-row]')).toHaveCount(0)
    await assertNoUnexpected(harness)
  })

  test('"Data" opens the Status tab; the Moments (i) sits beside the tabs and works from the keyboard', async ({ page }) => {
    await openSessionPage(page, 1440)
    const info = page.getByRole('button', { name: 'About Pulse Moments' })
    await expect(info).toBeVisible()
    expect(await info.evaluate(node => node.closest('[role="tablist"]') === null)).toBe(true)

    await info.click()
    const pop = page.locator('[data-session-info-pop]')
    await expect(pop).toHaveText(MOMENTS_TIP)
    await expect(info).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(info).toBeFocused()

    await page.locator('[data-session-meta] button[data-data-quality]').click()
    await expect(page.getByRole('tab', { name: 'Status' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Status' })).toBeFocused()
    await expect(page.locator('#session-panel-status')).toBeVisible()
    await expect(page.locator('#session-panel-status [data-data-quality-facts]')).toBeVisible()
    // The (i) belongs to Moments: it keeps its place but hides on the other tabs.
    await expect(info).toBeHidden()
    await page.getByRole('tab', { name: 'Moments' }).click()
    await expect(info).toBeVisible()
  })

  test('from 1280 px the stream list is sticky, its scrollbar hidden behind edge fades, the current row in view', async ({ page }) => {
    // A short window, so the stream column (as tall as the grid row) has room
    // to travel past the list.
    await openSessionPage(page, 1440, 640)
    const box = page.locator('[data-stream-list]')
    const scroller = box.locator('.ssp-sl-sc')
    await expect(box.locator('a[aria-current="page"]')).toBeVisible()
    const style = await scroller.evaluate(node => {
      const cs = getComputedStyle(node)
      return {
        scrollbarWidth: cs.scrollbarWidth,
        mask: cs.maskImage || cs.webkitMaskImage,
        overflows: node.scrollHeight > node.clientHeight + 1,
      }
    })
    expect(style.overflows, 'forty streams overflow the list').toBe(true)
    expect(style.scrollbarWidth).toBe('none')
    expect(style.mask).toContain('linear-gradient')
    expect(await box.evaluate(node => getComputedStyle(node).position)).toBe('sticky')

    // Scroll the page: the list stays 16 px below the portal's sticky 56 px top bar (the mockup has
    // no sticky bar and uses 16 px from the window top) while its column is in view.
    const room = await page.evaluate(() => {
      const aside = document.querySelector('aside[data-analytics-stream-column]')!.getBoundingClientRect()
      const list = document.querySelector('[data-stream-list]')!.getBoundingClientRect()
      return Math.floor(aside.bottom - list.bottom)
    })
    expect(room, 'the stream column runs past the list').toBeGreaterThan(40)
    const listTop = await box.evaluate(node => node.getBoundingClientRect().top + window.scrollY)
    const barBottom = await page.locator('.analytics-topnav').evaluate(node => Math.round(node.getBoundingClientRect().bottom))
    expect(barBottom).toBe(56)
    await page.evaluate(y => window.scrollTo(0, y), listTop - 72 + Math.min(room, 240))
    await expect.poll(() => box.evaluate(node => Math.round(node.getBoundingClientRect().top))).toBe(72)
    expect(await box.evaluate(node => Math.round(node.getBoundingClientRect().bottom))).toBeLessThanOrEqual(640 - 16)

    // Below 1280 the actions go and the list is no longer sticky.
    await page.setViewportSize({ width: 1279, height: 900 })
    await expect(page.locator('[data-session-header-actions]')).toBeHidden()
    expect(await box.evaluate(node => getComputedStyle(node).position)).not.toBe('sticky')
  })

  test('the centre column ends level with the right one on the Moments tab', async ({ page }) => {
    await openSessionPage(page, 1440)
    const rows = page.locator('#session-panel-moments [data-moment-row]')
    await expect(rows.first()).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect.poll(async () => page.evaluate(() => {
      const centre = document.querySelector('[data-analytics-center-column]')!.getBoundingClientRect()
      const right = document.querySelector('[data-analytics-right-column]')!.getBoundingClientRect()
      return Math.round(Math.abs(centre.bottom - right.bottom))
    }), { message: 'centre and right column bottoms differ' }).toBeLessThanOrEqual(2)
    // The top 3 rows, never more (Aron 2026-10-15), whatever room the column has.
    expect(await rows.count()).toBe(Math.min(3, MOMENTS))
  })

  test('390 px: one column, no horizontal scroll, no header actions, stat figures three across', async ({ page }) => {
    const harness = await openSessionPage(page, 390, 844)
    await expect(page.locator('[data-session-header-actions]')).toBeHidden()
    await expect(page.locator('[data-session-meta] [data-session-watch-vod]')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    const columns = await page.locator('[data-session-stat-row]').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)
    expect(columns).toBe(3)
    const h1Size = await page.getByRole('heading', { level: 1 }).evaluate(node => getComputedStyle(node).fontSize)
    expect(h1Size).toBe('21.6px')
    await assertNoUnexpected(harness)
  })
})
