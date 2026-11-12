import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { stubTwitchMedia } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

// Board E: a VOD opened from a Watch link lands with that moment's minute
// locked and its card open, until the viewer unlocks it.
const VOD_ID = '2806037629'
const storage = { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } as const

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/api')
const readFixture = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as Record<string, unknown>

/** How far the panel scrolled itself, and whether the card is inside the panel's visible part. */
async function panelReveal(card: Locator): Promise<{ scrollTop: number; cardInside: boolean }> {
  return card.evaluate(el => {
    const body = el.closest('.pulse-panel-body')!
    const slot = el.closest('.pulse-moment-slot') ?? el
    const [view, box] = [body.getBoundingClientRect(), slot.getBoundingClientRect()]
    return { scrollTop: body.scrollTop, cardInside: box.top >= view.top - 1 && box.bottom <= Math.min(view.bottom, innerHeight) + 1 }
  })
}

/**
 * The VOD of the stream that is live now: the VOD endpoint answers with the
 * live chart (live_dvr) once asked for the live bridge, as production does
 * (vod-live-bridge.mocked.spec.ts).
 */
async function routeLiveReplay(page: Page): Promise<void> {
  const startedAt = new Date(Date.now() - 2 * 3600_000).toISOString()
  const live = { ...readFixture('pulse-live-ready.json'), streamId: '317967537252', startedAt }
  await page.context().route('https://api.streampulse.stream/v1/extension/pulse/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === `/v1/extension/pulse/vods/${VOD_ID}`) {
      await route.fulfill({ status: 200, json: url.searchParams.get('allowLiveBridge') === 'true'
        ? { ...live, mode: 'live_dvr', vodId: VOD_ID, provisional: false, resolutionState: 'live_archive_validated', retryable: false, channelLogin: 'fixturechan' }
        : { ...readFixture('vod-ready.json'), vodId: VOD_ID, streamId: live.streamId, startedAt, durationSeconds: 7200, coverageStatus: 'partial', resolutionState: 'helix_exact' } })
      return
    }
    if (url.pathname === '/v1/extension/pulse/channels/fixturechan') {
      await route.fulfill({ status: 200, json: live })
      return
    }
    await route.fallback()
  })
}

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

const PLACEMENTS = {
  sidebar: storage,
  floating: { overlayPlacement: 'right', overlayMode: 'expanded' },
} as const
const WINDOWS = [{ width: 1024, height: 930 }, { width: 1366, height: 768 }, { width: 1038, height: 1078 }] as const

/**
 * A saved-link (My Moments note) or bare `?t=` link arrival, in `size`, whose
 * picture lands `pictureAfterMs` after the card shows: the card ends up whole
 * in view, its actions too, and the viewer's own scroll back up stays put.
 */
function arrivalFitTest(placement: keyof typeof PLACEMENTS, size: { width: number; height: number }, source: 'library' | 'link', pictureAfterMs: number): void {
  const what = source === 'library' ? 'a saved-link arrival' : 'a timestamped-link arrival'
  test(`${what} shows the whole card, its actions too, picture at ${pictureAfterMs / 1000} s (${placement}, ${size.width}x${size.height})`, async ({ extension, prepare }, info) => {
    test.setTimeout(30000 + pictureAfterMs)
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: PLACEMENTS[placement] })
    if (source === 'library') {
      await extension.serviceWorker.evaluate(vodId => chrome.storage.local.set({
        'sp.momentArrival.v1': { vodId, offsetSeconds: 125, clock: 'stream', source: 'library', login: 'fixturechan', title: 'Chat spike', savedAtMs: Date.now() },
      }), VOD_ID)
    }
    const vod = extension.page
    await vod.setViewportSize(size)
    await vod.goto(`https://www.twitch.tv/videos/${VOD_ID}?t=125s`, { waitUntil: 'domcontentloaded' })
    await stubTwitchMedia(vod, 'vod')
    await waitForPulseRoot(vod)
    const root = vod.locator('#streamclone-pulse-root')
    await expect(root.locator('.pulse-arrival')).toContainText(`${source === 'library' ? 'From My Moments' : 'From link'} · 00:02:05`)
    const card = root.getByLabel(/^Selected (moment|minute) at/)
    await expect(card).toBeVisible()

    // The card's picture mounts later, from the moment-pictures script; this
    // stands in for it, past the time the card takes to open.
    await vod.waitForTimeout(pictureAfterMs)
    await card.locator('[data-moment-picture]').evaluate(stage => {
      const picture = document.createElement('div')
      picture.style.cssText = 'width:100%;aspect-ratio:16/9;background:#2a2a3a'
      stage.append(picture)
    })
    await expect.poll(() => panelReveal(card)).toMatchObject({ cardInside: true })
    await expect(card.getByRole('button', { name: /^Jump/ })).toBeInViewport({ ratio: 1 })
    await vod.screenshot({ path: info.outputPath(`arrival-${source}-${placement}-${size.width}x${size.height}.png`) })

    // Once only: the viewer's own scroll back up stays put.
    await card.evaluate(el => { el.closest('.pulse-panel-body')!.scrollTop = 0 })
    await vod.waitForTimeout(600)
    expect((await panelReveal(card)).scrollTop).toBe(0)
  })
}

for (const placement of Object.keys(PLACEMENTS) as Array<keyof typeof PLACEMENTS>) {
  for (const size of WINDOWS) arrivalFitTest(placement, size, 'library', 1500)
  // Real-Twitch check, 2026-10-19: the picture can land well after the
  // card opens; a bare ?t= link at 1038x1078 lost the card's actions then.
  arrivalFitTest(placement, { width: 1038, height: 1078 }, 'link', 8000)
}

test('a replay of a stream still live locks its minute on the live chart', async ({ extension, prepare }, info) => {
  test.setTimeout(30000)
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage })
  await routeLiveReplay(extension.page)
  await extension.serviceWorker.evaluate(vodId => chrome.storage.local.set({
    'sp.momentArrival.v1': { vodId, offsetSeconds: 1230, clock: 'stream', source: 'library', login: 'fixturechan', title: 'Chat spike', savedAtMs: Date.now() },
  }), VOD_ID)
  const vod = extension.page
  await vod.setViewportSize({ width: 1440, height: 900 })
  await vod.goto(`https://www.twitch.tv/videos/${VOD_ID}?t=20m30s`, { waitUntil: 'domcontentloaded' })
  await stubTwitchMedia(vod, 'vod')
  await waitForPulseRoot(vod)
  const root = vod.locator('#streamclone-pulse-root')

  const chip = root.locator('.pulse-arrival')
  await expect(chip).toContainText('From My Moments · 00:20:30')
  const card = root.locator('[data-chart-inspector-owner="activity-chart"]').getByLabel(/^Selected minute at/)
  await expect(card).toBeVisible()
  await expect.poll(() => panelReveal(card)).toMatchObject({ cardInside: true })
  await vod.screenshot({ path: info.outputPath('live-replay-arrival.png') })

  await chip.getByRole('button', { name: 'Unlock this moment' }).click()
  await expect(chip).toHaveCount(0)
  await expect(card).toHaveCount(0)
})
