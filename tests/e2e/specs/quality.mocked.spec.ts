import { test, expect } from '../helpers/testFixtures.ts'
import {
  assertExactlyOnePulseRoot,
  assertNoUncaughtErrors,
  assertProductionManifestPermissions,
  waitForPulseRoot,
} from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

test.describe('extension quality guards', () => {
  test('packaged shared settings host renders independently of manifest navigation', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    const host = await extension.context.newPage()
    await host.goto(`chrome-extension://${extension.extensionId}/options/index.html`)
    await expect(host).toHaveURL(/options\/index\.html#moments$/)
    await expect(host.getByRole('heading', { name: 'My Moments', exact: true })).toBeVisible()
    await host.getByRole('link', { name: 'Pulse on Twitch' }).click()
    const workspace = host.locator('[data-settings-workspace="true"]')
    await expect(workspace).toBeVisible()
    await expect(host).toHaveURL(/options\/index\.html#pulse$/)
    await expect(workspace.locator('[data-settings-section="pulse"]')).toContainText('Pulse on Twitch')
    await expect(workspace.locator('[data-settings-section]')).toHaveCount(1)

    const nav = host.getByRole('navigation', { name: 'Settings sections' })
    await nav.getByRole('link', { name: 'Privacy & Data' }).click()
    await expect(workspace.locator('[data-settings-section="privacy"]')).toContainText('Privacy & Data')
    await nav.getByRole('link', { name: 'Updates & Changelog' }).click()
    await expect(workspace.locator('[data-settings-section="updates"]')).toContainText('Updates & Changelog')

    await host.goto(`chrome-extension://${extension.extensionId}/options/index.html#unknown`)
    await expect(host).toHaveURL(/options\/index\.html#moments$/)
    await expect(host.getByRole('heading', { name: 'My Moments', exact: true })).toBeVisible()
    await host.close()
  })

  test('production dist manifest permissions match the intentional allow-list', async () => {
    // Documents localhost:8081 as intentional local BFF opt-in; forbids :8090 / :9876.
    assertProductionManifestPermissions()
  })

  test('no uncaught page or service-worker errors on live-ready path', async ({
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

  test('no duplicate pulse-channel polling storm under short observation window', async ({
    extension,
    prepare,
    api,
    evidence,
  }) => {
    // pollIntervalMs=15s is the minimum product option. Observation window is 8s
    // (less than one interval) so we expect an initial fetch burst only — not a loop.
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: { pollIntervalMs: 15_000, autoUpdateEnabled: true },
    })
    api.resetRequestLog()
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await extension.page.waitForTimeout(8_000)
    const count = api.pulseChannelRequestCount()
    const sample = api
      .requests()
      .filter(r => /\/v1\/extension\/pulse\/channels\//.test(r.url()))
      .slice(0, 8)
      .map(r => r.url())
    // Initial channel load may hit pulse once (or a few times with coverage/revalidate).
    // A runaway loop would be dozens/thousands of requests in 8s.
    expect(
      count,
      `pulse channel requests in 8s: ${count}; sample=${JSON.stringify(sample)}`,
    ).toBeGreaterThanOrEqual(1)
    expect(
      count,
      `pulse channel requests in 8s: ${count}; sample=${JSON.stringify(sample)}`,
    ).toBeLessThanOrEqual(8)
    assertNoUncaughtErrors(evidence)
  })
})
