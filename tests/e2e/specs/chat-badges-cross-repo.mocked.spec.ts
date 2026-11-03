import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeExtensionContext, launchExtensionContext, seedExtensionStorage, type LaunchedExtension } from '../helpers/extensionContext.ts'
import { installMockApi } from '../helpers/mockApi.ts'
import { BADGE_LIST_URL, CHAT_URL, serveChatPage } from '../helpers/chatBadges.ts'
import { linkDevice } from '../helpers/supporterMembership.ts'

// The backend integration test produces these exact signed bytes from a real
// disposable database and a synthetic account. This browser test uses them as
// mocked HTTP responses; no Twitch or production service is contacted.
const fixtureDir = process.env.PULSE_BADGE_FIXTURE_DIR

test('two installed test extensions accept the backend list, apply its withdrawal receipt and reconcile removal', async () => {
  test.skip(!fixtureDir, 'requires fresh synthetic lists from the backend integration test')
  const published = readFileSync(join(fixtureDir!, 'backend-badge-on.txt'))
  const removed = readFileSync(join(fixtureDir!, 'backend-badge-off.txt'))
  const withdrawal = JSON.parse(readFileSync(join(fixtureDir!, 'backend-badge-withdrawal.json'), 'utf8'))
  let active = true
  const viewers: LaunchedExtension[] = []
  const removedRequests: number[] = [0, 0]
  try {
    for (let i = 0; i < 2; i++) {
      const viewer = await launchExtensionContext({ headless: true })
      viewers.push(viewer)
      await installMockApi(viewer.context, 'live-ready')
      await viewer.context.route(`${BADGE_LIST_URL}*`, route => {
        if (!active) removedRequests[i] += 1
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: active ? published : removed })
      })
      await serveChatPage(viewer.context, () => 'native')
      await seedExtensionStorage(viewer.serviceWorker)
      await viewer.page.goto(CHAT_URL, { waitUntil: 'load' })
      await expect(viewer.page.locator('.sp-cb-crest')).toHaveCount(1)
      await expect(viewer.page.locator('[data-sp-paint="3"]')).toHaveCount(1)
    }

    // A worker without its own identity overlay or account snapshot can still
    // remove its stale signed entry using the real backend withdrawal receipt.
    const owner = viewers[0]
    await owner.page.screenshot({ path: join(fixtureDir!, 'two-viewer-badge-before.png') })
    await linkDevice(owner.serviceWorker)
    let first = true
    await owner.context.route('https://api.streampulse.stream/v1/billing/badge', route => {
      expect(route.request().postDataJSON()).toEqual({ enabled: false })
      const body = first ? withdrawal : { chatBadge: { available: true, state: 'off' } }
      first = false
      return route.fulfill({ status: 200, json: body })
    })
    const options = await owner.context.newPage()
    await options.goto(`chrome-extension://${owner.extensionId}/options/index.html`)
    const off = () => options.evaluate(async () => chrome.runtime.sendMessage({ type: 'SUPPORTER_CHAT_BADGE', action: 'off' }))
    expect(await off()).toMatchObject({ ok: true, own: 'off' })
    await expect(owner.page.locator('.sp-cb-crest')).toHaveCount(0)
    await expect(owner.page.locator('[data-sp-paint]')).toHaveCount(0)
    expect(await off()).toMatchObject({ ok: true, own: 'off' })
    await expect(owner.page.locator('.sp-cb-crest')).toHaveCount(0)
    // Other viewers keep their verified cached copy until it refreshes.
    await expect(viewers[1].page.locator('.sp-cb-crest')).toHaveCount(1)
    await owner.page.screenshot({ path: join(fixtureDir!, 'two-viewer-own-withdrawal.png') })
    await options.close()

    // Advance each test worker beyond its refresh interval and reload its
    // fixture chat. The backend's newer signed list contains no entries.
    active = false
    for (const [i, viewer] of viewers.entries()) {
      await viewer.serviceWorker.evaluate(() => {
        const actualNow = Date.now.bind(Date)
        Date.now = () => actualNow() + 75 * 60_000
      })
      await viewer.page.reload({ waitUntil: 'load' })
      await expect.poll(() => removedRequests[i]).toBeGreaterThan(0)
      await expect.poll(() => viewer.serviceWorker.evaluate(async () => {
        const value = await chrome.storage.local.get('pulseChatBadgeList')
        return value.pulseChatBadgeList?.text
      })).toBe(removed.toString('utf8'))
      await expect(viewer.page.locator('.sp-cb-crest')).toHaveCount(0)
      await expect(viewer.page.locator('[data-sp-paint]')).toHaveCount(0)
    }
  } finally {
    for (const viewer of viewers) await closeExtensionContext(viewer)
  }
})
