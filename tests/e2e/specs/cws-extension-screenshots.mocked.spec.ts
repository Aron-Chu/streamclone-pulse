/**
 * Chrome Web Store screenshots of the *actual* MV3 extension embedded on
 * twitch.tv (content script + Pulse panel), not the marketing landing tour.
 *
 * Uses the same extension Playwright harness as the PR-gate mocked suite
 * (`launchExtensionContext` + Twitch HTML fixtures + mock API scenarios), with
 * the browser at a device scale of ZOOM, so the panel renders natively at that
 * size. Each frame is one part of the real panel, cut at its own section
 * edges, beside a one-line headline: 1280x800 PNG, no resampling.
 *
 * Fixture fallback only: frames go to test-results/cws-fixture-screenshots.
 * The store set in store/cws/screenshots is a capture on a real Twitch stream
 * (see store/cws/README.md), so this spec never writes there.
 *
 * Run (headless, after `npm run build`; the headless shell loads no extension):
 * PULSE_EXTENSION_HEADLESS=1 PULSE_EXTENSION_BROWSER_CHANNEL=chromium npx playwright test tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts --project=extension-mocked
 */
import { test as base, expect, type ExtensionTestFixtures } from '../helpers/testFixtures.ts'
import { waitForPulseRoot, assertPulseShadowContains, PULSE_ROOT_ID, PULSE_TABS_ID } from '../helpers/assertions.ts'
import { closeExtensionContext, launchExtensionContext } from '../helpers/extensionContext.ts'
import { installTwitchFixtures, openTwitchChannel, openTwitchVod, type TwitchFixtureKind } from '../helpers/mockTwitch.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Locator, Page } from '@playwright/test'

const W = 1280
const H = 800
/** How much larger than its default size the panel shows in a store frame. */
const ZOOM = 1.6
/** Space kept above and below the panel in a frame, in frame pixels. */
const FRAME_PAD = 24
/** The tallest part of the panel (CSS px) that fits a frame at ZOOM. */
const MAX_CROP_CSS = Math.floor((H - 2 * FRAME_PAD) / ZOOM)
/** Tall enough that every section below is on screen in one piece. */
const CAPTURE_VIEWPORT = { width: 1280, height: 1100 }
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../../../test-results/cws-fixture-screenshots')
const FIXTURES = join(HERE, '../fixtures')

/** The browser renders at ZOOM, so a clip of the panel is already store size. */
const test = base.extend({
  extension: async ({}, use) => {
    const launched = await launchExtensionContext({ viewport: CAPTURE_VIEWPORT, deviceScaleFactor: ZOOM })
    await use(launched)
    await closeExtensionContext(launched)
  },
})

/**
 * Store frames show a made-up channel and our own emotes
 * (tests/e2e/fixtures/store-emotes), so no real streamer, emote art or box art
 * appears in a store listing. Two of them stand in for Twitch emotes, the rest
 * for 7TV emotes, so the emote counts cover both.
 */
const DEMO_LOGIN = 'streampulse_demo'
const STORE_EMOTES = ['pulseHype', 'lolWave', 'ggClap', 'wowPop', 'pulseLove', 'oofDrop'] as const
type StoreEmote = typeof STORE_EMOTES[number]
const TWITCH_STORE_EMOTES: ReadonlySet<StoreEmote> = new Set(['ggClap', 'pulseLove'])

function storeEmote(name: StoreEmote, count: number) {
  return TWITCH_STORE_EMOTES.has(name)
    ? { id: name, name, count, imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${name}/default/dark/3.0`, provider: 'twitch' }
    : { id: name, name, count, imageUrl: `https://cdn.7tv.app/emote/${name}/4x.webp`, provider: 'seventv' }
}

function readApiFixture(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, 'api', file), 'utf8')) as Record<string, unknown>
}

function storeEmoteSvg(name: string) {
  if (!(STORE_EMOTES as readonly string[]).includes(name)) return null
  return readFileSync(join(FIXTURES, 'store-emotes', `${name}.svg`))
}

/**
 * Serves the store emotes and answers every other emote, avatar or box-art
 * request with 404, so the panel falls back to its own initials and no image
 * shows broken. Nothing reaches a real image host.
 */
