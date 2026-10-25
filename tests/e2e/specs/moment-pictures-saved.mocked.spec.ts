import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

/**
 * A moment saved from the panel while the tab holds a frame of it keeps that
 * frame on this device: its My Moments row and Preview show it. A save with no
 * frame keeps the clock tile at the same size. Removing it in Preview removes
 * its picture. With Moment pictures off, Settings offers to remove the
 * pictures still kept.
 */
test('a save keeps the frame its tab held; My Moments shows it, and Settings can remove it', async ({ extension, prepare }) => {
  test.setTimeout(60000)
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: {
    overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded',
  } })
  const vod = await extension.context.newPage()
  await openTwitchVod(vod)
  await waitForPulseRoot(vod)
  await vod.bringToFront()
  // A playing player: a canvas stream stands in for Twitch's video.
  await vod.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 })
    const paint = canvas.getContext('2d')!
    let hue = 0
    setInterval(() => { paint.fillStyle = `hsl(${hue = (hue + 40) % 360} 80% 50%)`; paint.fillRect(0, 0, 320, 180) }, 100)
    const video = document.querySelector('video')!
    video.muted = true
    video.srcObject = canvas.captureStream(10)
    await video.play()
  })
  // The extension reads the player at 00:02:30, inside the minute saved below.
  await extension.serviceWorker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.twitch.tv/videos/*' }))[0]
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: () => {
      Object.defineProperty(document.querySelector('video')!, 'currentTime', { configurable: true, get: () => 150 })
    } })
  })
  const pictures = () => extension.serviceWorker.evaluate(() => new Promise<number>(resolve => {
    const open = indexedDB.open('pulse-moment-pictures-v1', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('pictures', { keyPath: 'key' })
    open.onerror = () => resolve(-1)
    open.onsuccess = () => {
      const db = open.result
      const count = db.transaction('pictures').objectStore('pictures').count()
      count.onsuccess = () => { resolve(count.result); db.close() }
    }
  }))

  // Save minute 00:02 from the panel, as a viewer does.
  const root = vod.locator('#streamclone-pulse-root')
  await root.getByRole('application', { name: /^Chart plot/ }).focus()
  await vod.keyboard.press('End')
  await vod.keyboard.press('ArrowLeft')
  await vod.keyboard.press('Enter')
  const bookmark = root.locator('[data-moment-action="bookmark"]')
  await bookmark.click()
  await expect(bookmark).toHaveAttribute('data-moment-save-state', 'saved')
  await expect.poll(pictures, { timeout: 20000, intervals: [1000] }).toBe(1)

  // A save of a moment this tab never played keeps no picture.
  await extension.serviceWorker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.twitch.tv/videos/*' }))[0]
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: () => chrome.runtime.sendMessage({
      type: 'SAVE_BOOKMARK', bookmark: { login: 'fixturechan', streamId: 'stream-fixture-prev', vodId: '2806037629', offsetSeconds: 2000, label: 'Saved without picture', source: 'extension' } }) })
  })

  const library = extension.page
  await library.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  const withPicture = library.locator('.pl-moment').filter({ has: library.locator('.pl-media-compact img[src^="blob:"]') })
  const withClock = library.locator('.pl-moment').filter({ hasText: 'Saved without picture' })
  await expect(withPicture).toHaveCount(1)
  await expect(withClock.locator('.pl-media-tile')).toContainText('33:20')
  // One 16:9 size either way, so titles line up.
  const picture = (await withPicture.locator('.pl-media-compact').boundingBox())!
  const clock = (await withClock.locator('.pl-media-tile').boundingBox())!
  expect(Math.round(picture.width)).toBe(128)
  expect(Math.abs(picture.width - clock.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(picture.height - clock.height)).toBeLessThanOrEqual(2)
  expect(Math.abs(picture.x - clock.x)).toBeLessThanOrEqual(1)

  await withPicture.getByRole('button', { name: /^Preview: / }).click()
  const preview = library.getByRole('dialog', { name: 'Moment preview' })
  await expect(preview.locator('img[src^="blob:"]')).toBeVisible()
  await expect(preview).toContainText('Saved frame · 00:02:')
  // Removing the bookmark in Preview takes its picture with it. (Undo is a unit
  // test: this fixture's stream id is not numeric, so the worker refuses it.)
  await preview.getByRole('button', { name: /^Remove bookmark: / }).click()
  await expect(preview).toContainText('Bookmark removed.')
  await expect.poll(pictures, { timeout: 10000 }).toBe(0)
  await library.keyboard.press('Escape')
  // Saving the same minute again from the tab that still holds its frame keeps it again.
  await extension.serviceWorker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.twitch.tv/videos/*' }))[0]
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: () => chrome.runtime.sendMessage({
      type: 'SAVE_BOOKMARK', bookmark: { login: 'fixturechan', streamId: 'stream-fixture-prev', vodId: '2806037629', offsetSeconds: 120, label: 'Chat spike', source: 'extension' } }) })
  })
  await expect.poll(pictures, { timeout: 20000, intervals: [1000] }).toBe(1)
  await library.reload()
  await expect(withPicture).toHaveCount(1)
  await withClock.getByRole('button', { name: /^Preview: / }).click()
  await expect(library.getByRole('dialog', { name: 'Moment preview' }).locator('img[src^="blob:"]')).toHaveCount(0)
  await expect(library.getByRole('dialog', { name: 'Moment preview' })).not.toContainText('Saved frame')

  // Off keeps nothing new; the pictures already kept stay until removed.
  await extension.serviceWorker.evaluate(() => chrome.storage.sync.set({ momentPicturesEnabled: false }))
  await library.goto(`chrome-extension://${extension.extensionId}/options/index.html#privacy`)
  const offer = library.locator('[data-kept-pictures]')
  await expect(offer).toContainText('1 saved picture is still kept.')
  await offer.getByRole('button', { name: 'Remove pictures' }).click()
  await expect(offer).toHaveCount(0)
  expect(await pictures()).toBe(0)
})
