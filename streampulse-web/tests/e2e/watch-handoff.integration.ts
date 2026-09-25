import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'
import { installNewsroomMock, newsroomFixture } from './helpers/newsroomMock'
import timing from '../fixtures/portal_vod_timing_v1.json' with { type: 'json' }

const watchOrigin = new URL(process.env.WATCH_HANDOFF_TARGET_ORIGIN!).origin
const streamId = timing.stream.streamId
const vodId = timing.vodId

test.beforeEach(async ({ page, context, baseURL }) => {
  // No Twitch/provider requests, OAuth, real clip writes, or hosted reads.
  // Both actual built applications load from their isolated preview origins.
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ status: 503, json: { error: 'isolated_test_service_unavailable' } })
    if ([new URL(baseURL!).origin, watchOrigin].includes(url.origin)) return route.continue()
    return route.abort()
  })
  await context.addInitScript(() => localStorage.setItem('streamclone-onboarding-v1', '1'))
  await installHubUxMock(page)
  await installNewsroomMock(page)
  await page.route(new RegExp(`/v1/portal/analytics/streams/${streamId}(?:\\?.*)?$`), route => route.fulfill({ json: timing }))
  await page.route(`**/v1/portal/analytics/streams/${streamId}/recap`, route => route.fulfill({ json: {
    login: 'xqc', streamId, topMoments: [{ offsetSeconds: 5183, reasons: ['chat_spike'], topEmotes: [{ code: 'KEKW', count: 45, provider: 'seventv' }] }],
  } }))
})

test('second and third session updates hand off their own aligned archive time', async ({ page }) => {
  await page.route('**/v1/public/newsroom/story-xqc?*', route => {
    const body = newsroomFixture('ready', 'story-xqc')
    body.story!.streamId = streamId
    const first = body.story!.leadUpdate
    first.momentRef.streamId = streamId
    body.updates = [first, ...[360, 540].map((offsetSeconds, index) => ({ ...first,
      id: `selected-${index}`, detectorEventKey: `episode-${index}`, headline: `Selected reaction ${index}`,
      momentRef: { ...first.momentRef, publicMomentId: `moment-${index}`, offsetSeconds },
    }))]
    return route.fulfill({ json: body })
  })
  await page.goto('/analytics/moments?view=sessions&story=story-xqc')
  for (const [index, offset] of [360, 540].entries()) {
    await page.locator('.moments-result').filter({ hasText: `Selected reaction ${index}` }).getByRole('button', { name: 'Open moment' }).click()
    const aligned = Math.floor(offset + timing.vodAlignSeconds)
    await expect(page.getByRole('link', { name: 'Review in Streamclone ↗', exact: true })).toHaveAttribute('href',
      `${watchOrigin}/c/xqc?vod=${vodId}&offset=${aligned}&sid=${streamId}&from=analytics`)
    await page.getByRole('button', { name: 'Back to results' }).click()
  }
})

