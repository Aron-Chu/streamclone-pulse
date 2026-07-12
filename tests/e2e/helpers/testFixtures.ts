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
  extension: async ({}, use) => {
    const launched = await launchExtensionContext()
    await use(launched)
    await closeExtensionContext(launched)
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
