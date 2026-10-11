import { test, expect } from '@playwright/test'

// Runs against a build with My Moments on: VITE_ACCOUNT_MOMENTS=1 npx playwright test account-moments
test.skip(process.env.VITE_ACCOUNT_MOMENTS !== '1', 'needs VITE_ACCOUNT_MOMENTS=1')

const day = 86_400_000
const saves = [
  { id: 'b1', login: 'fixturechan', streamId: '123456789', vodId: '2806037629', offsetSeconds: 754, label: 'Chat erupts after the clutch', notes: 'Clip this for the recap', createdAt: new Date(Date.now() - 2 * day).toISOString() },
  { id: 'b2', login: 'otherchan', streamId: '987654321', offsetSeconds: 3725, label: 'Raid lands', notes: '', createdAt: new Date(Date.now() - 5 * day).toISOString() },
]
const history = [
  { key: 'fixturechan:123456789:100', login: 'fixturechan', streamId: '123456789', vodId: '2806037629', offsetSeconds: 100, title: 'Opening hype', jumpedAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() + 29 * day).toISOString() },
]

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
    return url.origin === origin ? route.continue() : route.abort()
  })
})

test('My Moments shows account bookmarks and synced history, and forgets history only on confirmation', async ({ page, baseURL }, info) => {
  let entries = [...history]
  const csrf = 'ab'.repeat(32)
  await page.context().addCookies([{ name: '__Host-pulse_csrf', value: csrf, domain: new URL(baseURL!).hostname, path: '/', secure: true, sameSite: 'Strict' }])
  await page.route('**/v1/account/me', route => route.fulfill({ status: 200, json: { accountId: 'test-account' } }))
  await page.route('**/v1/account/saves/list', route => {
    expect(route.request().headers()['x-pulse-csrf']).toBe(csrf)
    return route.fulfill({ status: 200, json: { saves } })
  })
  await page.route('**/v1/account/history/list', route => route.fulfill({ status: 200, json: { settings: { syncEnabled: true, retentionDays: 30 }, entries } }))
  await page.route('**/v1/account/history/forget', route => { entries = []; return route.fulfill({ status: 204 }) })

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/account/moments')
    await expect(page.getByRole('heading', { name: 'My Moments', level: 1 })).toBeVisible()
    const first = page.getByRole('listitem').filter({ hasText: 'Chat erupts after the clutch' })
    await expect(first.getByText('Clip this for the recap')).toBeVisible()
    await expect(first.getByRole('link', { name: 'Replay on Twitch' })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2806037629?t=754s')
    await expect(page.getByRole('listitem').filter({ hasText: 'Raid lands' }).getByRole('link', { name: 'Open in Pulse' })).toHaveAttribute('href', '/analytics/otherchan/987654321#t=3725')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`account-moments-saved-${width}.png`), fullPage: true })
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText('Opening hype')).toBeVisible()
    await page.screenshot({ path: info.outputPath(`account-moments-history-${width}.png`), fullPage: true })
  }

  await page.getByRole('button', { name: 'Forget all history…' }).click()
  await expect(page.getByRole('heading', { name: 'Forget all history?' })).toBeVisible()
  await page.getByRole('button', { name: 'Forget history', exact: true }).click()
  await expect(page.getByText(/History forgotten/)).toBeVisible()
  await expect(page.getByText(/No history yet/)).toBeVisible()
})

test('My Moments asks a signed-out visitor to sign in without any account request', async ({ page }) => {
  const reads: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/account/')) reads.push(request.url()) })
  await page.goto('/account/moments')
  await expect(page.getByRole('link', { name: 'Tester sign-in' })).toBeVisible()
  expect(reads).toEqual([])
})
