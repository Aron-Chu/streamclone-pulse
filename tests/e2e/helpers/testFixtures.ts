import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from '@playwright/test'
import {
  closeExtensionContext,
  launchExtensionContext,
  seedExtensionStorage,
  type ExtensionStorageSeed,
  type LaunchedExtension,
} from './extensionContext.ts'
import { installEvidenceCollectors, type EvidenceCollectors } from './evidence.ts'
import { installMockApi, type ApiScenario, type MockApiController } from './mockApi.ts'
import { installTwitchFixtures, type TwitchFixtureKind } from './mockTwitch.ts'

export type ExtensionTestFixtures = {
  extension: LaunchedExtension
  api: MockApiController
  evidence: EvidenceCollectors
  prepare: (options?: {
    scenario?: ApiScenario
    twitchKind?: TwitchFixtureKind
    storage?: ExtensionStorageSeed
  }) => Promise<void>
}

export const test = base.extend<ExtensionTestFixtures>({
  extension: async ({}, use, testInfo) => {
    const launched = await launchExtensionContext()
    await use(launched)
    const failed = testInfo.status !== testInfo.expectedStatus
    // Close context first so recordVideo finalizes .webm files.
    await closeExtensionContext(launched, { retainVideoDir: failed })
    if (failed) {
      const videos = fs.existsSync(launched.videoDir)
        ? fs.readdirSync(launched.videoDir).filter(name => name.endsWith('.webm'))
        : []
      for (const name of videos) {
        const full = path.join(launched.videoDir, name)
        await testInfo.attach(name, { path: full, contentType: 'video/webm' })
      }
      fs.rmSync(launched.videoDir, { recursive: true, force: true })
    }
  },

  api: async ({ extension }, use) => {
    const api = await installMockApi(extension.context, 'live-ready')
    await use(api)
    await api.dispose()
  },

  evidence: async ({ extension }, use, testInfo) => {
    const evidence = installEvidenceCollectors(
      extension.context,
      extension.page,
      extension.serviceWorker,
    )
    await use(evidence)
    if (testInfo.status !== testInfo.expectedStatus) {
      await evidence.attachAll(testInfo)
      const shot = testInfo.outputPath('pulse-failure.png')
      await extension.page.screenshot({ path: shot, fullPage: true }).catch(() => undefined)
      if (fs.existsSync(shot)) {
        await testInfo.attach('pulse-failure.png', { path: shot, contentType: 'image/png' })
      }
    }
    evidence.dispose()
  },

  prepare: async ({ extension, api }, use) => {
    const prepare = async (options?: {
      scenario?: ApiScenario
      twitchKind?: TwitchFixtureKind
      storage?: ExtensionStorageSeed
    }) => {
      api.setScenario(options?.scenario ?? 'live-ready')
      await installTwitchFixtures(extension.context, {
        kind: options?.twitchKind ?? 'live',
        login: 'fixturechan',
        vodId: '2806037629',
      })
      await seedExtensionStorage(extension.serviceWorker, options?.storage)
    }
    await use(prepare)
  },
})

export { expect }
