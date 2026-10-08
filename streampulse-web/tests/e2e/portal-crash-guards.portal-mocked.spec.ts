import { expect, test, type Page } from '@playwright/test'

import { seedBetaKey } from './helpers/auth'
import { installHubUxMock } from './helpers/hubUxMock'

// OP1-RES-004 / OP1-RES-006 / OP1-RES-007: one malformed input must not
// replace a page (nav included) with the error panel. All API traffic mocked.

/** Wrong-typed fields the audit sent one at a time; here all at once. */
async function serveWrongTypedHubRows(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await original(input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!/\/v1\/public\/hub(\?|$)/.test(url) || !response.ok) return response
      const body = await response.clone().json()
      if (body.liveChannels?.[0]) body.liveChannels[0].displayName = { hostile: true }
      if (body.liveChannels?.[1]) body.liveChannels[1].category = 123
      if (body.liveChannels?.[2]) body.liveChannels[2].login = null
      if (body.topMovers?.[0]) body.topMovers[0].login = { hostile: true }
      if (body.livePulseMoments?.[0]) body.livePulseMoments[0].label = { hostile: true }
      return new Response(JSON.stringify(body), { status: response.status, headers: { 'Content-Type': 'application/json' } })
    }
  })
}

/** Serve a page module that throws while rendering, as any unexpected bug would. */
async function breakPageModule(page: Page, name: string) {
  await page.route(`**/assets/${name}-*.js`, route => route.fulfill({
    contentType: 'text/javascript',
    body: `export default function ${name}() { throw new TypeError('e2e: ${name} crashed') }`,
  }))
}

/** Only the site layout has these; nav labels are shared with other shells. */
async function expectNoSiteLayout(page: Page) {
  await expect(page.locator('#public-main')).toHaveCount(0)
  await expect(page.locator('.app-footer')).toHaveCount(0)
}

test.describe('portal crash guards (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/v1/**', route => route.fulfill({ status: 503, json: { error: 'unmocked_endpoint' } }))
  })

  for (const hash of ['#%', '#100%', '#%E0%A4%A']) {
    test(`landing ignores the malformed fragment ${hash}`, async ({ page }) => {
      await page.goto(`/${hash}`)
      await expect(page.locator('.sl-header')).toBeVisible()
      await expect(page.getByRole('heading', { name: /actually reacted to/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
    })
  }

  test('/analytics keeps rendering with a wrong-typed live channel, mover and moment field', async ({ page }) => {
    await installHubUxMock(page)
    await serveWrongTypedHubRows(page)
    await page.goto('/analytics')
    // Wait for the hub rows themselves: before they arrive there is nothing to crash.
    await expect(page.getByText('channel5').first()).toBeAttached()
    await expect(page.getByRole('heading', { name: 'Command center', exact: true })).toBeVisible()
    await expect(page.locator('.analytics-topnav')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
  })

  test('Moments Latest keeps rendering with a wrong-typed moment label', async ({ page }) => {
    await installHubUxMock(page)
    await serveWrongTypedHubRows(page)
    await page.goto('/analytics/moments?view=recent')
    // Wait for the row whose label was wrong-typed: it shows the generic label instead.
    await expect(page.getByRole('button', { name: /^Measured reaction — Open moment for xQc / })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Moments', exact: true })).toBeVisible()
    await expect(page.locator('.analytics-topnav')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
  })

  test('a cached hub snapshot with a wrong-typed row re-validates on reload instead of crashing', async ({ page }) => {
    await installHubUxMock(page)
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Command center', exact: true })).toBeVisible()
    // Stand in for a snapshot persisted by an earlier build before rows were type-checked.
    await expect.poll(() => page.evaluate(() => {
      const key = Object.keys(localStorage).find(name => name.startsWith('sp:publicHub:v1:') && name.endsWith(':24h'))
      if (!key) return false
      const entry = JSON.parse(localStorage.getItem(key)!)
      entry.data.liveChannels[0].displayName = { hostile: true }
      entry.data.liveChannels[1].login = null
      localStorage.setItem(key, JSON.stringify(entry))
      return true
    })).toBe(true)

    // Hold the network read so the reload can only paint from the cached snapshot.
    let hubRequests = 0
    await page.route(/\/v1\/public\/hub(\?.*)?$/, () => { hubRequests += 1 })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Command center', exact: true })).toBeVisible()
    await expect(page.getByText('channel5').first()).toBeAttached()
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
    await expect.poll(() => hubRequests).toBeGreaterThan(0)
  })

  test('a crashing analytics page keeps the analytics top navigation, and its links recover', async ({ page }) => {
    await installHubUxMock(page)
    await breakPageModule(page, 'AnalyticsLandingPage')
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    await expect(page.locator('.analytics-topnav')).toBeVisible()
    await expectNoSiteLayout(page)

    await page.getByRole('navigation', { name: 'Analytics navigation' }).getByRole('link', { name: 'All moments' }).click()
    await expect(page.getByRole('heading', { name: 'Moments', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
  })

  test('a crashing dashboard page keeps the dashboard header, and its nav recovers', async ({ page }) => {
    await seedBetaKey(page)
    await breakPageModule(page, 'Clips')
    await page.goto('/dashboard/clips')
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'StreamPulse Dashboard' })).toBeVisible()
    await expectNoSiteLayout(page)

    await page.getByRole('link', { name: 'Home', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'StreamPulse workspace' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
  })
})
