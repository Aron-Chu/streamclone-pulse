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

function parseClock(value: string): number {
  const parts = value.split(':').map(Number)
  if (parts.some(part => !Number.isFinite(part))) return 0
  if (parts.length === 3) return parts[0] * 3_600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] ?? 0
}

function readRailWindow(value: string | null): { start: number; end: number } | null {
  const match = value?.match(/Viewing minutes\s+([0-9:]+)\s*[–-]\s*([0-9:]+)\s+of/)
  if (!match) return null
  return { start: parseClock(match[1]), end: parseClock(match[2]) }
}

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

  test('switching to Chat restores Twitch input and hands focus to it', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: { sidebarTab: 'pulse', defaultChartWindowMigratedToRecentV2: true },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const chatTab = extension.page.getByRole('tab', { name: 'Chat', exact: true })
    const pulseTab = extension.page.getByRole('tab', { name: 'Pulse', exact: true })
    const composer = extension.page.locator('[data-a-target="chat-input"] textarea')
    await expect(chatTab).toBeVisible()
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await chatTab.click()
      await expect(composer).toBeFocused({ timeout: 5_000 })
      await expect(pulseTab).toHaveAttribute('aria-selected', 'false')

      await pulseTab.click()
      await expect(pulseTab).toHaveAttribute('aria-selected', 'true')
      await expect(composer).not.toBeFocused()
      // Switching the body must not discard the activation's Full source or
      // leave the user looking at a blank/recent fallback chart.
      await assertPulseShadowContains(extension.page, /Full stream|Available coverage|Range/i)
    }
    assertNoUncaughtErrors(evidence)
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
        defaultChartWindowMigratedToRecentV2: true,
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

  test('chart range can move through every preset and return from one hour to full stream', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        defaultChartWindow: 'full',
        defaultChartWindowMigratedToRecentV2: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const expectedRanges = [
      ['15 min', 900],
      ['30 min', 1800],
      ['1 hour', 3600],
      ['2 hours', 7200],
      ['4 hours', 14400],
      ['Full stream', null],
      ['1 hour', 3600],
      ['Full stream', null],
    ] as const
    const trigger = extension.page.getByRole('combobox', { name: 'Chart time range' })
    const viewport = extension.page.locator('[data-chart-viewport-controls="true"]')

    for (const [label, expectedDuration] of expectedRanges) {
      await selectChartRangeOption(extension.page, label)
      await expect(trigger).toContainText(label)
      await expect(viewport).toBeVisible()
      await expect.poll(async () => {
        const text = await viewport.locator('[data-chart-rail]').getAttribute('aria-valuetext')
        const window = readRailWindow(text)
        return window ? window.end - window.start : 0
      }).toBe(expectedDuration == null ? 3660 : Math.min(expectedDuration, 3660))
    }

    const rangeText = () => viewport.locator('[data-chart-rail]').getAttribute('aria-valuetext')
    const readStart = async () => {
      const window = readRailWindow(await rangeText())
      return window?.start ?? 0
    }
    const fullStart = await readStart()
    await selectChartRangeOption(extension.page, '1 hour')
    const oneHourStart = await readStart()
    expect(oneHourStart).toBeGreaterThan(fullStart)
    await selectChartRangeOption(extension.page, 'Full stream')
    expect(await readStart()).toBe(fullStart)
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
        defaultChartWindowMigratedToRecentV2: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const trigger = extension.page.getByRole('combobox', { name: 'Chart time range' })
    await expect(trigger).toBeVisible()
    await trigger.focus()
    await trigger.press('ArrowDown')
    const fullStreamOption = extension.page.getByRole('option', { name: 'Full stream', exact: true })
    await expect(fullStreamOption).toBeVisible()
    const firstListbox = await extension.page.getByRole('listbox').boundingBox()
    const firstViewport = extension.page.viewportSize()
    expect(firstListbox).not.toBeNull()
    expect(firstListbox!.x).toBeGreaterThanOrEqual(0)
    expect(firstListbox!.y).toBeGreaterThanOrEqual(0)
    expect(firstListbox!.x + firstListbox!.width).toBeLessThanOrEqual(firstViewport!.width)
    expect(firstListbox!.y + firstListbox!.height).toBeLessThanOrEqual(firstViewport!.height)
    await trigger.press('Home')
    await trigger.press('ArrowDown')
    await trigger.press('Enter')

    await expect(trigger).toContainText('30 min')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()

    await extension.page.locator('#streamclone-pulse-root .pulse-shell').evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    const scrolledListbox = await extension.page.getByRole('listbox').boundingBox()
    const scrolledViewport = extension.page.viewportSize()
    expect(scrolledListbox).not.toBeNull()
    expect(scrolledListbox!.x).toBeGreaterThanOrEqual(0)
    expect(scrolledListbox!.y).toBeGreaterThanOrEqual(0)
    expect(scrolledListbox!.x + scrolledListbox!.width).toBeLessThanOrEqual(scrolledViewport!.width)
    expect(scrolledListbox!.y + scrolledListbox!.height).toBeLessThanOrEqual(scrolledViewport!.height)
    await trigger.press('Escape')
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

  test('overlay settings keep session state inline and hand off to the secure page', async ({
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
        defaultChartWindowMigratedToRecentV2: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await extension.page.getByRole('button', { name: 'Open settings' }).click()
    // Everyday controls and a compact current-release preview stay in Twitch;
    // complete history and administrative controls live on the advanced page.
    const settings = extension.page.locator('[data-overlay-settings-panel="true"]')
    await expect(settings).toBeVisible()
    await expect(settings.locator('[data-api-status]')).toBeVisible()
    await expect(settings.locator('[data-sampler-status]')).toBeVisible()
    await expect(settings.getByText('Remember recently opened channels')).toHaveCount(0)
    await expect(settings.locator('[data-settings-section]')).toHaveCount(0)
    await expect(settings.locator('input[type="password"]')).toHaveCount(0)
    const releasePreview = settings.locator('[data-changelog-preview="true"]')
    await expect(releasePreview).toBeVisible()
    await expect(releasePreview).not.toHaveAttribute('open', '')
    await expect(releasePreview.locator('li')).toHaveCount(3)

    // Quick controls persist immediately.
    const autoUpdate = settings.getByRole('checkbox', { name: /Refresh live data automatically|Auto-update/ })
    await autoUpdate.click()
    await expect.poll(async () => {
      const stored = await readExtensionStorage(extension.serviceWorker, ['autoUpdateEnabled'])
      return stored.autoUpdateEnabled
    }).toBe(false)

    const volt = settings.getByRole('button', { name: 'Volt', exact: true })
    await expect(volt).toHaveAttribute('aria-pressed', 'false')
    await volt.click()
    await expect(volt).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => {
      const stored = await readExtensionStorage(extension.serviceWorker, ['themePreference'])
      return stored.themePreference
    }).toBe('volt')
    await expect.poll(() => extension.page.evaluate(() => document.documentElement.getAttribute('data-pulse-accent'))).toBe('volt')

    const dock = settings.getByRole('checkbox', { name: 'Dock when chat is closed' })
    await dock.click()
    await expect.poll(async () => {
      const stored = await readExtensionStorage(extension.serviceWorker, ['chatClosedPulseDockEnabled'])
      return stored.chatClosedPulseDockEnabled
    }).toBe(true)

    await settings.getByRole('button', { name: 'Right dock', exact: true }).click()
    await expect.poll(async () => {
      const stored = await readExtensionStorage(extension.serviceWorker, ['overlayPlacement'])
      return stored.overlayPlacement
    }).toBe('right')

    // The native disclosure expands without another settings implementation.
    await releasePreview.locator('summary').click()
    await expect(releasePreview).toHaveAttribute('open', '')
    await expect(settings.locator('[data-settings-host-cta="updates"]')).toBeVisible()
    const settingsHost = extension.context.waitForEvent('page')
    await settings.getByRole('button', { name: /View full changelog/ }).click()
    const hostPage = await settingsHost
    await hostPage.waitForLoadState('domcontentloaded')
    await expect(hostPage).toHaveURL(new RegExp(`/options/index\\.html#updates$`))
    await expect(hostPage.locator('[data-settings-surface="internal-host"]')).toBeVisible()
    await expect(hostPage.locator('[data-settings-section="updates"]')).toBeVisible()
    await expect(hostPage.locator('[data-settings-section]')).toHaveCount(1)
    await expect(hostPage.getByText('Extension settings', { exact: true })).toBeVisible()
    await expect(hostPage.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
    await expect(hostPage.locator('img.pulse-host-mark')).toHaveAttribute('src', /icons\/icon128\.png$/)
    await expect(hostPage.locator('.pulse-host-nav [aria-current="page"]')).toHaveCount(1)
    await expect(hostPage.getByRole('link', { name: 'Updates & Changelog' })).toHaveAttribute('aria-current', 'page')
    await expect(hostPage.getByText('Installed version', { exact: true })).toBeVisible()
    await expect(hostPage.locator('.pulse-changelog-release')).toHaveCount(3)

    // The complete page owns the superset, and shared storage changes are reflected
    // by the already-open Twitch quick controls without reloading either surface.
    await hostPage.getByRole('link', { name: 'Pulse on Twitch', exact: true }).click()
    await expect(hostPage).toHaveURL(new RegExp(`/options/index\\.html#pulse$`))
    await expect(hostPage.locator('[data-settings-section="pulse"]')).toBeVisible()
    await expect(hostPage.getByText('Refresh live data automatically', { exact: true })).toBeVisible()
    // Chart range is a live chart control, not a persisted full-settings
    // preference. Keep the secure settings hand-off focused on settings-owned
    // controls so this test does not regress when chart state changes.
    await expect(hostPage.getByText('Default chart range', { exact: true })).toHaveCount(0)
    await expect(hostPage.getByRole('group', { name: 'Accent theme' })).toBeVisible()
    await expect(hostPage.getByRole('group', { name: 'Overlay placement' })).toBeVisible()
    await expect(hostPage.getByText('Dock when chat is closed', { exact: true })).toBeVisible()
    await hostPage.getByRole('button', { name: /Azure/ }).click()
    await expect(settings.getByRole('button', { name: 'Azure', exact: true })).toHaveAttribute('aria-pressed', 'true')

    await hostPage.getByRole('link', { name: 'Privacy & Data', exact: true }).click()
    await expect(hostPage).toHaveURL(new RegExp(`/options/index\\.html#privacy$`))
    await expect(hostPage.getByText(/Cache recently viewed channel data|Remember recently opened channels/)).toBeVisible()
    await expect(hostPage.locator('input[type="password"]')).toHaveCount(0)
    await hostPage.close()
  })

  test('most reacted sort accepts pointer selection', async ({ extension, prepare }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayPlacement: 'sidebar',
        overlayMode: 'expanded',
        sidebarTab: 'pulse',
        defaultChartWindowMigratedToRecentV2: true,
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
        defaultChartWindowMigratedToRecentV2: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await expect(extension.page.locator('#streamclone-pulse-root')).toHaveAttribute('data-streampulse-styles', 'loaded')

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

  test('mini settings opens the overlay session panel and returns to Pulse', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayPlacement: 'right',
        overlayMode: 'mini',
        defaultChartWindowMigratedToRecentV2: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const miniDock = extension.page.getByRole('region', { name: 'StreamPulse mini dock' })
    await miniDock.getByRole('button', { name: 'Open settings' }).click()
    const settings = extension.page.locator('[data-overlay-settings-panel="true"]')
    await expect(settings).toBeVisible()
    const releasePreview = settings.locator('[data-changelog-preview="true"]')
    await expect(releasePreview).not.toHaveAttribute('open', '')
    const settingsShell = extension.page.locator('#streamclone-pulse-root section[aria-label="StreamPulse overlay"]')
    await expect(settingsShell).toBeVisible()
    await expect(settingsShell).toHaveScreenshot('overlay-settings-panel.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.04,
    })
    await releasePreview.locator('summary').click()
    await expect(settings.locator('[data-settings-host-cta="updates"]')).toBeVisible()
    await settings.getByRole('button', { name: 'Back to Pulse' }).click()
    await expect(extension.page.getByRole('combobox', { name: 'Chart time range' })).toBeVisible()
  })

  test('packaged internal host mounts the shared workspace with stable keyboard order', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    const host = await extension.context.newPage()
    await host.setViewportSize({ width: 1000, height: 720 })
    await host.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)

    const workspace = host.locator('[data-settings-workspace="true"]')
    await expect(workspace).toBeVisible()
    await expect(host).toHaveURL(new RegExp(`/options/index\\.html#pulse$`))
    await expect(workspace.locator('[data-settings-section="pulse"]')).toBeVisible()
    await expect(workspace.locator('[data-settings-section]')).toHaveCount(1)
    await expect(workspace.locator('[data-developer-tools="true"]')).toHaveCount(0)
    const skipLink = host.getByRole('link', { name: 'Skip to settings' })
    await expect(skipLink).toBeVisible()
    // Exactly one h1 on the page, owned by the brand bar.
    await expect(host.locator('h1')).toHaveCount(1)
    await expect(host.locator('h1')).toHaveText('StreamPulse')
    await expect(host.locator('main#settings-content')).toHaveCount(1)
    await expect(workspace.getByRole('button', { name: 'Test', exact: true })).toHaveCount(0)

    // Designed page order: skip link first, then the section navigation, then the
    // content. The skip link exists precisely so keyboard users can bypass the nav.
    const sectionNav = host.getByRole('navigation', { name: 'Settings sections' })
    await expect(sectionNav).toBeVisible()
    await expect(sectionNav.getByRole('link', { name: 'Pulse on Twitch' })).toHaveAttribute('aria-current', 'page')
    await expect(sectionNav.locator('[aria-current="page"]')).toHaveCount(1)
    await host.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await host.keyboard.press('Tab')
    await expect(skipLink).toBeFocused()
    await host.keyboard.press('Tab')
    await expect(sectionNav.getByRole('link').first()).toBeFocused()

    await skipLink.focus()
    await skipLink.press('Enter')
    await expect(host.locator('main#settings-content')).toBeFocused()

    await sectionNav.getByRole('link', { name: 'Updates & Changelog' }).click()
    await expect(host).toHaveURL(new RegExp(`/options/index\\.html#updates$`))
    await expect(workspace.locator('[data-settings-section="updates"]')).toBeVisible()
    await expect(workspace.locator('[data-settings-section]')).toHaveCount(1)
    const releases = workspace.locator('.pulse-changelog-release')
    await expect(releases).toHaveCount(3)
    const latestRelease = releases.nth(0)
    const olderRelease = releases.nth(1)
    await expect(latestRelease).toHaveAttribute('data-changelog-open', 'true')
    await expect(olderRelease).toHaveAttribute('data-changelog-open', 'false')
    const olderToggle = olderRelease.getByRole('button')
    await expect(olderToggle).toHaveAttribute('aria-expanded', 'false')
    const olderReveal = olderRelease.locator('.pulse-changelog-reveal')
    await expect(olderToggle).toHaveAttribute('aria-controls', await olderReveal.getAttribute('id') ?? '')
    await expect(olderReveal).toHaveAttribute('aria-hidden', 'true')
    await expect(olderReveal).toHaveCSS('visibility', 'hidden')
    const revealTransition = await olderReveal.evaluate(element => getComputedStyle(element).transitionDuration)
    expect(revealTransition).not.toBe('0s')
    await olderToggle.click()
    await expect(olderToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(olderRelease).toHaveAttribute('data-changelog-open', 'true')
    await expect(olderReveal).toHaveAttribute('aria-hidden', 'false')
    await expect(olderReveal).toHaveCSS('visibility', 'visible')
    await olderToggle.click()
    await expect(olderRelease).toHaveAttribute('data-changelog-open', 'false')
    await host.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(async () => olderReveal.evaluate(element => Number.parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(0.001)
    await host.emulateMedia({ reducedMotion: 'no-preference' })

    await expect(host.locator('.pulse-host')).toHaveScreenshot('full-settings-changelog.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.04,
    })

    // Visual coverage for the complete page shell and its responsive top nav.
    await sectionNav.getByRole('link', { name: 'Pulse on Twitch' }).click()
    await host.evaluate(() => window.scrollTo(0, 0))
    await expect(host.locator('.pulse-host')).toHaveScreenshot('settings-host-page.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.04,
    })
    await host.setViewportSize({ width: 620, height: 820 })
    await expect.poll(() => sectionNav.evaluate(element => getComputedStyle(element).position)).toBe('static')
    await expect(host.locator('.pulse-host')).toHaveScreenshot('settings-host-page-narrow.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.04,
    })
    await host.setViewportSize({ width: 1000, height: 720 })

    // Browser history restores both the hash and the focused section.
    await sectionNav.getByRole('link', { name: 'Privacy & Data' }).click()
    await expect(workspace.locator('[data-settings-section="privacy"]')).toBeVisible()
    await host.goBack()
    await expect(host).toHaveURL(new RegExp(`#pulse$`))
    await expect(workspace.locator('[data-settings-section="pulse"]')).toBeVisible()
    await host.goForward()
    await expect(host).toHaveURL(new RegExp(`#privacy$`))
    await expect(workspace.locator('[data-settings-section="privacy"]')).toBeVisible()

    // Development tools exist only behind the development-only section.
    await sectionNav.getByRole('link', { name: 'Developer' }).click()
    await expect(workspace.locator('[data-developer-tools="true"]')).toBeVisible()

    // The document remains the one normal scroll owner.
    await expect.poll(() => host.locator('.pulse-host-main').evaluate(element => getComputedStyle(element).overflowY)).not.toMatch(/auto|scroll/)
    expect(await host.evaluate(() => document.scrollingElement === document.documentElement)).toBe(true)
    await host.close()
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
        defaultChartWindowMigratedToRecentV2: true,
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
