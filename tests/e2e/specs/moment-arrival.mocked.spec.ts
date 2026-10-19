import { test, expect } from '../helpers/testFixtures.ts'
import { stubTwitchMedia } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

// Board E: a VOD opened from a Watch link lands with that moment's minute
// locked and its card open, until the viewer unlocks it.
const VOD_ID = '2806037629'
const storage = { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } as const

test('a timestamped VOD link locks its minute until ×', async ({ extension, prepare }) => {
  test.setTimeout(30000)
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage })
  const vod = extension.page
  await vod.goto(`https://www.twitch.tv/videos/${VOD_ID}?t=1m`, { waitUntil: 'domcontentloaded' })
  await stubTwitchMedia(vod, 'vod')
  await waitForPulseRoot(vod)
  const root = vod.locator('#streamclone-pulse-root')

  const chip = root.locator('.pulse-arrival')
  await expect(chip).toHaveAttribute('data-moment-arrival', 'link')
  await expect(chip).toContainText('From link · 00:01:00')
  await expect(root.getByLabel(/^Selected moment at/)).toBeVisible()

  await chip.getByRole('button', { name: 'Unlock this moment' }).click()
  await expect(chip).toHaveCount(0)
  await expect(root.getByLabel(/^Selected moment at/)).toHaveCount(0)
})

test('a My Moments note is read once and says where the viewer came from', async ({ extension, prepare }) => {
  test.setTimeout(30000)
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage })
  await extension.serviceWorker.evaluate(vodId => chrome.storage.local.set({
    'sp.momentArrival.v1': { vodId, offsetSeconds: 125, clock: 'stream', source: 'library', login: 'fixturechan', title: 'Chat spike', savedAtMs: Date.now() },
  }), VOD_ID)
  const vod = extension.page
  await vod.goto(`https://www.twitch.tv/videos/${VOD_ID}?t=125s`, { waitUntil: 'domcontentloaded' })
  await stubTwitchMedia(vod, 'vod')
  await waitForPulseRoot(vod)
  const root = vod.locator('#streamclone-pulse-root')

  await expect(root.locator('.pulse-arrival')).toHaveAttribute('data-moment-arrival', 'library')
  await expect(root.locator('.pulse-arrival')).toContainText('From My Moments · 00:02:05')
  await expect(root.getByLabel(/^Selected moment at/)).toBeVisible()
  await expect.poll(() => extension.serviceWorker.evaluate(() => chrome.storage.local.get('sp.momentArrival.v1'))).toEqual({})
})
