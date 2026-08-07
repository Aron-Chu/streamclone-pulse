#!/usr/bin/env node
/**
 * Capture a curated Chrome Web Store screenshot set from the real unpacked
 * extension on real Twitch pages. Headed Chromium is kept off-screen because
 * MV3 service workers are not reliable in Playwright headless mode.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium, type Browser, type Page } from '@playwright/test'
import {
  closeExtensionContext,
  launchExtensionContext,
  seedExtensionStorage,
} from '../tests/e2e/helpers/extensionContext.ts'
import { dismissTwitchOverlays } from '../tests/e2e/helpers/goldenCapture.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storeDir = path.join(root, 'store/cws')
const outDir = path.join(storeDir, 'screenshots')
const previewDir = path.join(root, 'test-results/cws-preview')
const W = 1280
const H = 800

const liveLogin = (process.env.CWS_LIVE_LOGIN?.trim() || 'jynxzi').toLowerCase()
const offlineLogin = (process.env.CWS_OFFLINE_LOGIN?.trim() || 'xqc').toLowerCase()
const vodId = process.env.CWS_VOD_ID?.trim() || '2824179241'
const backendUrl = process.env.CWS_LIVE_BACKEND?.trim() || 'https://api.streampulse.stream'
const visibleBrowser = process.env.CWS_VISIBLE?.trim() === '1'

const liveUrl = `https://www.twitch.tv/${liveLogin}`
const offlineUrl = `https://www.twitch.tv/${offlineLogin}`
const vodUrl = `https://www.twitch.tv/videos/${vodId}`

const shotPlan = [
  { filename: '01-jynxzi-live-overview.png', url: liveUrl, state: 'live-overview' },
  { filename: '02-jynxzi-live-activity.png', url: liveUrl, state: 'live-activity' },
  { filename: '03-xqc-offline-chat.png', url: offlineUrl, state: 'offline-chat' },
  { filename: '04-xqc-vod-recap.png', url: vodUrl, state: 'vod-recap' },
  { filename: '05-xqc-vod-reactions.png', url: vodUrl, state: 'vod-reactions' },
] as const

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Preflight ${url} returned HTTP ${response.status}`)
  return await response.json() as Record<string, unknown>
}

async function preflightStates(): Promise<void> {
  const [live, offline, vod] = await Promise.all([
    fetchJson(`${backendUrl}/v1/extension/pulse/channels/${encodeURIComponent(liveLogin)}`),
    fetchJson(`${backendUrl}/v1/extension/pulse/channels/${encodeURIComponent(offlineLogin)}`),
    fetchJson(`${backendUrl}/v1/extension/pulse/vods/${encodeURIComponent(vodId)}`),
  ])
  invariant(live.isLive === true, `${liveLogin} is no longer live; existing CWS assets were not touched.`)
  invariant(offline.isLive === false, `${offlineLogin} is no longer offline; existing CWS assets were not touched.`)
  invariant(vod.mode === 'vod', `VOD ${vodId} did not resolve in StreamPulse.`)
  invariant(
    String(vod.channelLogin ?? '').toLowerCase() === offlineLogin,
    `VOD ${vodId} belongs to ${String(vod.channelLogin ?? 'unknown')}, expected ${offlineLogin}.`,
  )
  invariant(
    Array.isArray(vod.topMoments) && vod.topMoments.length > 0,
    `VOD ${vodId} has no reaction moments to present.`,
  )
}

function sha256Files(paths: string[]): Map<string, string> {
  const hashes = new Map<string, string>()
  for (const file of paths) {
    hashes.set(file, createHash('sha256').update(fs.readFileSync(file)).digest('hex'))
  }
  return hashes
}

function assertHashesUnchanged(before: Map<string, string>): void {
  for (const [file, hash] of before) {
    const current = fs.existsSync(file) ? fs.readFileSync(file) : null
    invariant(current, `Protected CWS asset disappeared: ${file}`)
    const currentHash = createHash('sha256').update(current).digest('hex')
    invariant(currentHash === hash, `Protected CWS asset changed unexpectedly: ${file}`)
  }
}

async function installDarkTheme(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => {
    try {
      localStorage.setItem('twilight.theme', '1')
    } catch {
      // Twitch pages permit storage; keep the DOM fallback for defensive capture.
    }
    document.documentElement.classList.remove('tw-root--theme-light')
    document.documentElement.classList.add('tw-root--theme-dark')
  })
}

async function dismissCaptureObstructions(page: Page): Promise<void> {
  await dismissTwitchOverlays(page)
  for (const selector of [
    'button[data-a-target="consent-banner-accept"]',
    'button[data-a-target="player-overlay-mature-accept"]',
    '[data-a-target="content-classification-gate-overlay"] button',
  ]) {
    const button = page.locator(selector).first()
    if (await button.isVisible({ timeout: 700 }).catch(() => false)) {
      await button.click({ timeout: 2_000 }).catch(() => undefined)
    }
  }

  await page.evaluate(() => {
    for (const selector of [
      '[data-a-target="consent-banner"]',
      '[data-a-target="signup-modal"]',
      '[data-a-target="signup-overlay"]',
      '[data-test-selector="signup-banner"]',
      '[data-a-target="onboarding-modal"]',
    ]) {
      document.querySelectorAll(selector).forEach(node => node.remove())
    }

    // Logged-out Twitch can add a fixed signup strip at the viewport bottom.
    // Remove only a shallow bottom overlay, never the top nav or page content.
    for (const node of document.querySelectorAll<HTMLElement>('body *')) {
      const style = getComputedStyle(node)
      if (style.position !== 'fixed') continue
      const rect = node.getBoundingClientRect()
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      if (
        rect.top > innerHeight * 0.72
        && rect.height > 30
        && rect.height < 140
        && /sign up to experience|join twitch today/i.test(text)
      ) {
        node.remove()
      }
    }

    // Target the actual bottom-most overlay stack as well; Twitch can remount
    // the logged-out banner after the initial consent pass.
    for (const node of document.elementsFromPoint(innerWidth / 2, innerHeight - 8)) {
      let current: HTMLElement | null = node instanceof HTMLElement ? node : null
      while (current && current !== document.body) {
        const rect = current.getBoundingClientRect()
        const text = current.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        if (
          rect.top > innerHeight * 0.72
          && rect.height > 30
          && rect.height < 140
          && /sign up to experience|join twitch today/i.test(text)
        ) {
          current.style.setProperty('display', 'none', 'important')
          break
        }
        current = current.parentElement
      }
    }

    // Dismiss non-product player notices that obscure the actual stream frame.
    for (const node of document.querySelectorAll<HTMLElement>('div, section, aside')) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      if (!/^(Audio for portions of this video|Intended for certain audiences)/i.test(text)) continue
      const rect = node.getBoundingClientRect()
      if (rect.width < 140 || rect.width > 620 || rect.height < 24 || rect.height > 320) continue
      node.style.setProperty('display', 'none', 'important')
    }
  })
}

async function waitForAdsToClear(page: Page, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let clearSince = 0
  while (Date.now() < deadline) {
    const hasVisibleAd = await page.evaluate(() => {
      const explicit = document.querySelector<HTMLElement>(
        '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [class*="video-ad-countdown"]',
      )
      if (explicit) {
        const rect = explicit.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0 && getComputedStyle(explicit).visibility !== 'hidden') return true
      }
      return Array.from(document.querySelectorAll<HTMLElement>('div, span')).some(node => {
        const ownText = Array.from(node.childNodes)
          .filter(child => child.nodeType === Node.TEXT_NODE)
          .map(child => child.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (!/Ad \d+ of \d+|right after this ad break/i.test(ownText)) return false
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
      })
    })
    if (hasVisibleAd) {
      clearSince = 0
    } else if (!clearSince) {
      clearSince = Date.now()
    } else if (Date.now() - clearSince >= 2_500) {
      return
    }
    await page.waitForTimeout(500)
  }
  throw new Error(`Twitch ad did not clear within ${Math.round(timeoutMs / 1000)}s; existing screenshots were retained.`)
}

async function hideScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      html, body, * { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      html, body { overflow: hidden !important; }
    `,
  })
  await page.evaluate(() => {
    for (const rootId of ['streamclone-pulse-tabs', 'streamclone-pulse-root']) {
      const root = document.getElementById(rootId)?.shadowRoot
      if (!root) continue
      const style = document.createElement('style')
      style.dataset.cwsCaptureStyle = '1'
      style.textContent = `
        * { scrollbar-width: none !important; }
        *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      `
      root.appendChild(style)
    }
  })
}

async function waitForPulse(page: Page, expected: RegExp, timeoutMs = 90_000): Promise<void> {
  const source = expected.source
  const flags = expected.flags
  try {
    await page.waitForFunction(
      ({ pattern, patternFlags }) => {
        const host = document.getElementById('streamclone-pulse-root')
        const root = host?.shadowRoot
        if (!host || !root || getComputedStyle(host).display === 'none') return false
        const panel = root.querySelector<HTMLElement>('.pulse-shell, .pulse-sidebar-content, .pulse-panel')
        const rect = panel?.getBoundingClientRect()
        const text = panel?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        const busy = root.querySelector('[aria-busy="true"]')
        const loading = /Loading Pulse|Loading replay analytics|Loading timeline|Loading stream recap/i.test(text)
        return (
          !!rect
          && rect.width >= 280
          && rect.height > 300
          && !busy
          && !loading
          && new RegExp(pattern, patternFlags).test(text)
        )
      },
      { pattern: source, patternFlags: flags },
      { timeout: timeoutMs },
    )
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const host = document.getElementById('streamclone-pulse-root')
      const root = host?.shadowRoot
      const rect = host?.getBoundingClientRect()
      const panel = root?.querySelector<HTMLElement>('.pulse-shell, .pulse-sidebar-content, .pulse-panel')
      const panelRect = panel?.getBoundingClientRect()
      return {
        url: location.href,
        host: host ? {
          display: getComputedStyle(host).display,
          rect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom } : null,
        } : null,
        panel: panelRect ? { top: panelRect.top, left: panelRect.left, width: panelRect.width, height: panelRect.height, right: panelRect.right, bottom: panelRect.bottom } : null,
        text: panel?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 2_000) ?? '',
        busy: root?.querySelectorAll('[aria-busy="true"]').length ?? -1,
        chatColumns: Array.from(document.querySelectorAll<HTMLElement>(
          '[data-test-selector="chat-room-component-layout"], .channel-root__right-column, [data-a-target="right-column-chat-bar"]',
        )).map(node => {
          const r = node.getBoundingClientRect()
          return { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
        }),
      }
    })
    throw new Error(`Pulse did not settle for ${expected}: ${JSON.stringify(diagnostic)}`, { cause: error })
  }
}

async function ensurePulseTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.getElementById('streamclone-pulse-tabs')?.shadowRoot
    const button = root?.querySelector('[data-tab="pulse"], button[aria-label*="Pulse" i]')
    if (button instanceof HTMLElement) button.click()
  })
  await page.waitForTimeout(500)
}

async function ensureTwitchChatOpen(page: Page): Promise<string> {
  const result = await page.evaluate(() => {
    const columns = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-test-selector="chat-room-component-layout"], .channel-root__right-column, [data-a-target="right-column-chat-bar"]',
    ))
    const onscreen = columns.some(column => {
      const rect = column.getBoundingClientRect()
      return rect.width >= 160 && rect.height >= 160 && rect.left >= -1 && rect.right <= innerWidth + 1
    })
    if (onscreen) return 'already-open'

    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-a-target="right-column__toggle-collapse-btn"], [data-a-target="collapse-chat"], button[aria-label*="Expand chat" i], button[aria-label*="Show chat" i]',
    ))
    const control = controls.find(node => {
      const rect = node.getBoundingClientRect()
      const label = node.getAttribute('aria-label') ?? ''
      return rect.width > 0 && rect.height > 0 && (/expand|show/i.test(label) || node.getAttribute('aria-expanded') === 'false')
    })
    if (!control) return 'no-control'
    control.click()
    return 'clicked'
  })
  if (result === 'clicked') await page.waitForTimeout(1_200)
  return result
}

async function assertCaptureLayout(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const panel = document.getElementById('streamclone-pulse-root')
    const tabs = document.getElementById('streamclone-pulse-tabs')
    const root = panel?.shadowRoot
    const renderedPanel = root?.querySelector<HTMLElement>('.pulse-shell, .pulse-sidebar-content, .pulse-panel')
    const panelRect = renderedPanel?.getBoundingClientRect()
    const tabsRect = tabs?.getBoundingClientRect()
    const text = renderedPanel?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const panelStyles = panel ? getComputedStyle(panel) : null
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dark: document.documentElement.classList.contains('tw-root--theme-dark'),
      panel: panelRect
        ? { left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom, width: panelRect.width }
        : null,
      tabs: tabsRect && tabsRect.width > 0 && tabsRect.height > 0
        ? { left: tabsRect.left, right: tabsRect.right, top: tabsRect.top, bottom: tabsRect.bottom, width: tabsRect.width }
        : null,
      pulsePanelToken: panelStyles?.getPropertyValue('--pulse-surface-panel').trim() ?? '',
      text,
      busy: root?.querySelectorAll('[aria-busy="true"]').length ?? -1,
      obstruction: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .some(node => {
          const rect = node.getBoundingClientRect()
          return rect.width > 100 && rect.height > 100 && getComputedStyle(node).visibility !== 'hidden'
        }),
    }
  })

  invariant(state.dark, 'Twitch did not stay in dark mode.')
  invariant(
    state.viewport.width === W && state.viewport.height === H,
    `Twitch changed the capture viewport: ${JSON.stringify(state.viewport)}`,
  )
  invariant(state.panel, 'The rendered Pulse panel is missing.')
  invariant(Math.abs(state.panel.right - W) <= 20, `Pulse panel is not right-docked: ${JSON.stringify(state.panel)}`)
  invariant(state.panel.width >= 280 && state.panel.width <= 430, `Pulse panel width is unsuitable: ${state.panel.width}`)
  invariant(state.panel.top >= 40 && state.panel.bottom <= H + 2, `Pulse panel is clipped: ${JSON.stringify(state.panel)}`)
  if (state.tabs) {
    invariant(Math.abs(state.panel.left - state.tabs.left) <= 2, 'Pulse tabs and panel are horizontally misaligned.')
  }
  invariant(state.pulsePanelToken.toLowerCase() !== '#fdfdfd', 'Pulse rendered its light surface palette.')
  invariant(state.busy === 0, 'Pulse still contains an aria-busy region.')
  invariant(!state.obstruction, 'A Twitch dialog is obstructing the screenshot.')
  invariant(!/Something went wrong|Unable to load|request failed/i.test(state.text), 'Pulse contains an error state.')
}

async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts?.ready
    const visibleImages = Array.from(document.images).filter(image => {
      const rect = image.getBoundingClientRect()
      return rect.width > 24 && rect.height > 24 && rect.bottom > 0 && rect.top < innerHeight
    })
    await Promise.all(visibleImages.slice(0, 40).map(image => {
      if (image.complete) return Promise.resolve()
      return new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
        setTimeout(resolve, 2_000)
      })
    }))
  })
  await page.waitForTimeout(1_000)
}

async function ensurePlayerFrame(page: Page): Promise<void> {
  const video = page.locator('video').first()
  await video.waitFor({ state: 'attached', timeout: 45_000 })
  await page.waitForFunction(
    () => {
      const node = document.querySelector('video')
      return node instanceof HTMLVideoElement && node.readyState >= 2 && node.videoWidth > 0 && node.videoHeight > 0
    },
    undefined,
    { timeout: 45_000 },
  )
  await page.evaluate(async () => {
    const node = document.querySelector('video')
    if (!(node instanceof HTMLVideoElement)) return
    node.muted = true
    await node.play().catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 1_200))
    node.pause()
  })
}

async function scrollPulseTo(page: Page, target: RegExp | null): Promise<void> {
  await page.evaluate(
    ({ pattern, flags }) => {
      const root = document.getElementById('streamclone-pulse-root')?.shadowRoot
      const body = root?.querySelector(
        '.pulse-panel-body, .pulse-sidebar-content, [data-pulse-scroll]',
      ) as HTMLElement | null
      if (!body) return
      if (!pattern) {
        body.scrollTop = 0
        return
      }
      const matcher = new RegExp(pattern, flags)
      const candidate = Array.from(root!.querySelectorAll<HTMLElement>('h2, h3, span, strong, button, p'))
        .filter(node => matcher.test(node.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
        .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0]
      if (!candidate) return
      const bodyRect = body.getBoundingClientRect()
      const targetRect = candidate.getBoundingClientRect()
      body.scrollTop += targetRect.top - bodyRect.top - 8
    },
    { pattern: target?.source ?? '', flags: target?.flags ?? '' },
  )
  await page.waitForTimeout(700)
}

async function navigateAndPrepare(page: Page, url: string, expected: RegExp): Promise<void> {
  await page.setViewportSize({ width: W, height: H })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  // Twitch can change window geometry during a full route navigation in headed
  // Chromium; reassert the exact CWS CSS viewport before measuring the dock.
  await page.setViewportSize({ width: W, height: H })
  await page.waitForTimeout(2_500)
  await installDarkTheme(page)
  await dismissCaptureObstructions(page)
  const chatState = await ensureTwitchChatOpen(page)
  console.log(`Twitch chat layout: ${chatState}`)
  await page.waitForTimeout(1_000)
  await dismissCaptureObstructions(page)
  await waitForPulse(page, expected)
  await ensurePulseTab(page)
  await waitForPulse(page, expected)
  await hideScrollbars(page)
  await settlePage(page)
  await assertCaptureLayout(page)
}

async function createScaler(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  return { browser, page: await context.newPage() }
}

async function resizePng(page: Page, input: Buffer, width: number, height: number): Promise<Buffer> {
  const dataUrl = `data:image/png;base64,${input.toString('base64')}`
  await page.setViewportSize({ width, height })
  await page.setContent(
    `<!doctype html><html><head><style>
      html,body{margin:0;overflow:hidden;width:${width}px;height:${height}px;background:#0e0e12}
      img{display:block;width:${width}px;height:${height}px;object-fit:fill}
    </style></head><body><img id="capture" src=${JSON.stringify(dataUrl)}></body></html>`,
    { waitUntil: 'load' },
  )
  await page.waitForFunction(
    () => {
      const image = document.getElementById('capture')
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
    },
    undefined,
    { timeout: 30_000 },
  )
  return Buffer.from(await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width, height },
    animations: 'disabled',
  }))
}

async function captureShot(
  page: Page,
  scaler: Page,
  stagingDir: string,
  filename: string,
): Promise<void> {
  await dismissCaptureObstructions(page)
  await page.waitForTimeout(150)
  await assertCaptureLayout(page)
  const highResolution = Buffer.from(await page.screenshot({
    type: 'png',
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    scale: 'device',
  }))
  const exact = await resizePng(scaler, highResolution, W, H)
  invariant(exact.readUInt32BE(16) === W && exact.readUInt32BE(20) === H, `${filename} has invalid dimensions.`)
  invariant(exact.length > 25_000, `${filename} is suspiciously small (${exact.length} bytes).`)
  fs.writeFileSync(path.join(stagingDir, filename), exact)
  console.log(`Staged ${filename}`)
}

function validateStagedSet(stagingDir: string): void {
  const pngs = fs.readdirSync(stagingDir).filter(name => name.endsWith('.png')).sort()
  invariant(pngs.length === shotPlan.length, `Expected ${shotPlan.length} screenshots, found ${pngs.length}.`)
  for (const shot of shotPlan) {
    invariant(pngs.includes(shot.filename), `Missing staged screenshot ${shot.filename}`)
    const png = fs.readFileSync(path.join(stagingDir, shot.filename))
    invariant(png.readUInt32BE(16) === W && png.readUInt32BE(20) === H, `${shot.filename} is not ${W}x${H}.`)
  }
}

function replaceScreenshotDirectory(stagingDir: string): void {
  const backupDir = path.join(storeDir, `.screenshots-backup-${Date.now()}`)
  let movedExisting = false
  try {
    if (fs.existsSync(outDir)) {
      fs.renameSync(outDir, backupDir)
      movedExisting = true
    }
    fs.renameSync(stagingDir, outDir)
    if (movedExisting) fs.rmSync(backupDir, { recursive: true, force: true })
  } catch (error) {
    if (!fs.existsSync(outDir) && movedExisting && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, outDir)
    }
    throw error
  }
}

fs.mkdirSync(storeDir, { recursive: true })
const stagingDir = fs.mkdtempSync(path.join(storeDir, '.screenshots-stage-'))
const protectedIcons = [
  path.join(storeDir, 'icons/icon128.png'),
  path.join(storeDir, 'icons/small-promo-440x280.png'),
]
const iconHashes = sha256Files(protectedIcons)

let launched: Awaited<ReturnType<typeof launchExtensionContext>> | null = null
let scalerBrowser: Browser | null = null
let committed = false

try {
  await preflightStates()
  launched = await launchExtensionContext({
    headless: false,
    background: !visibleBrowser,
    colorScheme: 'dark',
    deviceScaleFactor: 2,
  })
  await seedExtensionStorage(launched.serviceWorker, {
    backendUrl,
    overlayMode: 'expanded',
    overlayPlacement: 'sidebar',
    sidebarTab: 'pulse',
    autoUpdateEnabled: true,
    colorSchemePreference: 'dark',
    chatClosedPulseDockEnabled: true,
    defaultChartWindow: 'full',
  })
  await launched.context.addInitScript(() => {
    try {
      localStorage.setItem('twilight.theme', '1')
    } catch {
      // Non-Twitch origins can reject storage.
    }
    document.documentElement?.classList.remove('tw-root--theme-light')
    document.documentElement?.classList.add('tw-root--theme-dark')
  })

  const scaler = await createScaler()
  scalerBrowser = scaler.browser
  const page = launched.page

  console.log(`Capturing live state: ${liveUrl}`)
  await navigateAndPrepare(page, liveUrl, /LIVE NOW|Viewers|Chat \/ min/i)
  await waitForAdsToClear(page)
  await ensurePlayerFrame(page)
  await scrollPulseTo(page, null)
  await captureShot(page, scaler.page, stagingDir, shotPlan[0].filename)
  await scrollPulseTo(page, /STREAM ACTIVITY/i)
  await captureShot(page, scaler.page, stagingDir, shotPlan[1].filename)

  console.log(`Capturing offline state: ${offlineUrl}`)
  await navigateAndPrepare(page, offlineUrl, /LAST STREAM RECAP|STREAM RECAP|Past streams/i)
  await waitForAdsToClear(page)
  await scrollPulseTo(page, /LAST STREAM RECAP|STREAM RECAP/i)
  await captureShot(page, scaler.page, stagingDir, shotPlan[2].filename)

  console.log(`Capturing VOD state: ${vodUrl}`)
  await navigateAndPrepare(page, vodUrl, /STREAM RECAP|Top moments|Peak chat/i)
  await waitForAdsToClear(page)
  await ensurePlayerFrame(page)
  await scrollPulseTo(page, /STREAM RECAP/i)
  await captureShot(page, scaler.page, stagingDir, shotPlan[3].filename)
  await scrollPulseTo(page, /Top moments/i)
  await captureShot(page, scaler.page, stagingDir, shotPlan[4].filename)

  await preflightStates()
  assertHashesUnchanged(iconHashes)
  validateStagedSet(stagingDir)

  fs.writeFileSync(
    path.join(stagingDir, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dims: { width: W, height: H },
        theme: 'dark',
        kind: 'extension_on_real_twitch',
        backendUrl,
        harness: 'scripts/capture-cws-live.mts',
        browserMode: visibleBrowser ? 'headed-visible' : 'headed-offscreen',
        routes: { live: liveUrl, offline: offlineUrl, vod: vodUrl },
        files: shotPlan.map(shot => ({ ...shot })),
        note: 'Fresh logged-out Playwright profile with unpacked dist/ on real twitch.tv pages.',
      },
      null,
      2,
    ) + '\n',
  )

  fs.rmSync(previewDir, { recursive: true, force: true })
  fs.mkdirSync(previewDir, { recursive: true })
  for (const shot of shotPlan) {
    const exact = fs.readFileSync(path.join(stagingDir, shot.filename))
    const preview = await resizePng(scaler.page, exact, 640, 400)
    fs.writeFileSync(path.join(previewDir, shot.filename), preview)
  }

  replaceScreenshotDirectory(stagingDir)
  committed = true
  assertHashesUnchanged(iconHashes)
  console.log(JSON.stringify({ outDir, previewDir, files: shotPlan.map(shot => shot.filename) }, null, 2))
} finally {
  if (launched) await closeExtensionContext(launched)
  if (scalerBrowser) await scalerBrowser.close().catch(() => undefined)
  if (!committed) fs.rmSync(stagingDir, { recursive: true, force: true })
}
