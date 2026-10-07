import { expect, test, type Page } from '@playwright/test'

import { seedBetaKey } from './helpers/auth'
import { installExplorerMock } from './helpers/explorerMock'
import { installHubUxMock } from './helpers/hubUxMock'

/**
 * Route-change scroll, cold-load fragments, the dashboard narrow menu and the
 * extension's release-notes destination (OP1-FUN-008/001/005/003).
 */

// Registered first, so the specific mocks installed later take precedence.
async function guardNetwork(page: Page, baseURL: string | undefined) {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/v1/')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
    }
    if (url.origin === origin) return route.continue()
    return route.abort('blockedbyclient')
  })
}

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))
const topOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => Math.round(element.getBoundingClientRect().top))

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => scrollY(page)).toBeGreaterThan(200)
}

/** The reader wheels back up to the top of the page. */
async function wheelToTop(page: Page) {
  await page.mouse.move(195, 400)
  await page.mouse.wheel(0, -30_000)
  await expect.poll(() => scrollY(page)).toBe(0)
}

// Chromium identifies history entries through the Navigation API; other browsers may not.
const ENTRY_IDENTITY = [
  { name: 'with the Navigation API', hidden: false },
  { name: 'without the Navigation API', hidden: true },
] as const

async function useEntryIdentity(page: Page, hidden: boolean) {
  if (hidden) {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'navigation', { configurable: true, value: undefined })
    })
  }
}

async function expectEntryIdentity(page: Page, hidden: boolean) {
  expect(await page.evaluate(() => typeof (window as { navigation?: { currentEntry?: { id?: unknown } } }).navigation?.currentEntry?.id))
    .toBe(hidden ? 'undefined' : 'string')
}

test.beforeEach(async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await guardNetwork(page, baseURL)
})