async function routeStoreImages(context: BrowserContext) {
  for (const host of ['cdn.betterttv.net', 'cdn.frankerfacez.com', 'cdn.streampulse.stream']) {
    await context.route(`https://${host}/**`, route => route.fulfill({ status: 404, body: '' }))
  }
  await context.route('https://static-cdn.jtvnw.net/**', route => {
    const name = /\/emoticons\/v2\/([A-Za-z]+)\//.exec(route.request().url())?.[1] ?? ''
    const svg = TWITCH_STORE_EMOTES.has(name as StoreEmote) ? storeEmoteSvg(name) : null
    return svg ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }) : route.fulfill({ status: 404, body: '' })
  })
  await context.route('https://cdn.7tv.app/**', route => {
    const name = /\/emote\/([A-Za-z]+)\//.exec(route.request().url())?.[1] ?? ''
    const svg = TWITCH_STORE_EMOTES.has(name as StoreEmote) ? null : storeEmoteSvg(name)
    return svg ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }) : route.fulfill({ status: 404, body: '' })
  })
}

/**
 * The Twitch page, API and images of the store's demo channel; call after
 * prepare(). Twitch GQL the fixtures do not answer gets an empty answer
 * instead of reaching Twitch.
 */
async function useStoreChannel(context: BrowserContext, kind: TwitchFixtureKind) {
  await context.route('https://gql.twitch.tv/**', route => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ data: null }) })
  })
  await installTwitchFixtures(context, { kind, login: DEMO_LOGIN, vodId: '2806037629' })
  await routeStoreImages(context)
}

const wave = (minute: number, period: number, phase: number) => (Math.sin((minute / period) * Math.PI * 2 + phase) + 1) / 2

/**
 * Each minute's emotes, split over the store emotes with shares that drift
 * through the stream, so every emote has its own line when plotted.
 */
function minuteEmotes(minute: number, total: number) {
  const weights: Record<StoreEmote, number> = {
    pulseHype: 0.9 + 0.8 * wave(minute, 31, 0.2),
    lolWave: 0.6 + 0.9 * wave(minute, 19, 2.4),
    ggClap: 0.4 + 0.7 * wave(minute, 43, 4.1),
    wowPop: 0.3 + 0.5 * wave(minute, 13, 1.1),
    pulseLove: 0.2 + 0.4 * wave(minute, 27, 3.3),
    oofDrop: 0.15 + 0.35 * wave(minute, 9, 5.0),
  }
  const sum = STORE_EMOTES.reduce((acc, name) => acc + weights[name], 0)
  return STORE_EMOTES.map(name => storeEmote(name, Math.round((total * weights[name]) / sum)))
}

/**
 * The live stream of frames 01, 02 and 05: two hours twenty in, with five
 * ranked moments and the store emotes, so the chart and Top Moments are full.
 */
const LIVE_MINUTES = 140
const LIVE_SPIKES: ReadonlyArray<readonly [minute: number, lift: number, reason: string]> = [
  [57, 3.2, 'chat_spike'],
  [96, 2.7, 'seventv_spike'],
  [121, 2.4, 'chat_spike'],
  [22, 2.1, 'seventv_spike'],
  [136, 1.9, 'chat_spike'],
]
const LIVE_GAMES = [
  { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 40 * 60 },
  { gameName: 'Minecraft', offsetSeconds: 40 * 60, durationSeconds: (LIVE_MINUTES - 40) * 60 },
]

