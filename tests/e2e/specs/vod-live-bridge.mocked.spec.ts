import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, Request, Route } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchVod } from '../helpers/mockTwitch.ts'
import { assertNoUncaughtErrors, pulseShadowText, waitForPulseRoot } from '../helpers/assertions.ts'

/**
 * A-2 (release review 2026-10-09): past VODs of a channel that is live now.
 *
 * The routes model production as probed on 2026-10-09
 * (design-extension/vod-bridge-probe.txt): asked with allowLiveBridge=true, the
 * VOD endpoint answers any VOD of a live channel with the live DVR of today's
 * stream (wrong game, a 50-hour range) or a 409, while the plain request
 * answers each VOD with its own stream.
 */

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/api')
const readFixture = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as Record<string, unknown>

const LIVE_STREAM = '317967537252'
const LIVE_NOW_VOD = '2896011569'
const PAST_VOD = '2894307326'
const PAST_STREAM = '317950783460'
const ORDINARY_VOD = '2894428685'
const CONFLICT_VOD = '2896173997'

const HOUR = 3600
const liveStartedAt = new Date(Date.now() - 2 * HOUR * 1000).toISOString()

function livePulse(): Record<string, unknown> {
  return { ...readFixture('pulse-live-ready.json'), streamId: LIVE_STREAM, startedAt: liveStartedAt }
}

/** What production's bridge returned for the Oct 7 VOD: today's live stream. */
function wrongStreamLiveDvr(): Record<string, unknown> {
  return {
    ...livePulse(),
    mode: 'live_dvr',
    vodId: null,
    provisional: true,
    resolutionState: 'live_stream_validated',
    retryable: true,
    channelLogin: 'fixturechan',
    games: [{ gameName: 'Marvel Rivals', offsetSeconds: 0, durationSeconds: 50 * HOUR + 32 * 60 }],
  }
}

function plainVod(vodId: string): { status: number; body: Record<string, unknown> } {
  const ready = readFixture('vod-ready.json')
  switch (vodId) {
    case PAST_VOD:
      return {
        status: 200,
        body: {
          ...ready,
          vodId,
          streamId: PAST_STREAM,
          title: 'Oct 7 stream',
          startedAt: new Date(Date.now() - 50 * HOUR * 1000).toISOString(),
          durationSeconds: 8 * HOUR + 25 * 60,
          coverageStatus: 'partial',
          resolutionState: 'helix_exact',
          games: [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 8 * HOUR + 25 * 60 }],
        },
      }
    case LIVE_NOW_VOD:
      return {
        status: 200,
        body: {
          ...ready,
          vodId,
          streamId: LIVE_STREAM,
          startedAt: liveStartedAt,
          durationSeconds: 2 * HOUR,
          coverageStatus: 'partial',
          resolutionState: 'helix_exact',
        },
      }
    case ORDINARY_VOD:
      return { status: 200, body: { ...ready, vodId, streamId: '319491763415', channelLogin: 'quietchan', channelDisplayName: 'quietchan', resolutionState: 'helix_exact' } }
    case CONFLICT_VOD:
    default:
      return {
        status: 409,
        body: {
          error: 'vod_broadcaster_mismatch',
          mode: 'vod',
          resolutionState: 'live_archive_conflict',
          retryable: false,
          channelLogin: 'fixturechan',
          channelDisplayName: 'fixturechan',
        },
      }
  }
}

interface BridgeModel {
  vodRequests: () => URL[]
}

async function installProductionVodModel(page: Page, options: { channelLive: boolean }): Promise<BridgeModel> {
  const requests: Request[] = []
  const handler = async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const vod = /^\/v1\/extension\/pulse\/vods\/(\d+)$/.exec(url.pathname)
    if (vod) {
      requests.push(request)
      const vodId = vod[1]!
      if (url.searchParams.get('allowLiveBridge') === 'true') {
        if (vodId === CONFLICT_VOD) {
          await route.fulfill({ status: 409, json: { error: 'vod_broadcaster_mismatch', mode: 'vod', resolutionState: 'live_archive_conflict', retryable: false } })
          return
        }
        const body = vodId === LIVE_NOW_VOD
          ? { ...wrongStreamLiveDvr(), vodId, resolutionState: 'live_archive_validated', games: livePulse().games }
          : wrongStreamLiveDvr()
        await route.fulfill({ status: 200, json: body })
        return
      }
      const plain = plainVod(vodId)
      await route.fulfill({ status: plain.status, json: plain.body })
      return
    }
    if (/^\/v1\/extension\/pulse\/channels\/fixturechan$/.test(url.pathname)) {
      await route.fulfill({ status: 200, json: options.channelLive ? livePulse() : readFixture('pulse-offline.json') })
      return
    }
    await route.fallback()
  }
  await page.context().route('https://api.streampulse.stream/v1/extension/pulse/**', handler)
  return { vodRequests: () => requests.map(request => new URL(request.url())) }
}

async function headerStatus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.getElementById('streamclone-pulse-root')?.shadowRoot
    return root?.querySelector('header.pulse-personal-banner span[aria-label]')?.textContent?.trim() ?? ''
  })
}

