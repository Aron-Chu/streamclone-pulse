import { test, expect } from '../helpers/testFixtures.ts'
import {
  assertExactlyOnePulseRoot,
  assertNoUncaughtErrors,
  assertNoSelectedMomentActions,
  assertPulseChartPresent,
  assertPulseShadowContains,
  assertSelectedMomentActions,
  PULSE_ROOT_ID,
  PULSE_TABS_ID,
  pulseShadowText,
  selectFirstMostReactedMoment,
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
import { installTwitchFixtures, openTwitchChannel, spaNavigate, spaNavigateUrlOnly } from '../helpers/mockTwitch.ts'
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

  test('URL-only channel hop under chat churn activates within 2s with one host pair', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page, 'fixturechan')
    await waitForPulseRoot(extension.page)

    await extension.page.evaluate(() => {
      const chat = document.querySelector('[data-a-target="chat-scroller"]') ?? document.body
      const id = window.setInterval(() => {
        const node = document.createElement('div')
        node.setAttribute('data-a-target', 'chat-line-message')
        node.textContent = `churn-${Date.now()}`
        chat.appendChild(node)
      }, 60)
      ;(window as unknown as { __pulseChatChurnId?: number }).__pulseChatChurnId = id
    })

    try {
      await spaNavigateUrlOnly(extension.page, { kind: 'channel', login: 'otherchan' })
      await expect
        .poll(async () => extension.page.url(), { timeout: 2_000 })
        .toContain('/otherchan')
      await waitForPulseRoot(extension.page, 2_000)
      await assertExactlyOnePulseRoot(extension.page)
      await assertPulseShadowContains(extension.page, /Minecraft|Other channel|Live|Pulse/i)
    } finally {
      await extension.page.evaluate(() => {
        const id = (window as unknown as { __pulseChatChurnId?: number }).__pulseChatChurnId
        if (id != null) window.clearInterval(id)
      })
    }
  })

  test('stale channel-A pulse does not remount after navigation to directory', async ({
    extension,
    prepare,
    api,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page, 'fixturechan')
    await waitForPulseRoot(extension.page)

    let releaseA: (() => void) | null = null
    const holdA = new Promise<void>(resolve => {
      releaseA = resolve
    })
    await extension.context.route(
      '**/v1/extension/pulse/channels/fixturechan**',
      async route => {
        await holdA
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            login: 'fixturechan',
            streamId: 'stale-a',
            title: 'STALE_CHANNEL_A_PAYLOAD',
            isLive: true,
            tracking: true,
            rollups: [],
            peaks: [],
            games: [],
          }),
        })
      },
    )

    await spaNavigate(extension.page, { kind: 'channel', login: 'fixturechan' }, 'live')
    await spaNavigateUrlOnly(extension.page, { kind: 'directory' })
    releaseA?.()
    await extension.page.waitForTimeout(800)
    await expect(extension.page.locator('#streamclone-pulse-root')).toHaveCount(0)
    await expect(extension.page.locator('#streamclone-pulse-tabs')).toHaveCount(0)
    void api
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

  test('rapid live, VOD, offline, and channel switches never leak stale analytics', async ({
    extension,
    prepare,
    evidence,
    api,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Fixture live stream|Most Reacted/i)
    await assertPulseChartPresent(extension.page)
    await selectFirstMostReactedMoment(extension.page)
    await assertSelectedMomentActions(extension.page)

    api.setScenario('offline')
    await spaNavigate(extension.page, { kind: 'channel', login: 'fixturechan' }, 'offline')
    await expect
      .poll(async () => pulseShadowText(extension.page), { timeout: 2_500 })
      .toMatch(/9K messages|9,000 messages|Peak chat\s*220/i)
    await assertNoSelectedMomentActions(extension.page)

    api.setScenario('live-ready')
    await spaNavigate(extension.page, { kind: 'channel', login: 'fixturechan' }, 'live')
    await expect
      .poll(async () => pulseShadowText(extension.page), { timeout: 2_500 })
      .toMatch(/Most Reacted So Far|Live now/i)
    await assertPulseChartPresent(extension.page)

    api.setScenario('vod-ready')
    await spaNavigate(extension.page, { kind: 'vod', vodId: '2806037629' }, 'vod')
    await assertPulseShadowContains(extension.page, /Stream Recap|Top moments|Chat spike/i)
    await assertPulseChartPresent(extension.page)
    await selectFirstMostReactedMoment(extension.page)
    await assertSelectedMomentActions(extension.page)
    await assertExactlyOnePulseRoot(extension.page)

    api.setScenario('offline')
    await spaNavigate(extension.page, { kind: 'channel', login: 'fixturechan' }, 'offline')
    await assertPulseShadowContains(extension.page, /Channel offline|Previous stream|Recap|Past/i)
    await expect
      .poll(async () => pulseShadowText(extension.page), { timeout: 20_000 })
      .not.toMatch(/Fixture VOD ready|Replay Pulse ready|Jump in VOD/i)
    await assertNoSelectedMomentActions(extension.page)
    await assertExactlyOnePulseRoot(extension.page)

    api.setScenario('live-other')
    await spaNavigate(extension.page, { kind: 'channel', login: 'otherchan' }, 'live')
    await assertPulseShadowContains(extension.page, /Minecraft|Other channel peak/i)
    await expect
      .poll(async () => pulseShadowText(extension.page), { timeout: 20_000 })
      .not.toMatch(/Fixture VOD ready|Previous stream|Channel offline/i)
    await assertPulseChartPresent(extension.page)
    await selectFirstMostReactedMoment(extension.page)
    await assertSelectedMomentActions(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    assertNoUncaughtErrors(evidence)
  })

  test('reinjecting the content bundle disposes the prior lifecycle and keeps one host pair', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const probeLifecycle = async () => {
      return extension.serviceWorker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tabId = tabs[0]?.id
        if (tabId == null) throw new Error('no active tab')
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'ISOLATED',
          func: () => {
            const lifecycle = (
              window as Window & {
                __STREAMPULSE_CONTENT_LIFECYCLE__?: { dispose: () => void }
              }
            ).__STREAMPULSE_CONTENT_LIFECYCLE__
            return {
              hasLifecycle: typeof lifecycle?.dispose === 'function',
              roots: document.querySelectorAll('#streamclone-pulse-root').length,
              tabs: document.querySelectorAll('#streamclone-pulse-tabs').length,
            }
          },
        })
        return injection?.result ?? { hasLifecycle: false, roots: 0, tabs: 0 }
      })
    }

    const before = await probeLifecycle()
    expect(before.hasLifecycle).toBe(true)
    expect(before.roots).toBe(1)
    expect(before.tabs).toBe(1)

    await extension.serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const tabId = tabs[0]?.id
      if (tabId == null) throw new Error('no active tab')
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/twitch.js'],
      })
    })

    await expect.poll(async () => probeLifecycle()).toEqual({
      roots: 1,
      tabs: 1,
      hasLifecycle: true,
    })

    await spaNavigate(extension.page, { kind: 'channel', login: 'otherchan' }, 'live')
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    const afterNav = await probeLifecycle()
    expect(afterNav).toEqual({ roots: 1, tabs: 1, hasLifecycle: true })
    assertNoUncaughtErrors(evidence)
  })
})