function liveStorePulse(): { pulse: Record<string, unknown>; coverage: Record<string, unknown> } {
  const startedAt = new Date(Date.now() - LIVE_MINUTES * 60_000).toISOString()
  const lift = (minute: number) => {
    const spike = LIVE_SPIKES.find(([at]) => Math.abs(at - minute) <= 1)
    return !spike ? 1 : spike[0] === minute ? spike[1] : 1 + (spike[1] - 1) / 2
  }
  const rollups = Array.from({ length: LIVE_MINUTES + 1 }, (_, minute) => {
    const chat = Math.round((48 + 30 * wave(minute, 26, 0.4) + 10 * wave(minute, 7, 1.3)) * lift(minute))
    const topEmotes = minuteEmotes(minute, Math.round(chat * (0.34 + 0.12 * wave(minute, 11, 2.1))))
    const emotes = topEmotes.reduce((sum, emote) => sum + emote.count, 0)
    return {
      offsetSeconds: minute * 60,
      finalized: minute < LIVE_MINUTES,
      chatCount: chat,
      totalEmoteCount: emotes,
      sevenTvEmoteCount: topEmotes.filter(emote => emote.provider === 'seventv').reduce((sum, emote) => sum + emote.count, 0),
      viewerCount: Math.round(2100 + 1300 * Math.min(1, minute / 45) - 240 * wave(minute, 61, 0.2)),
      viewerSamples: 1,
      topEmotes,
    }
  })
  const max = (key: 'chatCount' | 'totalEmoteCount' | 'sevenTvEmoteCount') => Math.max(...rollups.map(r => r[key]))
  const peaks = LIVE_SPIKES.map(([minute, , reason], index) => {
    const at = rollups[minute]!
    return {
      offsetSeconds: minute * 60,
      score: 96 - index * 7,
      reasons: [reason],
      reasonLabel: reason === 'chat_spike' ? 'Chat spike' : 'Emote spike',
      dominantSignal: reason === 'chat_spike' ? 'chat' : 'seventv',
      chatCount: at.chatCount,
      emoteCount: at.totalEmoteCount,
      topEmotes: [...at.topEmotes].sort((a, b) => b.count - a.count).slice(0, 3),
    }
  })
  const totals = new Map<StoreEmote, number>()
  for (const rollup of rollups) for (const emote of rollup.topEmotes) totals.set(emote.name as StoreEmote, (totals.get(emote.name as StoreEmote) ?? 0) + emote.count)
  const base = readApiFixture('pulse-live-ready.json')
  const pulse = {
    ...base,
    login: DEMO_LOGIN,
    startedAt,
    title: 'Building a castle with chat',
    category: 'Minecraft',
    currentOffsetSeconds: LIVE_MINUTES * 60,
    coverageStartOffsetSeconds: 0,
    coverage: { ...(base.coverage as object), coverageStartOffsetSeconds: 0, coverageEndOffsetSeconds: LIVE_MINUTES * 60 },
    topEmotes: [...totals].sort((a, b) => b[1] - a[1]).map(([name, count]) => storeEmote(name, count)),
    // The recent window; Top Moments ranks more than one moment only once it
    // holds a few completed minutes.
    rollups: rollups.slice(-30),
    fullRollups: rollups,
    lanes: {
      composite: rollups.map(r => r.chatCount / max('chatCount')),
      chat: rollups.map(r => r.chatCount / max('chatCount')),
      seventv: rollups.map(r => r.sevenTvEmoteCount / max('sevenTvEmoteCount')),
      viewers: rollups.map(r => r.viewerCount),
    },
    peaks,
    games: LIVE_GAMES,
  }
  const coverageBase = readApiFixture('coverage-active.json')
  const coverage = {
    ...coverageBase,
    login: DEMO_LOGIN,
    liveMetadata: { ...(coverageBase.liveMetadata as object), title: pulse.title, category: pulse.category, startedAt, viewerCount: rollups.at(-1)!.viewerCount },
  }
  return { pulse, coverage }
}

/** Replaces the mock API's live channel answers with the store's live stream. */
async function useStoreLiveStream(context: BrowserContext) {
  const { pulse, coverage } = liveStorePulse()
  await context.route(
    url => url.hostname === 'api.streampulse.stream' && /^\/v1\/extension\/pulse\/channels\/[^/]+(\/coverage)?$/.test(url.pathname),
    route => route.fulfill({ status: 200, json: new URL(route.request().url()).pathname.endsWith('/coverage') ? coverage : pulse }),
  )
}

/**
 * Frames 03 and 04's past broadcast: the vod-ready fixture stretched to a
 * whole three-hour stream, so the header's date and length, the recap and the
 * chart all describe the same broadcast. Synthetic data on the demo channel.
 */
