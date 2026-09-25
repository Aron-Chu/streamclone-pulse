import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

test('VOD bookmark reaches the account library and survives reload without duplicate writes', async ({ extension, prepare }) => {
  test.setTimeout(30000)
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: {
    overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded',
  } })
  const token = 'a'.repeat(64)
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({
    status: 201, json: { pollingSecret: 'd'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600000).toISOString() },
  }))
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links/poll', route => route.fulfill({ json: {
    state: 'approved', accountId: '22222222-2222-4222-8222-222222222222', deviceId: '11111111-1111-4111-8111-111111111111',
    token, refreshToken: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  } }))
  let writes = 0
  const reads: string[] = []
  const items: Record<string, unknown>[] = []
  await extension.context.route('https://api.streampulse.stream/v1/pulse/bookmarks**', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`)
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON()
      expect(input).toMatchObject({ login: 'fixturechan', streamId: 'stream-fixture-prev', vodId: '2806037629', offsetSeconds: 120 })
      const item = { ...input, notes: input.notes ?? '', id: 'vod-bookmark', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      items.push(item); writes++
      await route.fulfill({ status: 201, json: item })
    } else {
      reads.push(route.request().url())
      const params = new URL(route.request().url()).searchParams
      await route.fulfill({ json: { items: items.filter(item =>
        (!params.get('streamId') || item.streamId === params.get('streamId'))
        && (!params.get('vodId') || item.vodId === params.get('vodId')),
      ) } })
    }
  })
  const library = extension.page
  await library.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  await library.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'start' }))
  await expect.poll(async () => (await library.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'poll' }))).account.state,
    { timeout: 12000, intervals: [1000] }).toBe('linked')
  const vod = await extension.context.newPage()
  await openTwitchVod(vod)
  await waitForPulseRoot(vod)
  const root = vod.locator('#streamclone-pulse-root')
  const select = () => root.getByRole('button', { name: /^Select minute bucket/ }).first().click()
  await select()
  const bookmark = root.locator('[data-moment-action="bookmark"]')
  await bookmark.click()
  await expect(bookmark).toHaveAttribute('data-moment-save-state', 'saved')
  expect(writes).toBe(1)
  await vod.reload()
  await waitForPulseRoot(vod)
  await select()
  await expect(bookmark, JSON.stringify({ reads, items })).toHaveAttribute('data-moment-save-state', 'saved', { timeout: 5000 })
  await expect(bookmark).toBeDisabled()
  expect(writes).toBe(1)
  await library.reload()
  await expect(library.getByRole('listitem').filter({ hasText: 'fixturechan' })).toHaveCount(1)
  await expect(library.getByRole('heading', { name: 'No bookmarks yet' })).toHaveCount(0)
})
