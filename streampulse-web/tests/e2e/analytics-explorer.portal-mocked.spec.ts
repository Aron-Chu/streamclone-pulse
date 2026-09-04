import { expect, test } from '@playwright/test'

import { attachConsoleErrorGuard, assertNoConsoleErrors, assertNoPageHorizontalOverflow } from './helpers/assertions'
import { installExplorerMock, type ExplorerMockMode } from './helpers/explorerMock'
import { installHubUxMock } from './helpers/hubUxMock'

async function install(page: Parameters<typeof installHubUxMock>[0], mode: ExplorerMockMode = 'ready') {
  await installHubUxMock(page)
  await installExplorerMock(page, mode)
}

test.describe('Pulse Explorer routes', () => {
  test('stays separate from the overview and opens from Live Wire without an overview request', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let explorerRequests = 0
    page.on('request', (request) => {
      if (/\/v1\/public\/explorer(?:\?|$)/.test(request.url())) explorerRequests += 1
    })
    await install(page)
    await page.goto('/analytics')

    const activity = page.getByRole('region', { name: 'Global activity' })
    const rail = activity.locator('.activity-context-rail')
    await expect(rail.locator('.hub-live-wire--rail')).toBeVisible()
    expect(explorerRequests).toBe(0)
    const link = rail.getByRole('link', { name: /Pulse Explorer/i })
    await expect(link).toHaveAttribute('href', '/analytics/explore')
    await link.click()
    await expect(page).toHaveURL(/\/analytics\/explore$/)
    await expect(page.getByRole('heading', { name: 'Pulse Explorer' })).toBeVisible()
    await expect.poll(() => explorerRequests).toBeGreaterThan(0)
    await assertNoConsoleErrors(page, errors)
  })

  test('defaults to 24h strongest and presents the desktop broadcast workspace', async ({ page }) => {
    const requested: URL[] = []
    page.on('request', (request) => {
      if (/\/v1\/public\/explorer\?/.test(request.url())) requested.push(new URL(request.url()))
    })
    await install(page)
    await page.goto('/analytics/explore')
    await expect(page.getByRole('heading', { name: 'Broadcasts' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'xQc' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Qualified moments' })).toBeVisible()
    await expect(page.getByText('Network context')).toBeVisible()
    await expect.poll(() => requested.length).toBeGreaterThan(0)
    expect(requested[0].searchParams.get('window')).toBe('24h')
    expect(requested[0].searchParams.get('sort')).toBe('strongest')

    const presentation = await page.evaluate(() => {
      const avatar = document.querySelector<HTMLElement>('.explorer-avatar')
      const result = document.querySelector<HTMLElement>('.explorer-result')
      const workspace = document.querySelector<HTMLElement>('.pulse-explorer__workspace')
      if (!avatar || !result || !workspace) return null
      const avatarStyle = getComputedStyle(avatar)
      return {
        avatarWidth: avatar.getBoundingClientRect().width,
        avatarHeight: avatar.getBoundingClientRect().height,
        backgroundImage: getComputedStyle(result).backgroundImage,
        columns: getComputedStyle(workspace).gridTemplateColumns.split(' ').length,
        selectedBorders: [
          getComputedStyle(result).borderTopWidth,
          getComputedStyle(result).borderRightWidth,
          getComputedStyle(result).borderBottomWidth,
          getComputedStyle(result).borderLeftWidth,
        ],
        avatarObjectFit: avatarStyle.overflow,
      }
    })
    expect(presentation).not.toBeNull()
    expect(presentation?.avatarWidth).toBeLessThanOrEqual(48)
    expect(presentation?.avatarHeight).toBeLessThanOrEqual(48)
    expect(presentation?.backgroundImage).toBe('none')
    expect(presentation?.columns).toBe(2)
    expect(new Set(presentation?.selectedBorders).size).toBe(1)
    await assertNoPageHorizontalOverflow(page)
  })

  test('opens canonical detail with actions, all moments, matched context, history, and Escape', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await install(page, 'matched-source')
    await page.goto('/analytics/explore?window=7d&sort=recent')
    await page.locator('.explorer-result').filter({ hasText: 'xQc' }).click()
    await expect(page).toHaveURL(/\/analytics\/explore\/pulse-xqc-session-1\?window=7d&sort=recent$/)
    const actions = page.getByRole('group', { name: 'Broadcast actions' })
    await expect(actions.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', /\/analytics\/xqc\/stream-xqc-pulse-xqc-session-1\?t=240$/)
    await expect(actions.getByRole('link', { name: 'Watch live' })).toHaveAttribute('href', 'https://www.twitch.tv/xqc')
    await expect(page.getByRole('img', { name: /reaction score trend with 3 measured moments/i })).toBeVisible()
    await expect(page.locator('.explorer-moments li')).toHaveCount(3)
    const context = page.getByRole('heading', { name: 'Outside coverage' }).locator('..').locator('..')
    await expect(context.getByRole('link', { name: /The reaction that set chat off/i })).toHaveAttribute('href', /^https:\/\/clips\.twitch\.tv\//)
    await expect(context.getByRole('link', { name: /LSF discussion follows/i })).toHaveAttribute('href', /^https:\/\/www\.reddit\.com\//)
    await expect(context).toContainText('never changes StreamPulse scores or ordering')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'xQc' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/analytics\/explore\?window=7d&sort=recent$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/analytics\/explore\/pulse-xqc-session-1\?window=7d&sort=recent$/)
    await assertNoConsoleErrors(page, errors)
  })

  test('single-event detail uses concise evidence instead of a fake trend', async ({ page }) => {
    await install(page, 'single-event')
    await page.goto('/analytics/explore/pulse-xqc-session-1')
    await expect(page.getByText(/not enough measured points/i)).toBeVisible()
    await expect(page.getByRole('img', { name: /reaction score trend/i })).toHaveCount(0)
    await expect(page.locator('.explorer-moments li')).toHaveCount(1)
  })

  test('a failed inspector does not erase the valid desktop result list', async ({ page }) => {
    await install(page)
    await page.route(/\/v1\/public\/explorer\/pulse-lirik-session-2\?/, async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/analytics/explore')
    await page.locator('.explorer-result').filter({ hasText: 'Lirik' }).click()
    await expect(page.getByText('Broadcast details are unavailable')).toBeVisible()
    await expect(page.locator('.explorer-result')).toHaveCount(4)
  })

  for (const mode of ['empty', 'unavailable', 'malformed'] as const) {
    test(`${mode} state is explicit without exposing backend state strings`, async ({ page }) => {
      await install(page, mode)
      await page.goto('/analytics/explore')
      await expect(page.getByRole('heading', { name: 'Pulse Explorer' })).toBeVisible()
      if (mode === 'empty') await expect(page.getByText('No matching broadcasts')).toBeVisible()
      else {
        await expect(page.getByText('Pulse Explorer is unavailable')).toBeVisible()
        await expect(page.getByText('Pulse Explorer is unavailable')).toHaveCount(1)
      }
      await expect(page.locator('body')).not.toContainText('store_unavailable')
      await expect(page.locator('.newsroom-page, .newsroom-lead')).toHaveCount(0)
    })
  }

  test('stale results stay visible and are truthfully labeled', async ({ page }) => {
    await install(page, 'stale')
    await page.goto('/analytics/explore')
    await expect(page.getByLabel('Explorer: Stale')).toBeVisible()
    await expect(page.locator('.explorer-result')).toHaveCount(4)
    await expect(page.getByRole('status').filter({ hasText: /valid results remain visible/i })).toBeVisible()
  })

  for (const width of [390, 768, 1119, 1280, 1440, 1600]) {
    test(`uses responsive index/detail behavior at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 800 ? 1000 : 900 })
      await install(page)
      await page.goto('/analytics/explore')
      await expect(page.locator('.explorer-result')).toHaveCount(4)
      const indexDisplay = await page.locator('.explorer-results').evaluate((element) => getComputedStyle(element).display)
      const inspectorDisplay = await page.locator('.explorer-inspector').evaluate((element) => getComputedStyle(element).display)
      expect(indexDisplay).not.toBe('none')
      expect(inspectorDisplay === 'none').toBe(width < 960)
      await page.locator('.explorer-result').first().click()
      await expect(page).toHaveURL(/\/analytics\/explore\/pulse-xqc-session-1/)
      if (width < 960) await expect(page.locator('.explorer-results')).toBeHidden()
      else await expect(page.locator('.explorer-results')).toBeVisible()
      await expect(page.locator('.explorer-inspector')).toBeVisible()
      if (width < 960) await expect(page.getByRole('link', { name: 'Back to broadcasts' })).toBeVisible()
      await assertNoPageHorizontalOverflow(page)
    })
  }

  test('filters and search are canonical URL state, while old Newsroom links redirect intact', async ({ page }) => {
    const requested: URL[] = []
    page.on('request', (request) => {
      if (/\/v1\/public\/explorer\?/.test(request.url())) requested.push(new URL(request.url()))
    })
    await install(page)
    await page.goto('/analytics/explore/pulse-xqc-session-1?window=7d&signal=emotes')
    await page.getByLabel('Stream state').selectOption('ended')
    await expect(page).toHaveURL('/analytics/explore?window=7d&signal=emotes&state=ended')
    await page.getByLabel('Sort').selectOption('moments')
    await page.getByLabel('Search channel or category').fill('xqc')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page).toHaveURL(/q=xqc/)
    await expect.poll(() => requested.some((url) => url.searchParams.get('q') === 'xqc' && url.searchParams.get('sort') === 'moments')).toBe(true)

    await page.goto('/analytics/newsroom/pulse-xqc-session-1?window=7d&sort=recent#evidence')
    await expect(page).toHaveURL('/analytics/explore/pulse-xqc-session-1?window=7d&sort=recent#evidence')
  })
})