function replayStoreVod(): Record<string, unknown> {
  const base = readApiFixture('vod-ready.json')
  const minutes = 180
  const spikes = new Map([[38, 2.6], [97, 3.4], [151, 2.2]])
  const points = Array.from({ length: minutes }, (_, index) => {
    const minute = index + 1
    const lift = spikes.get(minute) ?? spikes.get(minute - 1) ?? spikes.get(minute + 1) ?? 1
    const chat = Math.round((34 + 22 * wave(minute, 23, 0.4) + 8 * wave(minute, 7, 1.3)) * lift)
    const topEmotes = minuteEmotes(minute, Math.round(chat * (0.32 + 0.12 * wave(minute, 11, 2.1))))
    return {
      offsetSeconds: minute * 60,
      chatPerMin: chat,
      emotesPerMin: topEmotes.reduce((sum, emote) => sum + emote.count, 0),
      viewers: Math.round(1180 + 520 * Math.min(1, minute / 40) - 140 * wave(minute, 61, 0.2)),
      score: Math.min(100, Math.round(chat / 1.6)),
      topEmotes,
    }
  })
  // Real reason codes: the recap names each moment from its reason.
  const moment = (offsetSeconds: number, reason: 'chat_spike' | 'seventv_spike') => {
    const point = points[offsetSeconds / 60 - 1]!
    return {
      offsetSeconds, label: reason === 'chat_spike' ? 'Chat spike' : 'Emote spike', reason,
      score: point.score, chatPerMin: point.chatPerMin, emotesPerMin: point.emotesPerMin,
      topEmotes: [...point.topEmotes].sort((a, b) => b.count - a.count).slice(0, 3),
    }
  }
  return {
    ...base,
    channelLogin: DEMO_LOGIN,
    channelDisplayName: DEMO_LOGIN,
    title: 'Building a castle with chat',
    durationSeconds: minutes * 60,
    timeline: { bucketSeconds: 60, points },
    // Two ranked moments, so the picked moment's card, the list and the
    // player's answer below them fit one frame (03).
    topMoments: [moment(97 * 60, 'chat_spike'), moment(38 * 60, 'seventv_spike')],
    topEmotes: [storeEmote('pulseHype', 3120), storeEmote('lolWave', 2450), storeEmote('ggClap', 1380)],
    games: [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 70 * 60 },
      { gameName: 'Minecraft', offsetSeconds: 70 * 60, durationSeconds: 110 * 60 },
    ],
  }
}

const PANEL_STORAGE = { overlayMode: 'expanded', overlayPlacement: 'sidebar', sidebarTab: 'pulse' } as const

type Prepare = ExtensionTestFixtures['prepare']

async function openStoreLive(page: Page, prepare: Prepare) {
  await prepare({ scenario: 'live-ready', twitchKind: 'live', storage: PANEL_STORAGE })
  await useStoreChannel(page.context(), 'live')
  await useStoreLiveStream(page.context())
  await openTwitchChannel(page, DEMO_LOGIN)
  await waitForPulseRoot(page)
  await assertPulseShadowContains(page, /Top moments/i)
  await hideAllScrollbars(page)
  return page.locator(`#${PULSE_ROOT_ID}`)
}

async function openStoreVod(page: Page, prepare: Prepare) {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: PANEL_STORAGE })
  const vod = replayStoreVod()
  await useStoreChannel(page.context(), 'vod')
  await page.context().route('https://api.streampulse.stream/v1/extension/pulse/vods/**', route => route.fulfill({ status: 200, json: vod }))
  await openTwitchVod(page)
  await waitForPulseRoot(page, 30_000)
  await assertPulseShadowContains(page, /Minecraft/)
  await hideAllScrollbars(page)
  return page.locator(`#${PULSE_ROOT_ID}`)
}

async function hideAllScrollbars(page: Page) {
  await page.addStyleTag({
    content: `
      html, body, * { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      html, body { overflow: hidden !important; }
    `,
  })
  // Shadow-DOM Pulse panel scrollports (content script root)
  await page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    if (!root) return
    const style = document.createElement('style')
    style.textContent = `
      * { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
    `
    root.appendChild(style)
  }, PULSE_ROOT_ID)
}

/** Scrolls the panel so `element` starts `gap` CSS px below the panel's sticky top. */
async function scrollPanelTo(element: Locator, gap = 16) {
  await element.evaluate((node, gap) => {
    let scroller: Element | null = node.parentElement
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement
    if (!scroller) return
    scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - gap
    // A click can scroll a row sideways into view; frames start at its left edge.
    for (let el: Element | null = node; el; el = el.parentElement) el.scrollLeft = 0
  }, gap)
  await element.page().waitForTimeout(300)
}

/**
 * One store frame: the part of the panel from the top of `from` to the bottom
 * of `to` (CSS px, padded), at ZOOM, beside the headline. The browser already
 * renders at ZOOM, so the clip goes into the frame pixel for pixel.
 */