test('saved selection rechecks source before offering watch handoff; failure remains saveable', async ({ page }) => {
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await page.goto(`/analytics/moments?login=xqc&stream=${streamId}&offset=5183`)
  await expect(detail.getByRole('link', { name: 'Review in Streamclone ↗' })).toBeVisible()
  await detail.getByRole('button', { name: 'Save', exact: true }).click()
  const stored = await page.evaluate(() => localStorage.getItem('streampulse.saved-moments.v2'))
  expect(stored).not.toContain(vodId)
  expect(stored).not.toContain(watchOrigin)
  expect(stored).not.toContain('vodAlignSeconds')
  await page.route(new RegExp(`/v1/portal/analytics/streams/${streamId}(?:\\?.*)?$`), route => route.fulfill({ json: {
    channel: 'xqc', stream: { streamId }, availability: { vodState: 'unavailable' },
  } }))
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
  await page.reload()
  await page.locator('.moments-result').getByRole('button', { name: 'Open moment' }).click()
  await expect(detail.getByText('No replay link confirmed', { exact: true })).toBeVisible()
  await expect(detail.getByRole('link', { name: 'Review in Streamclone ↗' })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Saved', exact: true })).toBeEnabled()
  await page.route(new RegExp(`/v1/portal/analytics/streams/${streamId}(?:\\?.*)?$`), route => route.fulfill({ json: timing }))
  await detail.getByRole('button', { name: 'Recheck source' }).click()
  await expect(detail.getByRole('link', { name: 'Review in Streamclone ↗' })).toHaveAttribute('href',
    `${watchOrigin}/c/xqc?vod=${vodId}&offset=5107&sid=${streamId}&from=analytics`)
  await page.goto(`/analytics/moments?login=xqc&stream=${streamId}&offset=18100`)
  await expect(detail.getByText('This detection is outside the archive', { exact: false })).toBeVisible()
  await expect(detail.getByRole('link', { name: 'Review in Streamclone ↗' })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
})

for (const width of [390, 768, 1440]) test(`actual watch app receives selected source without publishing at ${width}px`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const clipCalls: string[] = []
  const draftId = 'b'.repeat(64)
  await context.route(`${watchOrigin}/v1/auth/clips/**`, route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    clipCalls.push(`${request.method()} ${path}`)
    if (path.endsWith('/capability')) return route.fulfill({ json: { enabled: true, authorizedScope: true } })
    if (path.endsWith('/drafts') && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ vodId, login: 'xqc', streamId, endSeconds: 5122, durationSeconds: 30, title: 'Review this reaction' })
      return route.fulfill({ json: { ...request.postDataJSON(), id: draftId, state: 'review', broadcasterId: '42', createdAt: Math.floor(Date.now() / 1000) } })
    }
    // No test permission to publish. An unexpected call fails the assertions.
    return route.fulfill({ status: 403, json: { error: 'publication_not_authorized_in_handoff_test' } })
  })
  await page.goto(`/analytics/moments?login=xqc&stream=${streamId}&offset=5183`)
  const link = page.getByRole('link', { name: 'Review in Streamclone ↗' })
  await expect(link).toBeVisible()
  const popupPromise = page.waitForEvent('popup')
  await link.click()
  const watch = await popupPromise
  await watch.setViewportSize({ width, height: 900 })
  await expect(watch).toHaveURL(`${watchOrigin}/c/xqc?vod=${vodId}&offset=5107&sid=${streamId}&from=analytics`)
  await expect(watch.getByRole('button', { name: 'Create Twitch clip', exact: true })).toBeVisible()
  expect(clipCalls).toEqual([])
  await watch.getByRole('button', { name: 'Create Twitch clip', exact: true }).click()
  await expect(watch.getByRole('dialog', { name: 'Create a Twitch clip' })).toBeVisible()
  await expect(watch.getByLabel('Clip ends at (seconds)')).toHaveValue('5122')
  await expect(watch.getByRole('link', { name: 'Watch selected range on Twitch ↗' })).toHaveAttribute('href', `https://www.twitch.tv/videos/${vodId}?t=5092s`)
  await expect(watch.getByRole('button', { name: 'Use current playback position' })).toBeDisabled()
  expect(clipCalls).toEqual(['GET /v1/auth/clips/capability'])
  await watch.getByLabel('Clip title').fill('Review this reaction')
  await watch.getByRole('button', { name: 'Check source and review' }).click()
  await expect(watch.getByRole('button', { name: 'Confirm and publish to Twitch' })).toBeVisible()
  expect(clipCalls).toEqual(['GET /v1/auth/clips/capability', 'POST /v1/auth/clips/drafts'])
  expect(await watch.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await watch.screenshot({ path: info.outputPath(`watch-handoff-${width}.png`) })
  await watch.keyboard.press('Escape')
  await expect(watch.getByRole('button', { name: 'Create Twitch clip', exact: true })).toBeFocused()
  await watch.close()
  // The originating selection stays stream-relative; only playback is aligned.
  await expect(page.getByRole('region', { name: 'Selected moment', exact: true })).toContainText('1:26:23 into stream')
  await expect(page).toHaveURL(new RegExp('offset=5183'))
})
