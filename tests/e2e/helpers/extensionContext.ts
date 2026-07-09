import { chromium, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const distDir = path.join(root, 'dist')

export interface ExtensionStorageSeed {
  backendUrl?: string
  overlayMode?: 'collapsed' | 'mini' | 'expanded'
  overlayPlacement?: 'bottom' | 'right' | 'sidebar' | 'hidden'
  pulseSidebarUiEnabled?: boolean
}

export async function launchWithExtension(): Promise<{ context: BrowserContext; page: Page }> {
  if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
    throw new Error('Extension dist/ missing — run npm run build in streamclone-pulse first.')
  }

  const context = await chromium.launchPersistentContext('', {
    headless: true,
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      '--disable-blink-features=AutomationControlled',
    ],
  })

  const page = context.pages()[0] ?? (await context.newPage())
  return { context, page }
}

export async function seedExtensionStorage(
  context: BrowserContext,
  seed: ExtensionStorageSeed,
): Promise<void> {
  const backendUrl = seed.backendUrl ?? 'https://api.streampulse.stream'
  const overlayMode = seed.overlayMode ?? 'expanded'
  const overlayPlacement = seed.overlayPlacement ?? 'sidebar'

  await context.addInitScript(
    ({ backendUrl, overlayMode, overlayPlacement, pulseSidebarUiEnabled }) => {
      const storage = {
        backendUrl,
        localBackendOptIn: backendUrl.includes('8081'),
        overlayMode,
        overlayPlacement,
        sidebarTab: 'pulse',
        autoUpdateEnabled: true,
        themePreference: 'aurora',
        defaultChartWindow: '60m',
        chatClosedPulseDockEnabled: pulseSidebarUiEnabled ?? true,
      }
      window.localStorage.setItem('streamclone-pulse-dev-storage-seed', JSON.stringify(storage))
    },
    {
      backendUrl,
      overlayMode,
      overlayPlacement,
      pulseSidebarUiEnabled: seed.pulseSidebarUiEnabled ?? true,
    },
  )
}

export async function dismissTwitchOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const sel of [
      '[data-a-target="consent-banner"]',
      '[data-a-target="player-overlay-mature-warning"]',
      'button[data-a-target="player-overlay-mature-accept"]',
    ]) {
      document.querySelectorAll(sel).forEach(el => el.remove())
    }
  })
}

export async function suppressSidebarSnapFixtures(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.streamclonePulseSidebarFixture = '1'
  })
}

export async function mockChannelNav(page: Page, login: string): Promise<void> {
  await page.evaluate(channelLogin => {
    window.history.pushState({}, '', `/${channelLogin}`)
    document.title = `${channelLogin} - Twitch`
  }, login)
}

export async function simulateSidebarSnap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const chatColumn = document.createElement('div')
    chatColumn.id = 'streamclone-pulse-chat-fixture'
    chatColumn.style.cssText = [
      'position:fixed',
      'top:56px',
      'right:0',
      'width:340px',
      'height:calc(100vh - 56px)',
      'background:#0e0e10',
      'z-index:1',
    ].join(';')
    document.body.appendChild(chatColumn)

    const style = document.createElement('style')
    style.textContent = `
      #streamclone-pulse-tabs,
      #streamclone-pulse-root {
        position: fixed !important;
        right: 0 !important;
        width: 340px !important;
        z-index: 2147483000 !important;
      }
      #streamclone-pulse-tabs { top: 56px !important; }
      #streamclone-pulse-root { top: 96px !important; height: calc(100vh - 96px) !important; }
    `
    document.head.appendChild(style)
  })
}

export async function readExtensionPanelClip(page: Page) {
  return page.evaluate(() => {
    const hosts = ['streamclone-pulse-tabs', 'streamclone-pulse-root']
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => el instanceof HTMLElement && getComputedStyle(el).display !== 'none')

    const rects = hosts.map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)
    if (rects.length === 0) return null

    const left = Math.min(...rects.map(r => r.left))
    const top = Math.min(...rects.map(r => r.top))
    const right = Math.max(...rects.map(r => r.right))
    const bottom = Math.max(...rects.map(r => r.bottom))
    return {
      x: Math.max(0, Math.floor(left)),
      y: Math.max(0, Math.floor(top)),
      width: Math.ceil(right - left),
      height: Math.ceil(bottom - top),
    }
  })
}
