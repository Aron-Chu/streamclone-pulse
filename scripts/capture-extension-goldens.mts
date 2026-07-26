import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  closeExtensionContext,
  launchExtensionContext,
  seedExtensionStorage,
} from '../tests/e2e/helpers/extensionContext.ts'
import {
  dismissTwitchOverlays,
  mockChannelNav,
  readExtensionPanelClip,
  simulateSidebarSnap,
  suppressSidebarSnapFixtures,
} from '../tests/e2e/helpers/goldenCapture.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'runtime', 'goldens')
fs.mkdirSync(outDir, { recursive: true })

async function scrollPanelToProgress(page: import('@playwright/test').Page, progress: number) {
  await page.evaluate(p => {
    const host = document.getElementById('streamclone-pulse-root')
    const body = host?.shadowRoot?.querySelector('.pulse-panel-body') as HTMLElement | null
    if (!body) return
    const max = Math.max(0, body.scrollHeight - body.clientHeight)
    body.scrollTop = Math.round(max * p)
  }, progress)
  await page.waitForTimeout(600)
}

const beats = [
  { name: 'beat-1-live-stats', progress: 0.05 },
  { name: 'beat-2-coverage', progress: 0.35 },
  { name: 'beat-3-most-reacted', progress: 0.62 },
  { name: 'beat-4-past-vods', progress: 0.92 },
]

const login = process.env.EXTENSION_GOLDEN_LOGIN?.trim() || 'xqc'
const backendUrl = process.env.EXTENSION_GOLDEN_BACKEND?.trim() || 'https://api.streampulse.stream'

const launched = await launchExtensionContext()
try {
  await seedExtensionStorage(launched.serviceWorker, {
    backendUrl,
    overlayMode: 'expanded',
    overlayPlacement: 'sidebar',
    sidebarTab: 'pulse',
    chatClosedPulseDockEnabled: true,
  })

  const { page } = launched
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('https://www.twitch.tv/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)
  await dismissTwitchOverlays(page)
  await suppressSidebarSnapFixtures(page)
  await mockChannelNav(page, login)
  await simulateSidebarSnap(page)

  await page.waitForFunction(
    () => {
      const host = document.getElementById('streamclone-pulse-root')
      if (!host || getComputedStyle(host).display === 'none') return false
      const shell = host.shadowRoot?.querySelector('.pulse-shell, .pulse-sidebar-content')
      return shell instanceof HTMLElement && shell.getBoundingClientRect().height > 80
    },
    { timeout: 45_000 },
  )

  const fullClip = await readExtensionPanelClip(page)
  if (!fullClip) throw new Error('Pulse extension panel not visible')

  const fullPath = path.join(outDir, 'extension-panel-full.png')
  await page.screenshot({ path: fullPath, clip: fullClip })

  for (const beat of beats) {
    await scrollPanelToProgress(page, beat.progress)
    const clip = await readExtensionPanelClip(page)
    if (!clip) continue
    const outPath = path.join(outDir, `extension-panel-${beat.name}.png`)
    await page.screenshot({ path: outPath, clip })
  }

  console.log(JSON.stringify({ outDir, login, backendUrl, beats: beats.map(b => b.name) }))
} finally {
  await closeExtensionContext(launched)
}
