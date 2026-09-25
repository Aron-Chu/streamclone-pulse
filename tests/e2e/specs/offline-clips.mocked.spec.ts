import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { readFileSync } from 'node:fs'

for (const surface of ['offline', 'vod'] as const) {
test(`${surface} recap shows clips from its stream and can scroll`, async ({ extension, prepare }, testInfo) => {
  await prepare({ scenario: surface === 'vod' ? 'vod-ready' : 'offline', twitchKind: surface, storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  await extension.context.route('https://api.streampulse.stream/v1/channels/*/clips?*', async route => {
    const params = new URL(route.request().url()).searchParams
    expect(params.get('startedAt')).toBe('2026-07-10T12:00:00.000Z')
    expect(params.get('endedAt')).toBe(surface === 'vod' ? '2026-07-10T13:00:00.000Z' : '2026-07-10T16:00:00.000Z')
    await route.fulfill({ json: { items: [1, 2, 3].map(i => ({ id: `clip-${i}`, title: `Last stream clip ${i}`, url: `https://clips.twitch.tv/Fixture${i}`, videoId: '2806037629', vodOffsetSeconds: surface === 'vod' ? 65 : 1805, viewCount: i * 20, createdAt: '2026-07-10T12:30:00Z' })) } })
  })
  if (surface === 'vod') await openTwitchVod(extension.page)
  else await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const carousel = root.getByLabel('Stream clips carousel', { exact: true })
  await expect(carousel.getByRole('link')).toHaveCount(3)
  await expect(carousel.getByRole('link').first()).toContainText('Last stream clip 3')
  await expect(carousel).toHaveCSS('scrollbar-width', 'none')
  const card = carousel.getByRole('link').first()
  expect(await card.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(232)
  expect(await card.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(205)
  await expect(card).toHaveCSS('border-top-width', '0px')
  await carousel.hover()
  await extension.page.mouse.wheel(0, 80)
  await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await expect(root.getByRole('button', { name: 'Previous clips', exact: true })).toBeEnabled()
  await extension.context.route('https://clips.twitch.tv/**', route => route.fulfill({ body: 'Clip fixture' }))
  const popupPromise = extension.page.waitForEvent('popup')
  await carousel.getByRole('link').nth(1).click()
  const popup = await popupPromise
  await popup.close()
  await expect(root.locator('[data-chart-active-offset]').first()).toHaveAttribute('data-chart-active-offset', surface === 'vod' ? '60' : '1800')
  const section = root.getByRole('region', { name: 'Top clips from this stream' })
  await section.scrollIntoViewIfNeeded()
  await section.screenshot({ path: testInfo.outputPath('offline-clips.png') })
  await extension.page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(root.getByRole('button', { name: 'Next clips', exact: true })).toHaveCSS('transition-duration', '0s')
  await expect(card).toHaveCSS('transition-duration', '0s')
  for (const width of [1280, 720]) {
    await extension.page.setViewportSize({ width, height: 900 })
    await expect.poll(() => section.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  }
})
}

test('live clip resolves its exact archive when the live payload has no VOD id', async ({ extension, prepare }) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  await extension.context.route('**/v1/channels/*/streams/history?*', route => route.fulfill({ json: { items: [
    { id: 'stream-fixture-1', videoId: '2806037629', startedAt: '2026-07-11T18:00:00.000Z', endedAt: '2026-07-11T19:00:00.000Z', title: 'Exact stream' },
  ] } }))
  await extension.context.route('**/v1/channels/*/clips?*', route => route.fulfill({ json: { items: [
    { id: 'live-clip', title: 'Live archive clip', url: 'https://clips.twitch.tv/FixtureLive', videoId: '2806037629', vodOffsetSeconds: 305, viewCount: 20, createdAt: '2026-07-11T18:06:00.000Z' },
  ] } }))
  await extension.context.route('https://clips.twitch.tv/**', route => route.fulfill({ body: 'Clip fixture' }))
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  const popupPromise = extension.page.waitForEvent('popup')
  await root.getByRole('link', { name: 'Clip spike: Live archive clip' }).click()
  await (await popupPromise).close()
  await expect(root.locator('[data-chart-active-offset]').first()).toHaveAttribute('data-chart-active-offset', '300')
})

test('VOD buckets beside a spike remain independently selectable', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/api/vod-ready.json', import.meta.url), 'utf8'))
  fixture.timeline.points.push({ offsetSeconds: 180, chatPerMin: 326, emotesPerMin: 331, viewers: 900, score: 20 })
  await extension.context.route('**/v1/extension/pulse/vods/*', route => route.fulfill({ json: fixture }))
  await openTwitchVod(extension.page)
  await waitForPulseRoot(extension.page)
  const root = extension.page.locator('#streamclone-pulse-root')
  await root.getByRole('button', { name: 'Show spike markers', exact: true }).click()
  const plot = root.locator('[data-chart-scrubber="true"]')
  await plot.focus()
  await plot.press('End')
  await plot.press('ArrowLeft')
  await plot.press('Enter')
  await expect(root.locator('[data-chart-active-offset]').first()).toHaveAttribute('data-chart-active-offset', '180')
  await expect(root.locator('[data-moment-save-state="ready"]')).toHaveAttribute('aria-label', 'Save moment at 00:03:00')
  await plot.press('ArrowLeft')
  await plot.press('Enter')
  await expect(root.locator('[data-chart-active-offset]').first()).toHaveAttribute('data-chart-active-offset', '120')
  const bounds = await plot.boundingBox()
  if (!bounds) throw new Error('Missing chart plot')
  await plot.click({ position: { x: bounds.width * 0.75, y: bounds.height * 0.8 } })
  await extension.page.mouse.move(0, 0)
  await expect(root.locator('[data-chart-active-offset]').first()).toHaveAttribute('data-chart-active-offset', '180')
})
