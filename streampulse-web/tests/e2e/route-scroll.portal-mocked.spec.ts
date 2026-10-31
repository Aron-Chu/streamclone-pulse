import { expect, test, type Page } from './helpers/portalMockedTest'

import { installHubUxMock } from './helpers/hubUxMock'
// The notes the page is built from; the extension's release step marks versions released.
import releaseNotes from '../../../src/shared/release-notes.json' with { type: 'json' }

/**
 * Route-change scroll, cold-load fragments and the extension's release-notes
 * destination (OP1-FUN-008/001/003).
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

/**
 * A followed #link landed: its section is at the top under the sticky top
 * navigation, or the page is scrolled as far as it goes (a section near the end
 * of the page, like the hub's Channels, cannot reach the top). The scroll
 * offset snaps to whole pixels, so below a fractional-height row the section
 * can sit a fraction of a pixel above 0 and still have landed.
 */
const landedOn = (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => {
    const top = element.getBoundingClientRect().top
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    return top > -1 && (top <= 100 || atEnd)
  })

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => scrollY(page)).toBeGreaterThan(200)
}

/**
 * The reader wheels back up to the top of the page. The pointer may rest over
 * the hub chart, whose plot zooms on a plain wheel while Scroll zoom is on (the
 * default since 2026-10-09), so these page-scroll tests turn it off.
 */
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

/** These tests scroll the page with the wheel, never the chart (see wheelToTop). */
async function chartScrollZoomOff(page: Page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('sp.chart.scrollZoom.v1', 'off') } catch { /* storage blocked */ }
  })
}

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

  test('the home page has no Developer reference card; /docs/api still opens the collapsed #api section', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('a.sl-rescard')).toHaveCount(2)
    await expect(page.locator('a.sl-rescard[href="/docs#api"]')).toHaveCount(0)
    await page.goto('/docs/api')
    await expect(page).toHaveURL(/\/docs#api$/)
    await expect(page.locator('details:has(#api)')).toHaveAttribute('open', '')
    await expect(page.locator('#api')).toBeInViewport()
  })
})

for (const identity of ENTRY_IDENTITY) {
  test.describe(`a native #link followed again lands again (${identity.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await chartScrollZoomOff(page)
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
  })
}

test.describe('cold-load fragments on analytics routes', () => {
  for (const path of ['/analytics#channels', '/analytics?window=7d#channels', '/analytics#emotes']) {
    test(`${path} lands on its section once the hub has rendered`, async ({ page }) => {
      await installHubUxMock(page)
      await page.goto(path)
      const id = path.split('#')[1]
      await expect(page.locator(`#${id}`)).toBeVisible()
      await expect.poll(() => scrollY(page)).toBeGreaterThan(300)
      await expect.poll(() => landedOn(page, `#${id}`)).toBe(true)
    })
  }

  for (const [snapshot, identity] of [
    ['a cached hub snapshot', ENTRY_IDENTITY[0]],
    ['no cached hub snapshot', ENTRY_IDENTITY[0]],
    ['a cached hub snapshot', ENTRY_IDENTITY[1]],
  ] as const) {
    const named = identity.hidden ? ` (${identity.name})` : ''
    test(`Back from a channel returns to #channels with ${snapshot}${named}`, async ({ page }) => {
      await useEntryIdentity(page, identity.hidden)
      await installHubUxMock(page)
      await page.goto('/analytics#channels')
      await expectEntryIdentity(page, identity.hidden)
      await expect.poll(() => landedOn(page, '#channels')).toBe(true)
      await page.waitForTimeout(1_500)
      const left = await topOf(page, '#channels')
      expect(left).toBeGreaterThanOrEqual(0)

      await page.locator('#channels a[href^="/analytics/"]').first().click()
      await expect(page).toHaveURL(/\/analytics\/[a-z0-9_]+$/)
      // The channel page has replaced the hub (its route chunk loads first).
      await expect(page.locator('#channels')).toHaveCount(0)
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
      await expect(page).toHaveURL(/\/analytics#channels$/)
      // Back to the place the reader left, once the hub has rendered (the hold waits out the skeleton).
      await expect.poll(async () => Math.abs((await topOf(page, '#channels')) - left), { timeout: 10_000 }).toBeLessThanOrEqual(16)
      // Still there once the refreshed hub has replaced the snapshot or skeleton.
      await page.waitForTimeout(1_500)
      expect(Math.abs((await topOf(page, '#channels')) - left)).toBeLessThanOrEqual(16)
    })
  }
})

test.describe('Back to the Moments list', () => {
  // The Moments page remembers the reader's place per history entry; a pushed
  // page opening at the top must not overwrite that place before it is saved.
  const ways = [
    { name: 'the top-nav Home link', leave: (page: Page) => page.locator('nav.analytics-topnav__links').getByRole('link', { name: 'Home', exact: true }).click() },
    { name: 'a footer link', leave: (page: Page) => page.getByRole('navigation', { name: 'Site links' }).getByRole('link', { name: 'Support', exact: true }).click() },
  ] as const
  for (const { name, leave } of ways) {
    test(`returns the reader to their place in Latest after following ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 640 })
      await installHubUxMock(page)
      await page.goto('/analytics/moments')
      await expect(page.locator('.moments-result').first()).toBeVisible()
      await scrollToBottom(page)
      const left = await scrollY(page)

      await leave(page)
      await expect(page).not.toHaveURL(/\/analytics\/moments/)
      await expect.poll(() => scrollY(page)).toBe(0)

      await page.goBack()
      await expect(page).toHaveURL(/\/analytics\/moments$/)
      await expect(page.locator('.moments-result').first()).toBeVisible()
      await expect.poll(async () => Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(2)
      // Still there once the page's own restore and any late rows have settled.
      await page.waitForTimeout(500)
      expect(Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(2)
    })
  }
})

test('the extension "Release details" destination is a prerendered release-notes page', async ({ page }) => {
  const response = await page.goto('/changelog')
  expect(response?.status()).toBe(200)
  // The document itself carries the page, as Cloudflare Pages serves it on a cold load.
  expect(await response?.text()).toContain('data-testid="changelog-page"')
  await expect(page).toHaveTitle('Release Notes — StreamPulse')
  await expect(page.getByRole('heading', { level: 1, name: 'Release notes' })).toBeVisible()
  // Released versions only: the page starts with the latest release and never shows an
  // "In development" placeholder for the version being built.
  const { releases } = releaseNotes as { releases: Array<{ version: string; status: string; preview?: string[] }> }
  const latestReleased = releases.find((release) => release.status === 'released')
  expect(latestReleased).toBeTruthy()
  // The first section is the latest release. It leads with its highlights card
  // ("What's new in v…"), or says "v… · Released" when it has no highlights.
  const firstSection = page.getByTestId('changelog-page').locator('section').first()
  await expect(firstSection).toBeVisible()
  await expect(firstSection).toHaveAttribute('id', `v${latestReleased!.version}`)
  await expect(firstSection).toContainText(latestReleased!.preview?.length
    ? `What’s new in v${latestReleased!.version}`
    : `v${latestReleased!.version} · Released`)
  await expect(page.getByText(/In development/)).toHaveCount(0)
  await expect(page.getByText(/· Preview/)).toHaveCount(0)
  await expect(page.getByTestId('not-found')).toHaveCount(0)
})