test.describe('in-app navigation scroll', () => {
  test('a footer link opens the next page at the top; Back keeps the browser restoration', async ({ page }) => {
    await page.goto('/docs')
    await scrollToBottom(page)
    await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Support', exact: true }).click()
    await expect(page).toHaveURL(/\/support$/)
    await expect.poll(() => scrollY(page)).toBe(0)
    expect(await topOf(page, 'h1')).toBeGreaterThanOrEqual(0)

    await page.goBack()
    await expect(page).toHaveURL(/\/docs$/)
    await expect.poll(() => scrollY(page)).toBeGreaterThan(0)
  })

  test('a pushed /docs#extension link lands on its section below the sticky header', async ({ page }) => {
    await page.goto('/support')
    await scrollToBottom(page)
    await page.getByRole('link', { name: /extension setup guide/i }).click()
    await expect(page).toHaveURL(/\/docs#extension$/)
    // .app-shell section[id] carries scroll-margin-top: 6rem (96 px).
    await expect.poll(() => topOf(page, '#extension')).toBeLessThanOrEqual(100)
    expect(await topOf(page, '#extension')).toBeGreaterThanOrEqual(90)
  })

  test('Back to /docs#api leaves the Developer reference the reader closed closed', async ({ page }) => {
    await page.goto('/docs#api')
    const details = page.locator('details:has(#api)')
    await expect(details).toHaveAttribute('open', '')
    await details.locator('summary').click()
    await expect(details).not.toHaveAttribute('open', '')
    await scrollToBottom(page)
    await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Support', exact: true }).click()
    await expect(page).toHaveURL(/\/support$/)
    // The reader is on Support: Docs is gone, so Back renders it afresh with the reference closed.
    await expect(page.getByTestId('docs-page')).toHaveCount(0)

    await page.goBack()
    await expect(page).toHaveURL(/\/docs#api$/)
    await expect(page.getByTestId('docs-page')).toBeVisible()
    await page.waitForTimeout(1_200)
    await expect(details).not.toHaveAttribute('open', '')
  })

  test('the landing Developer reference card opens the collapsed #api section', async ({ page }) => {
    await page.goto('/')
    const card = page.locator('a.sl-rescard[href="/docs#api"]')
    await card.scrollIntoViewIfNeeded()
    await card.click()
    await expect(page).toHaveURL(/\/docs#api$/)
    await expect(page.locator('details:has(#api)')).toHaveAttribute('open', '')
    await expect(page.locator('#api')).toBeInViewport()
  })
})

for (const identity of ENTRY_IDENTITY) {
  test.describe(`a native #link followed again lands again (${identity.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await useEntryIdentity(page, identity.hidden)
    })

    test('Docs table of contents: Install, Data coverage, then Install again', async ({ page }) => {
      await page.goto('/docs')
      await expectEntryIdentity(page, identity.hidden)
      const toc = page.getByRole('navigation', { name: 'On this page' })
      await toc.getByRole('link', { name: 'Install' }).click()
      await expect(page).toHaveURL(/\/docs#extension$/)
      await expect.poll(() => topOf(page, '#extension')).toBeLessThanOrEqual(100)
      await wheelToTop(page)
      await toc.getByRole('link', { name: 'Data coverage' }).click()
      await expect(page).toHaveURL(/\/docs#coverage$/)
      await wheelToTop(page)

      await toc.getByRole('link', { name: 'Install' }).click()
      await expect(page).toHaveURL(/\/docs#extension$/)
      // Past the settle window: nothing pulls the section away from its 96 px margin.
      await page.waitForTimeout(1_500)
      expect(await topOf(page, '#extension')).toBeGreaterThanOrEqual(90)
      expect(await topOf(page, '#extension')).toBeLessThanOrEqual(100)
    })

    test('hub section links at 390 px: Tracked, Live rail, then Tracked again', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await installHubUxMock(page)
      await page.goto('/analytics')
      await expectEntryIdentity(page, identity.hidden)
      await expect(page.locator('#section-tracked')).toBeVisible()
      await page.waitForTimeout(1_500)
      const sections = page.locator('nav.hub-mobile-sections')
      await sections.locator('a[href="#section-tracked"]').click()
      await expect.poll(() => topOf(page, '#section-tracked')).toBeLessThanOrEqual(96)
      await wheelToTop(page)
      await sections.locator('a[href="#section-live-rail"]').click()
      await expect(page).toHaveURL(/#section-live-rail$/)
      await wheelToTop(page)

      await sections.locator('a[href="#section-tracked"]').click()
      await expect(page).toHaveURL(/#section-tracked$/)
      await page.waitForTimeout(1_500)
      expect(Math.abs((await topOf(page, '#section-tracked')) - 80)).toBeLessThanOrEqual(16)
    })

    test('N4: cold /analytics#section-tracked, native Live rail, then native Tracked lands at the top', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await installHubUxMock(page)
      await page.goto('/analytics#section-tracked')
      await expectEntryIdentity(page, identity.hidden)
      await expect.poll(() => topOf(page, '#section-tracked')).toBeLessThanOrEqual(96)
      await page.waitForTimeout(1_500)
      await wheelToTop(page)
      const sections = page.locator('nav.hub-mobile-sections')
      await sections.locator('a[href="#section-live-rail"]').click()
      await expect(page).toHaveURL(/#section-live-rail$/)
      await wheelToTop(page)

      await sections.locator('a[href="#section-tracked"]').click()
      await expect(page).toHaveURL(/#section-tracked$/)
      await page.waitForTimeout(1_500)
      expect(Math.abs((await topOf(page, '#section-tracked')) - 80)).toBeLessThanOrEqual(16)
    })
  })
}

test.describe('cold-load fragments on analytics routes', () => {
  for (const path of ['/analytics#section-tracked', '/analytics?window=7d#section-tracked', '/analytics#section-emote-signal']) {
    test(`${path} lands on its section once the hub has rendered`, async ({ page }) => {
      await installHubUxMock(page)
      await page.goto(path)
      const id = path.split('#')[1]
      await expect(page.locator(`#${id}`)).toBeVisible()
      await expect.poll(() => scrollY(page)).toBeGreaterThan(300)
      // Hub sections carry scroll-margin-top: 5.5rem / 5rem under the sticky top navigation.
      await expect.poll(() => topOf(page, `#${id}`)).toBeLessThanOrEqual(100)
      expect(await topOf(page, `#${id}`)).toBeGreaterThanOrEqual(0)
    })
  }

  for (const [snapshot, identity] of [
    ['a cached hub snapshot', ENTRY_IDENTITY[0]],
    ['no cached hub snapshot', ENTRY_IDENTITY[0]],
    ['a cached hub snapshot', ENTRY_IDENTITY[1]],
  ] as const) {
    const named = identity.hidden ? ` (${identity.name})` : ''
    test(`Back from a channel returns to #section-tracked with ${snapshot}${named}`, async ({ page }) => {
      await useEntryIdentity(page, identity.hidden)
      await installHubUxMock(page)
      await page.goto('/analytics#section-tracked')
      await expectEntryIdentity(page, identity.hidden)
      await expect.poll(() => topOf(page, '#section-tracked')).toBeLessThanOrEqual(100)
      await page.waitForTimeout(1_500)
      const left = await topOf(page, '#section-tracked')
      expect(left).toBeGreaterThanOrEqual(0)

      await page.locator('#section-tracked a[href^="/analytics/"]').first().click()
      await expect(page).toHaveURL(/\/analytics\/[a-z0-9_]+$/)
      // The channel page has replaced the hub (its route chunk loads first).
      await expect(page.locator('#section-tracked')).toHaveCount(0)
      await expect.poll(() => scrollY(page)).toBe(0)
      if (snapshot === 'no cached hub snapshot') {
        await page.evaluate(() => {
          for (const key of Object.keys(localStorage)) if (key.startsWith('sp:publicHub')) localStorage.removeItem(key)
        })
        // Back first renders the loading skeleton, which clamps the browser's restored offset.
        await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 1_000))
          await route.fallback()
        })
      }
      await page.goBack()
      await expect(page).toHaveURL(/\/analytics#section-tracked$/)
      await expect.poll(() => topOf(page, '#section-tracked'), { timeout: 10_000 }).toBeGreaterThanOrEqual(left - 16)
      expect(await topOf(page, '#section-tracked')).toBeLessThanOrEqual(left + 16)
      // Still there once the refreshed hub has replaced the snapshot or skeleton.
      await page.waitForTimeout(1_500)
      expect(Math.abs((await topOf(page, '#section-tracked')) - left)).toBeLessThanOrEqual(16)
    })
  }

  test('Explorer honours the skip-link fragment #analytics-main on a cold load', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installHubUxMock(page)
    await installExplorerMock(page)
    await page.goto('/analytics/explore#analytics-main')
    await expect(page.getByRole('heading', { name: 'Pulse Explorer' })).toBeVisible()
    await expect.poll(() => topOf(page, '#analytics-main')).toBeLessThanOrEqual(2)
    expect(await topOf(page, '#analytics-main')).toBeGreaterThanOrEqual(-2)
  })
})

