import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/api')
const AVATAR_URL = 'https://static-cdn.jtvnw.net/jtv_user_pictures/fixturechan-profile_image-70x70.png'
const EMOTE_URL = 'https://cdn.7tv.app/emote/01FIXTUREKEKW/1x.webp'

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 70"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#9147ff"/></linearGradient></defs><rect width="70" height="70" fill="url(#g)"/><circle cx="35" cy="28" r="12" fill="#fff" opacity=".9"/><path d="M14 64c3-14 12-20 21-20s18 6 21 20z" fill="#fff" opacity=".9"/></svg>`
const EMOTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13" fill="#ffcc4d"/><path d="M7 11l4 2M21 11l-4 2" stroke="#664500" stroke-width="2" stroke-linecap="round"/><path d="M7 16c2 6 12 6 14 0z" fill="#664500"/><path d="M5 9c1-2 3-2 4-1M23 9c-1-2-3-2-4-1" stroke="#5dadec" stroke-width="2" stroke-linecap="round"/></svg>`

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as Record<string, unknown>
}

/** A live payload with half an hour of minutes, a clear spike and a 7TV top emote. */
function richLivePayload(): Record<string, unknown> {
  const base = readFixture('pulse-live-ready.json')
  const current = 3 * 3600
  const rollups = Array.from({ length: 30 }, (_, index) => {
    const minute = current / 60 - 29 + index
    const wave = 620 + Math.round(180 * Math.sin(index / 3.1) + 90 * Math.sin(index / 1.3))
    const spike = index === 19 ? 1_480 : index === 20 ? 1_120 : 0
    return {
      offsetSeconds: minute * 60,
      chatCount: Math.max(wave, spike) + (index === 29 ? 520 : 0),
      sevenTvEmoteCount: 40,
      totalEmoteCount: 90,
      viewerCount: 41_200 + index * 30,
      viewerSamples: 1,
      topEmotes: [],
    }
  })
  return {
    ...base,
    startedAt: new Date(Date.now() - current * 1000).toISOString(),
    currentOffsetSeconds: current,
    rollups,
    fullRollups: rollups,
    topEmotes: [{ name: 'KEKW', count: 312, imageUrl: EMOTE_URL, provider: '7tv' }],
    peaks: [{ offsetSeconds: current - 10 * 60, seekOffsetSeconds: current - 10 * 60 - 20, score: 92, reasons: ['chat'], reasonLabel: 'Chat spike', dominantSignal: 'chat' }],
  }
}

async function routeMedia(page: Page): Promise<void> {
  await page.context().route('https://static-cdn.jtvnw.net/jtv_user_pictures/**', route => route.fulfill({ contentType: 'image/svg+xml', body: AVATAR_SVG }))
  await page.context().route('https://static-cdn.jtvnw.net/emoticons/**', route => route.fulfill({ contentType: 'image/svg+xml', body: EMOTE_SVG }))
  await page.context().route('https://cdn.7tv.app/emote/**', route => route.fulfill({ contentType: 'image/svg+xml', body: EMOTE_SVG }))
}

/**
 * Opened as a tab, the popup's own page is the active tab. Point its tab query
 * at a Twitch tab instead, and answer the avatar read the way Twitch would.
 */
async function pretendActiveTab(page: Page, tab: { id: number; url: string }): Promise<void> {
  await page.addInitScript(({ tab, avatar }) => {
    chrome.tabs.query = (async () => [{ ...tab, active: true }]) as unknown as typeof chrome.tabs.query
    chrome.scripting.executeScript = (async () => [{ result: avatar }]) as unknown as typeof chrome.scripting.executeScript
  }, { tab, avatar: AVATAR_URL })
}

/** One route for the channel pulse whose answer each test step can swap. */
async function routePulse(page: Page, coverage?: Record<string, unknown>): Promise<(body: Record<string, unknown> | null) => void> {
  let current: Record<string, unknown> | null = null
  await page.context().route(/\/v1\/extension\/pulse\/channels\/[^/?]+(\?.*)?$/, route => current
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) })
    : route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fixture"}' }))
  if (coverage) {
    await page.context().route(/\/v1\/extension\/pulse\/channels\/[^/]+\/coverage(\?.*)?$/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(coverage) }))
  }
  return body => { current = body }
}

