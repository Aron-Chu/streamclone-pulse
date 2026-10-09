import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

type Row = Record<string, string | number>

test('packaged history sync joins the account, sends real jumps, pulls other browsers and respects clear and off', async ({ extension, prepare }, testInfo) => {
  test.setTimeout(60_000)
  await prepare()
  const bearer = 'a'.repeat(64)
  const credentials = () => ({ state: 'approved', accountId: '22222222-2222-4222-8222-222222222222', deviceId: '11111111-1111-4111-8111-111111111111',
    token: bearer, refreshToken: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() })
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({ status: 201, json: { pollingSecret: 'd'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600000).toISOString() } }))
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links/poll', route => route.fulfill({ status: 200, json: credentials() }))
  await extension.context.route('https://api.streampulse.stream/v1/pulse/bookmarks**', route => route.fulfill({ status: 200, json: { items: [] } }))

  // The account's side, as /v1/account/history/* behaves: newest jump wins, off deletes.
  const server = { settings: { syncEnabled: false, retentionDays: 30 }, rows: new Map<string, Row>(), cleared: false, calls: [] as Array<{ path: string; body: Record<string, unknown> }> }
  await extension.context.route('https://api.streampulse.stream/v1/account/history/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/v1/account/history/', '')
    const body = route.request().postDataJSON() as Record<string, unknown>
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers().authorization).toBe(`Bearer ${bearer}`)
    server.calls.push({ path, body })
    if (path === 'settings') {
      expect(Object.keys(body).every(k => k === 'syncEnabled' || k === 'retentionDays')).toBe(true)
      Object.assign(server.settings, body)
      if (body.syncEnabled === false) server.rows.clear()
      await route.fulfill({ status: 200, json: server.settings }); return
    }
    if (path === 'clear') { server.rows.clear(); server.cleared = true; await route.fulfill({ status: 204 }); return }
    if (!server.settings.syncEnabled) { await route.fulfill({ status: 409, json: { error: 'history_sync_off', settings: server.settings } }); return }
    for (const e of body.entries as Row[]) {
      expect(Object.keys(e).every(k => ['login', 'streamId', 'vodId', 'offsetSeconds', 'title', 'jumpedAt'].includes(k))).toBe(true)
      expect(Number.isInteger(e.offsetSeconds)).toBe(true)
      const key = `${e.login}:${e.streamId || e.vodId}:${e.offsetSeconds}`
      server.rows.set(key, { ...e, key, expiresAt: new Date(Date.parse(String(e.jumpedAt)) + server.settings.retentionDays * 86400000).toISOString() })
    }
    await route.fulfill({ status: 200, json: { settings: server.settings, entries: [...server.rows.values()], cursor: `h1.${Date.now() * 1000}`, reset: true,
      ...(server.cleared ? { clearedAt: new Date(Date.now() - 1000).toISOString() } : {}) } })
  })

  const page = extension.page
  const settled = () => page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  const start = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'start' }))
  expect(start.account.state).toBe('pending')
  await expect.poll(async () => (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'poll' }))).account.state,
    { timeout: 15000, intervals: [1000] }).toBe('linked')

  await page.getByRole('tab', { name: 'Storage & privacy', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sync with your account' })).toBeVisible()
  const sync = page.getByRole('checkbox', { name: /Sync watched history to your account/ })
  await expect(sync).not.toBeChecked()
  await expect(page.getByText('Off. Only this browser keeps its history, and removing the extension removes it. Turn sync on to keep it through a reinstall.', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await settled()
  await page.screenshot({ path: testInfo.outputPath('history-sync-off-1440.png'), fullPage: true })

  await sync.click()
  await expect(page.getByText(/History sync is on\./)).toBeVisible()
  await expect(sync).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Remember watched moments/ })).toBeChecked()
  await expect(page.getByText('Synced just now.', { exact: false })).toBeVisible()
  expect(server.settings).toEqual({ syncEnabled: true, retentionDays: 30 })

  // A real confirmed jump on Twitch is queued, then sent on the next sync.
  const twitch = await extension.context.newPage()
  await openTwitchChannel(twitch)
  const recorded = await extension.serviceWorker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.twitch.tv/*' }))[0]
    const [response] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: async () => {
      const status = await chrome.runtime.sendMessage({ type: 'MOMENT_CAPTURE', action: 'status' })
      return chrome.runtime.sendMessage({ type: 'MOMENT_CAPTURE', action: 'record', epoch: status.epoch, watchedSeconds: 10,
        reference: { id: 'moment', channel: 'fixturechan', title: 'Clutch round', streamId: '123456789', vodId: '2806037629', offsetSeconds: 100.4, availability: 'unresolved' } })
    } })
    return response.result
  })
  expect(recorded).toEqual({ ok: true })
  await page.bringToFront()
  await page.reload()
  await expect.poll(() => server.rows.has('fixturechan:123456789:100')).toBe(true)
  expect(server.rows.get('fixturechan:123456789:100')).toMatchObject({ login: 'fixturechan', title: 'Clutch round', offsetSeconds: 100 })

  // Another browser on the account watched something; this one shows it.
  server.rows.set('fixturechan:123456789:250', { key: 'fixturechan:123456789:250', login: 'fixturechan', streamId: '123456789', vodId: '2806037629', offsetSeconds: 250,
    title: 'Seen on my laptop', jumpedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 29 * 86400000).toISOString() })
  await page.reload()
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.getByText('Seen on my laptop', { exact: true })).toBeVisible()
  await expect(page.getByText('Clutch round', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Storage & privacy', exact: true }).click()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await settled()
    await page.screenshot({ path: testInfo.outputPath(`history-sync-on-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  // Clearing goes to the account first and says so.
  await page.getByRole('button', { name: /Clear history/ }).click()
  await expect(page.getByText(/in your account and in your other signed-in browsers/)).toBeVisible()
  await page.getByRole('button', { name: 'Confirm change' }).click()
  await expect(page.getByText('History cleared. Bookmarks were kept.', { exact: true })).toBeVisible()
  expect(server.calls.some(c => c.path === 'clear')).toBe(true)
  expect(server.rows.size).toBe(0)

  // Off deletes the account's copy only.
  await sync.click()
  await expect(page.getByRole('heading', { name: 'Stop syncing history?' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm change' }).click()
  await expect(page.getByText(/History sync is off\./)).toBeVisible()
  await expect(sync).not.toBeChecked()
  expect(server.settings.syncEnabled).toBe(false)
  const publicStorage = await extension.serviceWorker.evaluate(() => chrome.storage.local.get(null))
  expect(JSON.stringify(publicStorage)).not.toContain(bearer)
})