async function writeStoreFrame(
  page: Page,
  filename: string,
  part: { from: Locator; to: Locator; padTop?: number; padBottom?: number },
  caption: { title: string; body: string },
) {
  const host = await page.locator(`#${PULSE_ROOT_ID}`).boundingBox()
  const from = await part.from.boundingBox()
  const to = await part.to.boundingBox()
  if (!host || !from || !to) throw new Error(`${filename}: panel part not on screen`)
  // Multiples of 5 CSS px are whole device pixels at 1.6.
  const snap = (value: number) => Math.round(value / 5) * 5
  const top = snap(from.y - (part.padTop ?? 12))
  const bottom = snap(to.y + to.height + (part.padBottom ?? 12))
  expect(bottom - top, `${filename}: panel part fits the frame`).toBeLessThanOrEqual(MAX_CROP_CSS)
  expect(bottom, `${filename}: panel part is on screen`).toBeLessThanOrEqual(CAPTURE_VIEWPORT.height)
  const clip = { x: snap(host.x), y: top, width: snap(host.width), height: bottom - top }
  const panel = await page.screenshot({ type: 'png', clip, scale: 'device', animations: 'disabled', caret: 'hide' })
  await composeStoreFrame(page.context(), filename, panel, clip.height * ZOOM, caption)
}

/**
 * Lays the panel part and the caption out in a 1280x800 frame. The page
 * renders at ZOOM device pixels per CSS px, so it is laid out in frame pixels
 * under `zoom: 1/ZOOM`, and the panel image shows at its own pixel size.
 */
async function composeStoreFrame(
  context: BrowserContext,
  filename: string,
  panel: Buffer,
  panelHeight: number,
  caption: { title: string; body: string },
) {
  const panelWidth = panel.readUInt32BE(16)
  expect(panel.readUInt32BE(20), `${filename}: panel image height`).toBe(Math.round(panelHeight))
  const right = 64
  const top = Math.round((H - panelHeight) / 2)
  const textWidth = W - panelWidth - right - 72 - 56
  const page = await context.newPage()
  await page.setViewportSize({ width: W / ZOOM, height: H / ZOOM })
  const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  await page.setContent(
    `<!doctype html><html><head><style>
      html,body{margin:0;overflow:hidden;background:#0e0e10}
      #frame{zoom:${1 / ZOOM};position:relative;width:${W}px;height:${H}px;overflow:hidden;
        background:radial-gradient(900px 640px at ${W - right - panelWidth / 2}px 50%, rgba(124,58,237,.20), rgba(14,14,16,0) 70%),#0e0e10}
      #caption{position:absolute;left:72px;top:50%;transform:translateY(-50%);width:${textWidth}px;
        font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#fff}
      #mark{font-size:20px;font-weight:700;letter-spacing:.02em;color:#a78bfa;margin-bottom:18px}
      #title{font-size:52px;line-height:1.1;font-weight:700;margin-bottom:18px;text-wrap:balance}
      #body{font-size:24px;line-height:1.4;font-weight:400;color:#d4d4d8;text-wrap:pretty}
      #panel{position:absolute;right:${right}px;top:${top}px;width:${panelWidth}px;height:${Math.round(panelHeight)}px;display:block;
        border-radius:14px;box-shadow:0 0 0 1px rgba(255,255,255,.10),0 28px 80px rgba(0,0,0,.65)}
    </style></head><body><div id="frame">
      <div id="caption"><div id="mark">StreamPulse</div><div id="title">${esc(caption.title)}</div><div id="body">${esc(caption.body)}</div></div>
      <img id="panel" alt="" src="data:image/png;base64,${panel.toString('base64')}">
    </div></body></html>`,
    { waitUntil: 'load' },
  )
  await page.locator('#panel').evaluate(img => (img as HTMLImageElement).decode())
  const frame = await page.screenshot({ type: 'png', scale: 'device', animations: 'disabled', caret: 'hide' })
  await page.close()
  expect(frame.readUInt32BE(16), `${filename} width`).toBe(W)
  expect(frame.readUInt32BE(20), `${filename} height`).toBe(H)
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, filename), frame)
}

const FILES = [
  '01-pulse-chart.png',
  '02-top-moments.png',
  '03-vod-jump.png',
  '04-stream-recap.png',
  '05-emotes.png',
] as const