/** The public hub the popup reads away from a stream; null answers 503. */
async function routeHub(page: Page, body: Record<string, unknown> | null): Promise<void> {
  await page.context().route(/\/v1\/public\/hub(\?.*)?$/, route => body
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    : route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture"}' }))
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)))
}

test.describe('toolbar popup', () => {
  test('away from Twitch it shows the busiest chats on Pulse and opens one with Pulse ready', async ({ extension, prepare }, info) => {
    await prepare()
    const page = extension.page
    await page.setViewportSize({ width: 320, height: 600 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await routeMedia(page)
    await routeHub(page, readFixture('hub-popup.json'))
    await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)

    const live = page.locator('section.pp-live')
    await expect(live.getByRole('heading', { name: 'Live on Pulse now' })).toBeVisible()
    await expect(live.locator('.pp-live-count')).toHaveText('998 live')
    await expect(live.locator('.pp-live-stats')).toHaveText('882.8K watching · 6,141 emotes/min')
    // Busiest chat first; a stats-only channel has no chat rate and never shows.
    const rows = live.locator('[data-popup-action="open-stream"]')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toHaveAccessibleName('Watch NovaRunner with Pulse. 2,596 watching, 466 chat messages a minute.')
    await expect(rows.nth(1)).toContainText('PixelPilot')
    await expect(rows.nth(2)).toContainText('MapleMoth')
    await expect(live.locator('.pp-sr')).toContainText('LOL, 4,937 uses')
    await expect(live.locator('.pp-ticker-track')).toHaveCSS('animation-name', 'pp-slide')
    await expect(live.locator('.pp-tick-emote').first()).toHaveAttribute('src', 'https://cdn.7tv.app/emote/01FZ975PV8000B4AWRZNMVNEXN/2x.webp')
    // The rows open Twitch, so the list needs no separate Open Twitch button.
    await expect(page.getByRole('button', { name: 'Open Twitch', exact: true })).toHaveCount(0)
    await expect(page.locator('.pp-hero-art')).toHaveCount(0)
    // Small enough to sit well inside Chrome's 800 x 600 popup limit.
    expect(await page.evaluate(() => document.querySelector('main')!.getBoundingClientRect().height)).toBeLessThan(440)
    await expect(page.getByRole('button', { name: 'My Moments', exact: true })).toHaveAccessibleDescription('Saves & history')
    const hub = page.getByRole('button', { name: 'Open analytics hub', exact: true })
    await expect(hub).toHaveAccessibleDescription(/Stream history/)
    await expect(page.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Connected')
    await expect(page.locator('.pp-version')).toHaveText(/^v\d+\.\d+\.\d+/)
    await expect.poll(() => page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))).toBe(true)

    await expect(page.locator('.pp-card').first()).toHaveCSS('animation-name', 'pp-rise')
    await settle(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await hub.focus()
    await expect(hub).toHaveCSS('outline-style', 'solid')
    await hub.blur()
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      // Colour transitions finish before the capture.
      await settle(page)
      await page.screenshot({ path: info.outputPath(`popup-elsewhere-${scheme}.png`) })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.pp-card').first()).toHaveCSS('animation-name', 'none')
    await expect(live.locator('.pp-ticker-track')).toHaveCSS('animation-name', 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' })

    // A row opens that stream with the Pulse panel showing.
    await extension.serviceWorker.evaluate(() => chrome.storage.sync.set({ sidebarTab: 'chat', overlayMode: 'mini' }))
    const opened = extension.context.waitForEvent('page')
    await rows.nth(0).click()
    expect((await opened).url()).toBe('https://www.twitch.tv/novarunner')
    await expect.poll(() => extension.serviceWorker.evaluate(() => chrome.storage.sync.get(['sidebarTab', 'overlayMode'])))
      .toEqual({ sidebarTab: 'pulse', overlayMode: 'expanded' })
  })

  test('without the hub it falls back to plain copy, never art or invented data', async ({ extension, prepare }, info) => {
    await prepare()
    const page = extension.page
    await page.setViewportSize({ width: 320, height: 600 })
    await routeHub(page, null)
    await extension.serviceWorker.evaluate(() => chrome.storage.session.clear())
    await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)
    await expect(page.getByRole('heading', { name: 'Pulse lives beside Twitch chat' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Twitch', exact: true })).toBeVisible()
    await expect(page.locator('.pp-live, .pp-hero-art')).toHaveCount(0)
    await settle(page)
    await page.screenshot({ path: info.outputPath('popup-hub-down.png') })
  })

  test('jump back in offers this device\'s saves above the live list', async ({ extension, prepare }, info) => {
    await prepare()
    const page = extension.page
    await page.setViewportSize({ width: 320, height: 700 })
    await routeMedia(page)
    await routeHub(page, readFixture('hub-popup.json'))
    await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)
    await expect(page.locator('section.pp-live')).toBeVisible()
    await expect(page.getByText('Jump back in')).toHaveCount(0)
    // Save a moment without an account, the way the panel's Bookmark does.
    await page.evaluate(async () => {
      const loaded = await chrome.runtime.sendMessage({ type: 'MY_MOMENTS', action: 'load' })
      await chrome.runtime.sendMessage({ type: 'MY_MOMENTS', action: 'mutate', scope: loaded.snapshot.scope, command: { kind: 'save', reference: { id: 'fixture', channel: 'fixturechan', title: 'Chat spike', vodId: '2806037629', offsetSeconds: 3600, availability: 'available' } } })
    })
    await page.reload()
    const jump = page.locator('section.pp-card').filter({ hasText: 'Jump back in' })
    await expect(jump.getByRole('button', { name: /1 save on this device/ })).toContainText('Latest: fixturechan · Chat spike')
    await expect(page.locator('section.pp-card').first()).toContainText('Jump back in')
    await expect(page.locator('section.pp-live')).toBeVisible()
    await settle(page)
    await page.screenshot({ path: info.outputPath('popup-jump-back-in.png') })
    const opened = extension.context.waitForEvent('page')
    await jump.getByRole('button', { name: /1 save on this device/ }).click()
    expect((await opened).url()).toBe(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  })

  test('on a live channel it shows that stream: avatar, live chat, viewers, top emote and the biggest moment', async ({ extension, prepare }, info) => {
    await prepare()
    const page = extension.page
    await page.setViewportSize({ width: 320, height: 600 })
    await routeMedia(page)
    const setPulse = await routePulse(page, { ...readFixture('coverage-active.json'), displayName: 'FixtureChan' })
    setPulse(richLivePayload())
    await pretendActiveTab(page, { id: 4242, url: 'https://www.twitch.tv/FixtureChan' })
    await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)

    const card = page.locator('section.pp-card')
    await expect(card.getByRole('heading', { name: 'FixtureChan' })).toBeVisible()
    await expect(card.locator('.pp-badge')).toHaveText('Live')
    await expect(card.locator('.pp-meta')).toHaveText(/^Just Chatting · 3h 0m$/)
    await expect(card.locator('img.pp-avatar')).toHaveAttribute('src', AVATAR_URL)
    await expect(card.locator('.pp-rate')).toHaveText(/msgs\/min/)
    await expect(card.getByRole('img', { name: /Chat activity · last 30 min\. Latest minute: [\d,]+ messages\./ })).toBeVisible()
    await expect(card.locator('.pp-spark-line')).toHaveAttribute('d', /^M[\d. L]+$/)
    await expect(card.locator('.pp-stat').first()).toContainText('Watching now')
    await expect(card.locator('.pp-stat').first()).toContainText('42.1K')
    await expect(card.locator('.pp-stat').nth(1)).toContainText('KEKW×312')
    await expect(card.locator('img.pp-emote')).toHaveAttribute('src', EMOTE_URL)
    await expect(card.locator('.pp-moment')).toContainText('Biggest moment · Chat spike')
    await expect(card.locator('.pp-moment time')).toHaveText('10m ago')
    await expect(card.getByRole('button', { name: 'Open Pulse panel' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))).toBe(true)

    await settle(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      // Colour transitions finish before the capture.
      await settle(page)
      await page.screenshot({ path: info.outputPath(`popup-live-${scheme}.png`) })
    }
  })

  test('opening the Pulse panel targets the Twitch tab and stores the expanded Pulse view', async ({ extension, prepare }) => {
    await prepare()
    const twitch = await extension.context.newPage()
    await twitch.goto('https://www.twitch.tv/fixturechan', { waitUntil: 'domcontentloaded' })
    const tabId = await extension.serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.twitch.tv/fixturechan' })
      return tab?.id ?? -1
    })
    expect(tabId).toBeGreaterThan(0)
    await extension.serviceWorker.evaluate(() => chrome.storage.sync.set({ sidebarTab: 'chat', overlayMode: 'mini' }))

    const page = await extension.context.newPage()
    await pretendActiveTab(page, { id: tabId, url: 'https://www.twitch.tv/fixturechan' })
    await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)
    await page.getByRole('button', { name: 'Open Pulse panel' }).click()
    await expect.poll(() => extension.serviceWorker.evaluate(() => chrome.storage.sync.get(['sidebarTab', 'overlayMode'])))
      .toEqual({ sidebarTab: 'pulse', overlayMode: 'expanded' })
  })

  test('says plainly when a channel is offline, uncharted or unreachable', async ({ extension, prepare }, info) => {
    await prepare()
    const page = extension.page
    await page.setViewportSize({ width: 320, height: 600 })
    await routeMedia(page)
    await pretendActiveTab(page, { id: 4242, url: 'https://www.twitch.tv/fixturechan' })

    const setPulse = await routePulse(page)
    setPulse({ ...readFixture('pulse-offline.json'), endedAt: new Date(Date.now() - 26 * 3_600_000).toISOString() })
    await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)
    await expect(page.locator('.pp-badge')).toHaveText('Offline')
    await expect(page.locator('.pp-meta')).toContainText('Last live yesterday')
    await settle(page)
    await page.screenshot({ path: info.outputPath('popup-offline.png') })

    setPulse({ ...richLivePayload(), rosterEligible: false })
    await extension.serviceWorker.evaluate(() => chrome.storage.session.clear())
    await page.reload()
    await expect(page.getByText('Pulse isn’t charting this channel yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Pulse panel' })).toBeVisible()

    setPulse(null)
    await extension.serviceWorker.evaluate(() => chrome.storage.session.clear())
    await page.reload()
    await expect(page.getByText('Couldn’t load chat activity')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await settle(page)
    await page.screenshot({ path: info.outputPath('popup-error.png') })
  })

  test('on a Twitch product page it offers live streams to pick instead of a dead button', async ({ extension, prepare }) => {
    await prepare()
    const page = extension.page
    await routeMedia(page)
    await routeHub(page, readFixture('hub-popup.json'))
    await pretendActiveTab(page, { id: 4242, url: 'https://www.twitch.tv/directory/following' })
    await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)
    await expect(page.getByRole('heading', { name: 'Pick a stream' })).toBeVisible()
    await expect(page.locator('[data-popup-action="open-stream"]')).toHaveCount(3)
    // Already on Twitch: no "Open Twitch" and no Pulse-panel button.
    await expect(page.locator('[data-popup-action="open-pulse"]')).toHaveCount(0)
  })

  test('on a replay it offers the Pulse panel for that VOD', async ({ extension, prepare }) => {
    await prepare()
    const page = extension.page
    await pretendActiveTab(page, { id: 4242, url: 'https://www.twitch.tv/videos/2806037629' })
    await page.goto(`chrome-extension://${extension.extensionId}/popup/index.html`)
    await expect(page.getByRole('heading', { name: 'Watching a replay' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Pulse panel' })).toBeVisible()
  })
})