test.describe('Explorer list and detail', () => {
  test('on desktop, opening a broadcast and Escape keep the window where the reader left it', async ({ page }) => {
    await installHubUxMock(page)
    await installExplorerMock(page)
    await page.goto('/analytics/explore')
    await expect(page.locator('.explorer-result')).toHaveCount(4)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => scrollY(page)).toBeGreaterThan(40)
    const left = await scrollY(page)

    await page.locator('.explorer-result').filter({ hasText: 'lirik' }).click()
    await expect(page).toHaveURL(/\/analytics\/explore\/pulse-lirik-session-2/)
    await expect(page.getByRole('heading', { level: 2, name: /lirik/i })).toBeVisible()
    await page.waitForTimeout(500)
    expect(Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(2)

    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/analytics\/explore(\?|$)/)
    await page.waitForTimeout(500)
    expect(Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(2)
  })

  test('at 390 px a broadcast replaces the list and opens at the top', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installHubUxMock(page)
    await installExplorerMock(page)
    await page.goto('/analytics/explore')
    const result = page.locator('.explorer-result').filter({ hasText: 'sodapoppin' })
    await result.scrollIntoViewIfNeeded()
    await expect.poll(() => scrollY(page)).toBeGreaterThan(200)
    await result.click()
    await expect(page).toHaveURL(/\/analytics\/explore\/pulse-soda-session-4/)
    await expect.poll(() => scrollY(page)).toBe(0)
    await expect(page.locator('.explorer-results')).toBeHidden()

    await page.getByRole('link', { name: 'Back to broadcasts' }).click()
    await expect(page).toHaveURL(/\/analytics\/explore(\?|$)/)
    await expect.poll(() => scrollY(page)).toBe(0)
  })
})

test('a rejected beta key opens the hub at the top, not at the dashboard offset', async ({ page }) => {
  await seedBetaKey(page, 'test-beta-key')
  await installHubUxMock(page)
  await page.setViewportSize({ width: 390, height: 360 })
  await page.goto('/dashboard')
  await expect(page.locator('#dashboard-navigation')).toBeAttached()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => scrollY(page)).toBeGreaterThan(100)
  // What apiClient dispatches when a gated read answers 401.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('auth:rejected')))
  await expect(page).toHaveURL(/\/analytics$/)
  await expect(page.locator('#section-tracked')).toBeVisible()
  await expect.poll(() => scrollY(page)).toBe(0)
  await page.waitForTimeout(500)
  expect(await scrollY(page)).toBe(0)
})

test.describe('dashboard header at narrow widths', () => {
  test('Home, Clips and Analytics sit behind a Menu disclosure at 390 px', async ({ page }) => {
    await seedBetaKey(page, 'test-beta-key')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/clips')
    const menu = page.getByRole('button', { name: 'Menu', exact: true })
    await expect(menu).toBeVisible()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    const nav = page.locator('#dashboard-navigation')
    await expect(nav.getByRole('link', { name: 'Analytics' })).toBeHidden()

    await menu.click()
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true')
    for (const name of ['Home', 'Clips', 'Analytics']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await expect(nav.getByRole('link', { name: 'Analytics' })).toBeHidden()

    await menu.click()
    await nav.getByRole('link', { name: 'Analytics' }).click()
    await expect(page).toHaveURL(/\/analytics$/)
  })

  test('the full link row stays visible above 960 px with no Menu button', async ({ page }) => {
    await seedBetaKey(page, 'test-beta-key')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard')
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden()
    for (const name of ['Home', 'Clips', 'Analytics']) {
      await expect(page.locator('#dashboard-navigation').getByRole('link', { name, exact: true })).toBeVisible()
    }
  })
})

test('the extension "Release details" destination is a prerendered release-notes page', async ({ page }) => {
  const response = await page.goto('/changelog')
  expect(response?.status()).toBe(200)
  // The document itself carries the page, as Cloudflare Pages serves it on a cold load.
  expect(await response?.text()).toContain('data-testid="changelog-page"')
  await expect(page).toHaveTitle('Release Notes — StreamPulse')
  await expect(page.getByRole('heading', { level: 1, name: 'Release notes' })).toBeVisible()
  await expect(page.locator('#v0\\.2\\.1')).toBeVisible()
  await expect(page.getByTestId('not-found')).toHaveCount(0)
})