test.describe('CWS extension-on-Twitch screenshots', () => {
  test.describe.configure({ timeout: 90_000 })

  test('01 live Pulse chart', async ({ extension, prepare }) => {
    const page = extension.page
    const root = await openStoreLive(page, prepare)
    // From the chart's legend to its time axis.
    const legend = root.locator('.pulse-ch-legend').first()
    const chart = root.locator('svg[data-testid="pulse-overview-chart"]').first()
    await scrollPanelTo(legend)
    // Point at the biggest spike, so the readout shows that minute.
    const box = await chart.boundingBox()
    if (box) await page.mouse.move(box.x + box.width * (57 / LIVE_MINUTES), box.y + box.height * 0.55)
    await page.waitForTimeout(400)
    await writeStoreFrame(page, FILES[0], { from: legend, to: chart, padBottom: 4 }, {
      title: 'Twitch chat stats, live',
      body: 'Chat, emotes and viewers per minute, charted while you watch.',
    })
  })

  test('02 top moments', async ({ extension, prepare }) => {
    const page = extension.page
    const root = await openStoreLive(page, prepare)
    const heading = root.getByText(/^Top moments$/i).first()
    const rows = root.locator('.pulse-moment-row-button')
    await expect(rows).toHaveCount(LIVE_SPIKES.length)
    await scrollPanelTo(heading)
    await writeStoreFrame(page, FILES[1], { from: heading, to: rows.last() }, {
      title: 'Jump to the moments chat reacted to',
      body: 'Top Moments ranks the biggest chat and emote spikes of the stream.',
    })
  })

  test('03 jump to a moment on the VOD', async ({ extension, prepare }) => {
    const page = extension.page
    const root = await openStoreVod(page, prepare)
    await scrollPanelTo(root.getByText(/^Top moments$/i).first())
    await root.locator('.pulse-moment-row-button').first().click()
    const card = root.locator('.pulse-moment-selection-card').first()
    const jump = card.locator('[data-moment-inspector-action="jump"]')
    await expect(jump).toContainText('Jump')
    await jump.click()
    // The player's answer, in the card under its buttons.
    const notice = card.locator('.pulse-sel-note')
    await expect(notice).toContainText(/Jumped to .* in the VOD/)
    await page.mouse.move(0, 0)
    // From the card's details down to its answer: the picture above is a
    // stand-in on this fixture (no Twitch VOD frames).
    const details = card.getByText('Selected moment', { exact: true })
    await scrollPanelTo(details)
    await writeStoreFrame(page, FILES[2], { from: details, to: notice }, {
      title: 'Watch the moment again on the VOD',
      body: 'Pick a moment of a past stream, press Jump, and the VOD plays from there.',
    })
  })

  test('04 stream recap', async ({ extension, prepare }) => {
    const page = extension.page
    const root = await openStoreVod(page, prepare)
    await expect(root.getByText(/^Stream recap$/i).first()).toBeVisible()
    // The top of the panel: its tabs beside Twitch chat, the replay's header,
    // the recap's summary and the games played. The chart below does not fit.
    const tabs = page.locator(`#${PULSE_TABS_ID}`)
    const games = root.locator('[data-games-played]').first()
    await writeStoreFrame(page, FILES[3], { from: tabs, to: games, padTop: 0 }, {
      title: 'A recap of every stream',
      body: 'Length, messages, games played and the chat peak of a past stream.',
    })
  })

  test('05 emotes', async ({ extension, prepare }) => {
    const page = extension.page
    const root = await openStoreLive(page, prepare)
    // The expanded chart gives plotted emotes a taller lane of their own.
    await root.getByRole('button', { name: 'Expand stream activity chart' }).click()
    const picker = root.locator('.pulse-seven-tv-panel').first()
    await picker.locator('.pulse-seven-tv-toggle').click()
    for (const name of ['pulseHype', 'lolWave', 'ggClap']) {
      await picker.getByRole('option', { name: new RegExp(`^${name},`) }).click()
    }
    await page.mouse.move(0, 0)
    await page.waitForTimeout(600)
    const chart = root.locator('svg[data-testid="pulse-overview-chart"]').first()
    await scrollPanelTo(chart, 40)
    await writeStoreFrame(page, FILES[4], { from: chart, to: picker, padTop: -2, padBottom: 8 }, {
      title: 'See which 7TV and Twitch emotes chat is using',
      body: 'Top emotes with their use counts. Plot any of them on the chart.',
    })

    writeFileSync(
      join(OUT, 'manifest.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dims: { width: W, height: H },
          kind: 'extension_embedded_on_twitch_tv',
          harness: 'tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts',
          note: `Real unpacked dist/ content script on synthetic *.twitch.tv fixture documents, rendered at ${ZOOM}x: each frame is one part of the Pulse panel beside a headline. Live channel (01, 02, 05) and past broadcast (03, 04) are synthetic fixture data on a made-up channel with our own emote art; no real streamer, footage or account data. Mocked captures are not live evidence. Not the streampulse-web landing tour.`,
          files: [...FILES],
        },
        null,
        2,
      ) + '\n',
    )
  })
})
