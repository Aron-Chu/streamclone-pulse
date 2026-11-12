import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import fs from 'node:fs'

test('three new device bookmarks offer a neutral review request once; keyboard dismissal survives reload', async ({ extension, prepare }, testInfo) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  // Three separated ranked moments exercise actual new saves instead of
  // toggling the same chart-minute bookmark twice.
  const vod = JSON.parse(fs.readFileSync(new URL('../fixtures/api/vod-ready.json', import.meta.url), 'utf8'))
  vod.topMoments = [120, 600, 1200].map((offsetSeconds, index) => ({ offsetSeconds, label: 'Chat spike', reason: 'chat_spike', score: 80 - index * 10, chatPerMin: 90, emotesPerMin: 30 }))
  vod.timeline.points.push(...[600, 1200].map(offsetSeconds => ({ offsetSeconds, chatPerMin: 90, emotesPerMin: 30, viewers: 850, score: 70 })))
  await extension.context.route('https://api.streampulse.stream/v1/extension/pulse/vods/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(vod) }))
  const page = extension.page
  await openTwitchVod(page)
  await waitForPulseRoot(page)
  const root = page.locator('#streamclone-pulse-root')
  const invitation = root.getByRole('region', { name: 'Review StreamPulse' })
  await expect(invitation).toHaveCount(0)

  const rows = root.locator('.pulse-moment-row-button')
  await expect(rows).toHaveCount(3)
  for (let index = 0; index < 3; index += 1) {
    await rows.nth(index).click()
    await expect(rows.nth(index)).toHaveAttribute('aria-pressed', 'true')
    const bookmark = root.locator('[data-moment-action="bookmark"]')
    await expect(bookmark).toHaveAttribute('data-moment-save-state', 'ready')
    await bookmark.click()
    await expect(bookmark).toHaveAttribute('data-moment-save-state', 'saved')
  }

  await expect(invitation).toBeVisible()
  await expect(invitation).toContainText('Your review helps other Twitch viewers discover StreamPulse.')
  await expect(invitation.getByRole('link', { name: 'Write a review' })).toHaveAttribute('href',
    'https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg/reviews')
  expect(await extension.serviceWorker.evaluate(async () => (await chrome.storage.local.get('pulseReviewRequest.v1'))['pulseReviewRequest.v1']))
    .toEqual({ bookmarks: 3, offered: true })
  await invitation.scrollIntoViewIfNeeded()
  await expect(invitation).toBeInViewport()
  await root.screenshot({ path: testInfo.outputPath('review-request.png') })
  await invitation.screenshot({ path: testInfo.outputPath('review-request-card.png') })

  await invitation.getByRole('button', { name: 'Dismiss' }).focus()
  await page.keyboard.press('Enter')
  await expect(invitation).toHaveCount(0)
  await page.reload()
  await waitForPulseRoot(page)
  await expect(invitation).toHaveCount(0)
  expect(await extension.serviceWorker.evaluate(async () => (await chrome.storage.local.get('pulseReviewRequest.v1'))['pulseReviewRequest.v1']))
    .toEqual({ bookmarks: 3, offered: true })
})

test('Write a review opens the fixed store destination in a new tab and consumes the offer', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  await extension.serviceWorker.evaluate(() => chrome.storage.local.set({ 'pulseReviewRequest.v1': { bookmarks: 2, offered: false } }))
  const destination = 'https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg/reviews'
  // Capture native navigation while keeping the mocked suite off public stores.
  // CWS pages have privileged browser behavior, so abort rather than fake HTML.
  await extension.context.route('https://chromewebstore.google.com/**', route => route.abort())
  const page = extension.page
  await openTwitchVod(page)
  await waitForPulseRoot(page)
  const root = page.locator('#streamclone-pulse-root')
  await root.getByRole('application', { name: /^Chart plot/ }).focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await root.locator('[data-moment-action="bookmark"]').click()
  const invitation = root.getByRole('region', { name: 'Review StreamPulse' })
  const [reviewPage, request] = await Promise.all([
    extension.context.waitForEvent('page'),
    extension.context.waitForEvent('request', request => request.url() === destination && request.isNavigationRequest()),
    invitation.getByRole('link', { name: 'Write a review' }).click(),
  ])
  expect(reviewPage).not.toBe(page)
  expect(request.url()).toBe(destination)
  await expect(invitation).toBeVisible()
  await reviewPage.close()
  await page.reload()
  await waitForPulseRoot(page)
  await expect(invitation).toHaveCount(0)
})
