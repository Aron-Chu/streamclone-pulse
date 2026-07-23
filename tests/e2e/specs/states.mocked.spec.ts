import { test, expect } from '../helpers/testFixtures.ts'
import {
  assertExactlyOnePulseRoot,
  assertGameDividersSpanPlot,
  assertNoPulseVodDiscoverWarnings,
  assertNoUncaughtErrors,
  assertPulseShadowContains,
  selectChartRangeOption,
  waitForPulseRoot,
} from '../helpers/assertions.ts'
import { readExtensionStorage } from '../helpers/extensionContext.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'

test.describe('extension mocked states', () => {
  test('live ready shows Pulse overlay with tracked live content', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Pulse|Chat tracked|Just Chatting|fixturechan/i)
    assertNoUncaughtErrors(evidence)
    assertNoPulseVodDiscoverWarnings(evidence)
  })

  test('live ready game dividers span viewers through emote lane', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /League of Legends|Just Chatting/i)
    await assertGameDividersSpanPlot(extension.page)
    assertNoUncaughtErrors(evidence)
  })

  test('live ready chart range change stays free of storage/SVG console noise', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        defaultChartWindow: 'full',
        defaultChartWindowMigratedToFullV1: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Range|Full|30|Games played|Pulse/i)

    await selectChartRangeOption(extension.page, '30 min')

    // Give hydration + resize a beat, then assert no storage/context/SVG noise.
    await extension.page.waitForTimeout(750)
    assertNoUncaughtErrors(evidence)
  })

  test('chart range supports keyboard selection and restores trigger focus', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        defaultChartWindow: 'full',
        defaultChartWindowMigratedToFullV1: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const trigger = extension.page.getByRole('combobox', { name: 'Chart time range' })
    await expect(trigger).toBeVisible()
    await trigger.focus()
    await trigger.press('ArrowDown')
    await expect(extension.page.getByRole('option', { name: 'Full stream', exact: true })).toBeVisible()
    await trigger.press('Home')
    await trigger.press('ArrowDown')
    await trigger.press('Enter')

    await expect(trigger).toContainText('30 min')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
  })

  test('chart range closes when keyboard focus leaves the control', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const trigger = extension.page.getByRole('combobox', { name: 'Chart time range' })
    await trigger.focus()
    await trigger.press('ArrowDown')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await trigger.press('Tab')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).not.toBeFocused()
  })

  test('sidebar settings default range uses pointer input and persists', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayPlacement: 'sidebar',
        overlayMode: 'expanded',
        sidebarTab: 'pulse',
        defaultChartWindow: 'full',
        defaultChartWindowMigratedToFullV1: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await extension.page.getByRole('button', { name: 'Open settings' }).click()
    const trigger = extension.page.getByRole('combobox', { name: 'Default chart range' })
    await expect(trigger).toBeVisible()
    await trigger.click()
    await extension.page.getByRole('option', { name: '2h', exact: true }).click()

    await expect(trigger).toContainText('2h')
    await expect.poll(async () => {
      const stored = await readExtensionStorage(extension.serviceWorker, ['defaultChartWindow'])
      return stored.defaultChartWindow
    }).toBe('2h')
  })

  test('most reacted sort accepts pointer selection', async ({ extension, prepare }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayPlacement: 'sidebar',
        overlayMode: 'expanded',
        sidebarTab: 'pulse',
        defaultChartWindowMigratedToFullV1: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const trigger = extension.page.getByRole('combobox', { name: 'Sort most reacted moments' })
    await trigger.scrollIntoViewIfNeeded()
    await expect(trigger).toBeVisible()
    await trigger.click()
    await extension.page.getByRole('option', { name: 'Chat activity', exact: true }).click()

    await expect(trigger).toContainText('Chat activity')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('mini hide keeps placement and exposes a reopenable pill', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayPlacement: 'right',
        overlayMode: 'mini',
        defaultChartWindowMigratedToFullV1: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const miniDock = extension.page.getByRole('region', { name: 'StreamPulse mini dock' })
    await expect(miniDock).toBeVisible()
    await expect(miniDock.getByRole('button', { name: 'Open settings' })).toBeVisible()
    await expect(miniDock.getByRole('button', { name: 'Expand panel' })).toBeVisible()
    await miniDock.getByRole('button', { name: 'Hide overlay' }).click()

    const openPill = extension.page.getByRole('button', { name: 'Open Pulse panel' })
    await expect(openPill).toBeVisible()
    await expect.poll(async () => {
      const stored = await readExtensionStorage(extension.serviceWorker, [
        'overlayPlacement',
        'overlayMode',
      ])
      return `${stored.overlayPlacement}:${stored.overlayMode}`
    }).toBe('right:collapsed')

    await openPill.click()
    await expect(extension.page.getByRole('combobox', { name: 'Chart time range' })).toBeVisible()
    await expect.poll(async () => {
      const stored = await readExtensionStorage(extension.serviceWorker, [
        'overlayPlacement',
        'overlayMode',
      ])
      return `${stored.overlayPlacement}:${stored.overlayMode}`
    }).toBe('right:expanded')
  })

  test('mini settings opens options and expand returns to the panel', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayPlacement: 'right',
        overlayMode: 'mini',
        defaultChartWindowMigratedToFullV1: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const miniDock = extension.page.getByRole('region', { name: 'StreamPulse mini dock' })
    const optionsPagePromise = extension.context.waitForEvent('page')
    await miniDock.getByRole('button', { name: 'Open settings' }).click()
    const optionsPage = await optionsPagePromise
    await expect(optionsPage).toHaveURL(/options\/index\.html/)
    await optionsPage.close()

    await miniDock.getByRole('button', { name: 'Expand panel' }).click()
    await expect(extension.page.getByRole('combobox', { name: 'Chart time range' })).toBeVisible()
  })

  test('legacy hidden placement migrates to a collapsed sidebar pill', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayPlacement: 'hidden',
        overlayMode: 'expanded',
        sidebarTab: 'pulse',
        defaultChartWindowMigratedToFullV1: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await expect(extension.page.getByRole('button', { name: 'Open Pulse panel' })).toBeVisible()
    await expect.poll(async () => {
      const stored = await readExtensionStorage(extension.serviceWorker, [
        'overlayPlacement',
        'overlayMode',
      ])
      return `${stored.overlayPlacement}:${stored.overlayMode}`
    }).toBe('sidebar:collapsed')
  })

  test('live partial / starting surfaces not-tracked / starting copy', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-partial', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    // Hosted + warming tier shows the not-tracked live path (starting / not yet IRC-active).
    await assertPulseShadowContains(extension.page, /Not tracked|IRC pool|Partial|Warming|tracking/i)
    assertNoUncaughtErrors(evidence)
  })

  test('Helix unavailable is visible without crashing the overlay', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'helix-off', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Helix|Pulse|fixturechan/i)
    assertNoUncaughtErrors(evidence)
  })

  test('offline channel renders offline / recap path', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'offline', twitchKind: 'offline' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /offline|Recap|Past|fixturechan/i)
    assertNoUncaughtErrors(evidence)
  })

  test('VOD ready mounts Replay Pulse', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Replay|VOD|ready|Pulse|Chat spike/i)
    assertNoUncaughtErrors(evidence)
  })

  test('VOD syncing shows syncing status', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'vod-syncing', twitchKind: 'vod' })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /sync|Syncing|Replay|Pulse/i)
    assertNoUncaughtErrors(evidence)
  })

  test('API 500 does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'api-500', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    // Overlay may show error/empty state; page must stay stable.
    expect(evidence.pageErrors).toEqual([])
  })

  test('API timeout does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'timeout', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    expect(evidence.pageErrors).toEqual([])
  })

  test('malformed JSON response does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'malformed', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    expect(evidence.pageErrors).toEqual([])
  })
})
