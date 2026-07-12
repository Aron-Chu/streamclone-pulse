import { test, expect } from '../helpers/testFixtures.ts'
import {
  assertExactlyOnePulseRoot,
  assertNoUncaughtErrors,
  assertPulseShadowContains,
  waitForPulseRoot,
} from '../helpers/assertions.ts'
import {
  closeExtensionContext,
  launchExtensionContext,
  readExtensionStorage,
  relaunchExtensionContext,
  seedExtensionStorage,
} from '../helpers/extensionContext.ts'
import { installMockApi } from '../helpers/mockApi.ts'
import { installTwitchFixtures, openTwitchChannel, spaNavigate } from '../helpers/mockTwitch.ts'
import { installEvidenceCollectors } from '../helpers/evidence.ts'

test.describe('extension lifecycle', () => {
  test('clean installation mounts a single Pulse root on first channel visit', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    assertNoUncaughtErrors(evidence)
  })

  test('persistent-profile browser relaunch preserves extension settings', async () => {
    // Same user-data dir across context close/reopen. This is a persistent-profile
    // relaunch — not a full Chrome shutdown / raw MV3 worker-termination simulation.
    // chrome.runtime.reload() is unreliable for Playwright serviceworker events.
    let launched = await launchExtensionContext()
    const api = await installMockApi(launched.context, 'live-ready')
    await installTwitchFixtures(launched.context, { kind: 'live', login: 'fixturechan' })
    await seedExtensionStorage(launched.serviceWorker, {
      themePreference: 'volt',
      overlayMode: 'expanded',
      sidebarTab: 'pulse',
      pollIntervalMs: 60_000,
    })

    const before = await readExtensionStorage(launched.serviceWorker, [
      'themePreference',
      'overlayMode',
      'sidebarTab',
      'backendUrl',
    ])
    expect(before.themePreference).toBe('volt')

    await openTwitchChannel(launched.page)
    await waitForPulseRoot(launched.page)

    await api.dispose()
    launched = await relaunchExtensionContext(launched)
    const api2 = await installMockApi(launched.context, 'live-ready')
    await installTwitchFixtures(launched.context, { kind: 'live', login: 'fixturechan' })
    const evidence = installEvidenceCollectors(
      launched.context,
      launched.page,
      launched.serviceWorker,
    )

    try {
      const after = await readExtensionStorage(launched.serviceWorker, [
        'themePreference',
        'overlayMode',
        'sidebarTab',
        'backendUrl',
      ])
      expect(after.themePreference).toBe('volt')
      expect(after.overlayMode).toBe('expanded')
      expect(after.sidebarTab).toBe('pulse')
      expect(String(after.backendUrl)).toContain('api.streampulse.stream')

      await openTwitchChannel(launched.page)
      await waitForPulseRoot(launched.page)
      await assertExactlyOnePulseRoot(launched.page)
      assertNoUncaughtErrors(evidence)
    } finally {
      evidence.dispose()
      await api2.dispose()
      await closeExtensionContext(launched)
    }
  })

  test('Twitch SPA navigation between channel and VOD keeps a single Pulse root', async ({
    extension,
    prepare,
    evidence,
    api,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)

    api.setScenario('vod-ready')
    await spaNavigate(extension.page, { kind: 'vod', vodId: '2806037629' }, 'vod')
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Replay|VOD|Pulse|sync|ready/i)

    api.setScenario('live-ready')
    await spaNavigate(extension.page, { kind: 'channel', login: 'fixturechan' }, 'live')
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    assertNoUncaughtErrors(evidence)
  })

  test('exactly one #streamclone-pulse-root after repeated SPA hops', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    for (let i = 0; i < 3; i += 1) {
      await spaNavigate(extension.page, { kind: 'vod', vodId: '2806037629' }, 'vod')
      await waitForPulseRoot(extension.page)
      await assertExactlyOnePulseRoot(extension.page)
      await spaNavigate(extension.page, { kind: 'channel', login: 'fixturechan' }, 'live')
      await waitForPulseRoot(extension.page)
      await assertExactlyOnePulseRoot(extension.page)
    }
  })
})
