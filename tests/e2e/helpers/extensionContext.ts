import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const EXTENSION_DIST_DIR = path.join(root, 'dist')
export const EXTENSION_MANIFEST_PATH = path.join(EXTENSION_DIST_DIR, 'manifest.json')

export interface ExtensionStorageSeed {
  backendUrl?: string
  overlayMode?: 'collapsed' | 'mini' | 'expanded'
  overlayPlacement?: 'bottom' | 'right' | 'sidebar' | 'hidden'
  sidebarTab?: 'chat' | 'pulse'
  autoUpdateEnabled?: boolean
  pollIntervalMs?: number
  themePreference?: 'aurora' | 'volt' | 'azure'
  chatClosedPulseDockEnabled?: boolean
  defaultChartWindow?: '15m' | '30m' | '60m' | '2h' | '4h' | 'full'
  /**
   * Legacy v1 migration flag (sticky → Full). Prefer v2 for new seeds.
   */
  defaultChartWindowMigratedToFullV1?: boolean
  /**
   * When true, skips the one-time pre-v2→60m migration so a seeded
   * defaultChartWindow (including Full) survives mount.
   * When omitted/false, migrateDefaultChartWindowToRecentV2Once runs.
   */
  defaultChartWindowMigratedToRecentV2?: boolean
}

export interface LaunchedExtension {
  context: BrowserContext
  page: Page
  userDataDir: string
  extensionId: string
  serviceWorker: Worker
  /** Directory containing Playwright recordVideo output for this context. */
  videoDir: string
}

function assertDistPresent(): void {
  if (!fs.existsSync(EXTENSION_MANIFEST_PATH)) {
    throw new Error('Extension dist/ missing — run `npm run build` before extension e2e.')
  }
}

export async function launchExtensionContext(
  options?: {
    headless?: boolean
    userDataDir?: string
    viewport?: { width: number; height: number }
    deviceScaleFactor?: number
  },
): Promise<LaunchedExtension> {
  assertDistPresent()

  const userDataDir = options?.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ext-e2e-'))
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ext-video-'))
  const headless = options?.headless ?? false
  const viewport = options?.viewport ?? { width: 1440, height: 900 }
  const deviceScaleFactor = options?.deviceScaleFactor ?? 1

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST_DIR}`,
      `--load-extension=${EXTENSION_DIST_DIR}`,
      '--disable-blink-features=AutomationControlled',
    ],
    viewport,
    deviceScaleFactor,
    // Config use.video does not apply to manually launched persistent contexts.
    recordVideo: { dir: videoDir, size: viewport },
  })

  const serviceWorker = await waitForExtensionServiceWorker(context)
  const extensionId = extensionIdFromWorker(serviceWorker)
  const page = context.pages()[0] ?? (await context.newPage())

  return { context, page, userDataDir, extensionId, serviceWorker, videoDir }
}

export async function waitForExtensionServiceWorker(
  context: BrowserContext,
  timeoutMs = 30_000,
): Promise<Worker> {
  const existing = context.serviceWorkers().find(sw => sw.url().startsWith('chrome-extension://'))
  if (existing) return existing

  return context.waitForEvent('serviceworker', {
    predicate: sw => sw.url().startsWith('chrome-extension://'),
    timeout: timeoutMs,
  })
}

export function extensionIdFromWorker(worker: Worker): string {
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)/)
  if (!match) throw new Error(`Could not parse extension id from ${worker.url()}`)
  return match[1]
}

export async function seedExtensionStorage(
  serviceWorker: Worker,
  seed: ExtensionStorageSeed = {},
): Promise<void> {
  const payload: Record<string, unknown> = {
    backendUrl: seed.backendUrl ?? 'https://api.streampulse.stream',
    localBackendOptIn: false,
    overlayMode: seed.overlayMode ?? 'expanded',
    overlayPlacement: seed.overlayPlacement ?? 'sidebar',
    sidebarTab: seed.sidebarTab ?? 'pulse',
    autoUpdateEnabled: seed.autoUpdateEnabled ?? true,
    pollIntervalMs: seed.pollIntervalMs ?? 60_000,
    themePreference: seed.themePreference ?? 'aurora',
    chatClosedPulseDockEnabled: seed.chatClosedPulseDockEnabled ?? false,
    defaultChartWindow: seed.defaultChartWindow ?? '60m',
    keepLocalCache: true,
  }

  if (seed.defaultChartWindowMigratedToFullV1 === true) {
    payload.defaultChartWindowMigratedToFullV1 = true
  }
  if (seed.defaultChartWindowMigratedToRecentV2 === true) {
    payload.defaultChartWindowMigratedToRecentV2 = true
    payload.defaultChartWindowMigratedToFullV1 = true
  }

  await serviceWorker.evaluate(async storage => {
    await chrome.storage.sync.set(storage)
  }, payload)
}

export async function readExtensionStorage(
  serviceWorker: Worker,
  keys?: string[],
): Promise<Record<string, unknown>> {
  return serviceWorker.evaluate(async keyList => {
    if (!keyList?.length) return chrome.storage.sync.get(null)
    return chrome.storage.sync.get(keyList)
  }, keys)
}

/**
 * Simulate browser restart: close the persistent context and reopen the same
 * user-data dir so chrome.storage.sync and the unpacked extension reload.
 * Timing budget: up to 30s for the new service worker after relaunch.
 */
export async function relaunchExtensionContext(
  previous: LaunchedExtension,
): Promise<LaunchedExtension> {
  const { userDataDir, videoDir } = previous
  await previous.context.close().catch(() => undefined)
  fs.rmSync(videoDir, { recursive: true, force: true })
  return launchExtensionContext({ userDataDir })
}

export async function closeExtensionContext(
  launched: LaunchedExtension,
  options?: { retainUserDataDir?: boolean; retainVideoDir?: boolean },
): Promise<void> {
  await launched.context.close().catch(() => undefined)
  const removeQuietly = (dir: string) => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      // Windows often locks Chromium profile/video dirs briefly after close.
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : ''
      if (code !== 'EPERM' && code !== 'EBUSY') throw err
    }
  }
  if (!options?.retainUserDataDir) {
    removeQuietly(launched.userDataDir)
  }
  if (!options?.retainVideoDir) {
    removeQuietly(launched.videoDir)
  }
}
