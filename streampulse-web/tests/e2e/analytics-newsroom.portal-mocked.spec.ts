import { expect, test } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
  assertNoPageHorizontalOverflow,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'
import { installNewsroomMock, type NewsroomMockMode } from './helpers/newsroomMock'

async function install(page: Parameters<typeof installHubUxMock>[0], mode: NewsroomMockMode = 'ready') {
  await installHubUxMock(page)
  await installNewsroomMock(page, mode)
}

test.describe('Pulse Newsroom editorial routes', () => {
  test('keeps Newsroom separate from the overview and reachable from the Live Wire rail', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let newsroomRequests = 0
    page.on('request', (request) => {
      if (/\/v1\/public\/newsroom(?:\?|$)/.test(request.url())) newsroomRequests += 1
    })
    await install(page)
    await page.goto('/analytics')

    const activity = page.getByRole('region', { name: 'Global activity' })
    const rail = activity.locator('.activity-context-rail')
    await expect(rail).toHaveAttribute('data-activity-rail-view', 'idle')
    await expect(rail.locator('.hub-live-wire--rail')).toBeVisible()
    await expect(activity.getByText('Live Desk', { exact: true })).toHaveCount(0)
    expect(newsroomRequests).toBe(0)

    await rail.getByRole('link', { name: /Pulse Newsroom/i }).click()
    await expect(page).toHaveURL(/\/analytics\/newsroom$/)
    await expect(page.getByRole('heading', { name: 'Pulse Newsroom' })).toBeVisible()
    await expect.poll(() => newsroomRequests).toBeGreaterThan(0)
    await assertNoConsoleErrors(page, errors)
  })

  test('secondary story opens its canonical detail route', async ({ page }) => {
    await install(page)
    await page.goto('/analytics/newsroom')
    const story = page.locator('[data-story-id="story-lirik"]')
    await story.getByRole('link', { name: 'Open story' }).click()
    await expect(page).toHaveURL(/\/analytics\/newsroom\/story-lirik$/)
    await expect(page.getByRole('heading', { name: 'Pulse story' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /lirik chat activity is developing/i })).toBeVisible()
  })

  test('canonical detail survives refresh and exposes distinct accessible actions', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await install(page)
    await page.goto('/analytics/newsroom/story-xqc')
    await expect(page.getByRole('heading', { name: 'Pulse story' })).toBeVisible()
    const actions = page.getByRole('group', { name: 'Story actions' })
    const analytics = actions.getByRole('link', { name: 'Analytics' })
    const watch = actions.getByRole('link', { name: 'Watch live' })
    await expect(analytics).toHaveAttribute('href', /\/analytics\/xqc\/s1\?t=240$/)
    await expect(watch).toHaveAttribute('href', 'https://www.twitch.tv/xqc')
    await expect(actions.getByRole('button', { name: 'Copy link' })).toBeVisible()
    await expect(page.locator('.newsroom-page')).not.toContainText('/100')
    const sources = page.getByRole('region', { name: 'Sources & spread' })
    await expect(sources).toContainText('2 matched sources')
    await expect(sources.getByRole('link', { name: /The reaction that set chat off/i })).toHaveAttribute('href', /^https:\/\/clips\.twitch\.tv\//)
    await expect(sources.getByRole('link', { name: /LSF discussion follows/i })).toHaveAttribute('href', /^https:\/\/www\.reddit\.com\//)
    await expect(sources).toContainText('does not change its StreamPulse reaction score')
    await expect(page.locator('.newsroom-timeline__item')).toHaveCount(2)
    await expect(page.locator('.newsroom-ratio-timeline__point')).toHaveCount(4)

    await page.reload()
    await expect(page).toHaveURL(/\/analytics\/newsroom\/story-xqc$/)
    await expect(page.getByRole('heading', { level: 2, name: /xQc emote reaction keeps building/i })).toBeVisible()
    await page.getByRole('link', { name: 'All stories' }).click()
    await expect(page).toHaveURL(/\/analytics\/newsroom$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/analytics\/newsroom\/story-xqc$/)
    await assertNoConsoleErrors(page, errors)
  })

  for (const mode of ['empty', 'unavailable', 'malformed'] as const) {
    test(`${mode} state is explicit on the standalone route`, async ({ page }) => {
      await install(page, mode)
      await page.goto('/analytics/newsroom')
      await expect(page.getByRole('heading', { name: 'Pulse Newsroom' })).toBeVisible()
      if (mode === 'empty') {
        await expect(page.getByText('Quiet now')).toBeVisible()
      } else {
        await expect(page.getByText('Pulse Newsroom unavailable')).toBeVisible()
      }
      await expect(page.locator('.activity-context-rail, .hub-live-wire')).toHaveCount(0)
    })
  }

  test('stale index preserves stories and labels both content and shell as stale', async ({ page }) => {
    await install(page, 'stale')
    await page.goto('/analytics/newsroom')
    await expect(page.getByLabel('Newsroom: Stale')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /xQc emote reaction keeps building/i })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: /Data through/i })).toBeVisible()
    await expect(page.getByLabel('Newsroom: Live')).toHaveCount(0)
  })

  for (const width of [390, 768, 1119, 1280, 1440, 1600]) {
    test(`keeps the flat editorial index responsive at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 800 ? 1000 : 900 })
      await install(page)
      await page.goto('/analytics/newsroom')
      await expect(page.getByRole('heading', { name: 'Pulse Newsroom' })).toBeVisible()
      await expect(page.locator('.newsroom-page__lead-grid')).toBeVisible()
      await expect(page.locator('.newsroom-lead').first()).toBeVisible()
      await expect(page.locator('.newsroom-index__grid')).toBeVisible()
      const presentation = await page.evaluate(() => {
        const lead = document.querySelector<HTMLElement>('.newsroom-lead')
        const index = document.querySelector<HTMLElement>('.newsroom-index__grid')
        const leadGrid = document.querySelector<HTMLElement>('.newsroom-page__lead-grid')
        if (!lead || !index || !leadGrid) return null
        return {
          leadBackgroundImage: getComputedStyle(lead).backgroundImage,
          indexColumns: getComputedStyle(index).gridTemplateColumns.split(' ').length,
          leadColumns: getComputedStyle(leadGrid).gridTemplateColumns.split(' ').length,
        }
      })
      expect(presentation).not.toBeNull()
      expect(presentation?.leadBackgroundImage).toBe('none')
      expect(presentation?.indexColumns).toBe(width <= 640 ? 1 : 2)
      expect(presentation?.leadColumns).toBe(width <= 900 ? 1 : 2)
      await assertNoPageHorizontalOverflow(page)
    })
  }

  test('window controls fetch their requested server range and preserve canonical navigation', async ({ page }) => {
    const requested: string[] = []
    page.on('request', (request) => {
      if (/\/v1\/public\/newsroom\?/.test(request.url())) requested.push(new URL(request.url()).searchParams.get('window') ?? '')
    })
    await install(page)
    await page.goto('/analytics/newsroom')
    await page.getByRole('button', { name: '24h' }).click()
    await expect(page).toHaveURL(/window=24h/)
    await page.getByRole('button', { name: '7d' }).click()
    await expect(page).toHaveURL(/window=7d/)
    await expect.poll(() => requested).toEqual(expect.arrayContaining(['live', '24h', '7d']))
  })
})