async function capturePanel(page: Page, file: string): Promise<void> {
  const box = await page.locator('#streamclone-pulse-root').boundingBox()
  if (!box) throw new Error('Pulse panel has no box')
  await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 760) } })
}

async function captureDarkAndLight(page: Page, file: (theme: string) => string): Promise<void> {
  await capturePanel(page, file('dark'))
  await page.evaluate(() => {
    document.documentElement.classList.replace('tw-root--theme-dark', 'tw-root--theme-light')
    if (!document.documentElement.classList.contains('tw-root--theme-light')) document.documentElement.classList.add('tw-root--theme-light')
    const style = document.createElement('style')
    style.textContent = 'html, body, body * { background-color: #ffffff !important; }'
    document.head.append(style)
  })
  await expect(page.locator('#streamclone-pulse-root')).toHaveAttribute('data-twitch-theme', 'light')
  await page.waitForTimeout(400)
  await capturePanel(page, file('light'))
}

test.describe('VOD replay: the live bridge only for the stream that is live now', () => {
  test('a past VOD of a live channel shows its own stream as a replay', async ({ extension, prepare, evidence }, info) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    const model = await installProductionVodModel(extension.page, { channelLive: true })
    await extension.page.setViewportSize({ width: 1440, height: 900 })
    await openTwitchVod(extension.page, PAST_VOD)
    await waitForPulseRoot(extension.page)

    await expect.poll(() => headerStatus(extension.page)).toBe('Replay')
    await expect.poll(() => pulseShadowText(extension.page)).toContain('Just Chatting')
    const text = await pulseShadowText(extension.page)
    expect(text).not.toMatch(/Marvel Rivals|Live now|Live chart|50h/i)
    expect(model.vodRequests().length).toBeGreaterThan(0)
    for (const url of model.vodRequests()) expect(url.searchParams.get('allowLiveBridge')).toBeNull()

    await captureDarkAndLight(extension.page, theme => info.outputPath(`past-vod-of-live-channel-${theme}.png`))
    assertNoUncaughtErrors(evidence)
  })

  test('the VOD of the stream that is live now keeps the live chart', async ({ extension, prepare, evidence }, info) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    const model = await installProductionVodModel(extension.page, { channelLive: true })
    await extension.page.setViewportSize({ width: 1440, height: 900 })
    await openTwitchVod(extension.page, LIVE_NOW_VOD)
    await waitForPulseRoot(extension.page)

    await expect.poll(() => model.vodRequests().some(url => url.searchParams.get('allowLiveBridge') === 'true')).toBe(true)
    const [first, bridged] = model.vodRequests()
    expect(first?.searchParams.get('allowLiveBridge')).toBeNull()
    expect(bridged?.searchParams.get('allowLiveBridge')).toBe('true')
    expect(bridged?.searchParams.get('streamId')).toBe(LIVE_STREAM)
    await expect.poll(() => headerStatus(extension.page)).not.toBe('Replay')
    await expect.poll(() => headerStatus(extension.page)).not.toBe('')

    await captureDarkAndLight(extension.page, theme => info.outputPath(`live-now-vod-${theme}.png`))
    assertNoUncaughtErrors(evidence)
  })

  test('an ordinary past VOD of an offline channel is a plain replay', async ({ extension, prepare, evidence }, info) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    const model = await installProductionVodModel(extension.page, { channelLive: false })
    await extension.page.setViewportSize({ width: 1440, height: 900 })
    await openTwitchVod(extension.page, ORDINARY_VOD)
    await waitForPulseRoot(extension.page)

    await expect.poll(() => headerStatus(extension.page)).toBe('Replay')
    await expect.poll(() => pulseShadowText(extension.page)).toMatch(/Chat spike|Just Chatting/)
    for (const url of model.vodRequests()) expect(url.searchParams.get('allowLiveBridge')).toBeNull()

    await captureDarkAndLight(extension.page, theme => info.outputPath(`ordinary-past-vod-${theme}.png`))
    assertNoUncaughtErrors(evidence)
  })

  test('a VOD that cannot be matched explains why and offers Retry and Open in Analytics', async ({ extension, prepare, evidence }, info) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    const model = await installProductionVodModel(extension.page, { channelLive: true })
    await extension.page.setViewportSize({ width: 1440, height: 900 })
    await openTwitchVod(extension.page, CONFLICT_VOD)
    await waitForPulseRoot(extension.page)

    await expect.poll(() => pulseShadowText(extension.page)).toContain('We couldn’t match this VOD to a recorded stream')
    expect(await headerStatus(extension.page)).toBe('Replay')
    const card = extension.page.locator('#streamclone-pulse-root .pulse-vod-state')
    await expect(card.getByRole('link', { name: 'Open in Analytics ↗' })).toHaveAttribute('href', 'https://streampulse.stream/analytics/fixturechan')
    const before = model.vodRequests().length
    await card.getByRole('button', { name: '↻ Retry' }).click()
    await expect.poll(() => model.vodRequests().length).toBeGreaterThan(before)
    for (const url of model.vodRequests()) expect(url.searchParams.get('allowLiveBridge')).toBeNull()

    await captureDarkAndLight(extension.page, theme => info.outputPath(`couldnt-match-${theme}.png`))
    assertNoUncaughtErrors(evidence)
  })
})
