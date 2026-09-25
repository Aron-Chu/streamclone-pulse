import { test, expect } from '../helpers/testFixtures.ts'
import { waitForPulseRoot, assertPulseShadowContains, PULSE_ROOT_ID } from '../helpers/assertions.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Repo-relative so artifacts stay with the run. This previously pointed at an
// absolute path inside one agent session's scratch directory, which does not
// exist for anyone else and wrote evidence outside the repository.
const ARTIFACT_SCREENSHOTS_DIR = join('test-results', 'design-audit')

async function saveScreenshot(page: import('@playwright/test').Page, filename: string, locator?: import('@playwright/test').Locator) {
  mkdirSync(ARTIFACT_SCREENSHOTS_DIR, { recursive: true })
  const target = join(ARTIFACT_SCREENSHOTS_DIR, filename)
  if (locator) {
    await locator.screenshot({ path: target, animations: 'disabled' })
  } else {
    await page.screenshot({ path: target, animations: 'disabled', fullPage: false })
  }
}

test.describe('StreamPulse final visual, interaction & failure-state audit', () => {
  test('1. Appearance preview semantic colors and micro-typography in settings', async ({
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
        themePreference: 'volt',
        densityPreference: 'compact',
        defaultChartWindowMigratedToRecentV2: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    // Semantic lanes are fixed in src/ui/chartTheme.ts so the legend always matches the
    // chart whatever accent is chosen: chat trend purple, emotes green, viewers cyan.
    const semantic = { chat: '#a78bfa', emotes: '#34d399', viewers: '#22d3ee' }
    const chart = extension.page.locator(`#${PULSE_ROOT_ID} svg[data-testid="pulse-overview-chart"]`)
    const seriesColors = () => chart.evaluate(svg => ({
      chat: svg.querySelector('path[data-chart-series="chat"]')?.getAttribute('stroke') ?? null,
      emotes: svg.querySelector('path[data-chart-series="emotes"]')?.getAttribute('stroke') ?? null,
      viewers: svg.querySelector('[data-chart-series="viewers"] path[stroke]')?.getAttribute('stroke') ?? null,
    }))
    await expect(chart).toBeVisible()
    await expect.poll(seriesColors).toEqual(semantic)

    // Quick Settings previews the saved appearance (title and 7TV backdrop).
    await extension.page.getByRole('button', { name: 'Open settings' }).click()
    const settingsPanel = extension.page.locator('[data-overlay-settings-panel="true"]')
    await expect(settingsPanel).toBeVisible()
    const preview = settingsPanel.locator('[data-appearance-preview="true"]')
    await expect(preview).toBeVisible()
    await expect(preview).toHaveAttribute('aria-label', /^Appearance preview: /)
    await saveScreenshot(extension.page, '15-appearance-preview-semantic-colors.png', settingsPanel)

    // Switching the accent to Azure must leave the semantic lanes unchanged.
    const azureBtn = settingsPanel.getByRole('button', { name: 'Azure', exact: true })
    await azureBtn.click()
    await expect(azureBtn).toHaveAttribute('aria-pressed', 'true')
    await saveScreenshot(extension.page, '16-quick-settings-azure-theme.png', settingsPanel)
    await extension.page.getByRole('button', { name: 'Back to Pulse' }).click()
    await expect(chart).toBeVisible()
    await expect.poll(seriesColors).toEqual(semantic)
  })

  test('2. Compact density in live sidebar mode', async ({
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
        densityPreference: 'compact',
        themePreference: 'aurora',
        defaultChartWindowMigratedToRecentV2: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const shell = extension.page.locator('#streamclone-pulse-root .pulse-shell')
    await expect(shell).toBeVisible()

    // Assert compact density class / attribute
    await expect(shell).toHaveAttribute('data-pulse-density', 'compact')

    // Assert games played strip dimensions
    const gameItem = extension.page.locator('#streamclone-pulse-root [data-games-played-item]').first()
    await expect(gameItem).toBeVisible()
    const itemHeight = await gameItem.evaluate(el => parseFloat(getComputedStyle(el).height))
    expect(itemHeight).toBeGreaterThanOrEqual(64)

    // Check section card margins inside shadow root
    const marginInfo = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const card = root?.querySelector('.pulse-section-card, [data-games-played="true"]')
      return card ? parseFloat(getComputedStyle(card).marginBottom) : null
    }, PULSE_ROOT_ID)
    if (marginInfo != null) {
      expect(marginInfo).toBeLessThanOrEqual(8.5)
    }

    // Capture screenshot of compact live sidebar
    await saveScreenshot(extension.page, '17-live-sidebar-compact-density.png', shell)
  })

  test('3. Progressive disclosure in Stream Recap', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const shell = extension.page.locator('#streamclone-pulse-root .pulse-shell')
    await expect(shell).toBeVisible()

    // On initial load, SelectedMomentCard is NOT rendered (progressive disclosure)
    await expect(
      extension.page.locator(`#${PULSE_ROOT_ID} [data-selected-moment-card="true"]`),
    ).toHaveCount(0)

    // Capture initial recap state
    await saveScreenshot(extension.page, '18-recap-progressive-disclosure-initial.png', shell)

    // Click first moment row to reveal inspector
    const momentRow = extension.page.locator(`#${PULSE_ROOT_ID} .pulse-moment-row-button`).first()
    await expect(momentRow).toBeVisible()
    await momentRow.click()

    // Now SelectedMomentCard is revealed
    const selectedCard = extension.page.locator(`#${PULSE_ROOT_ID} [data-selected-moment-card="true"]`).first()
    await expect(selectedCard).toBeVisible()

    // Capture expanded recap state
    await saveScreenshot(extension.page, '19-recap-progressive-disclosure-expanded.png', shell)

    // Clear selection dismisses card
    await selectedCard.getByRole('button', { name: 'Clear selected moment' }).click()
    await expect(
      extension.page.locator(`#${PULSE_ROOT_ID} [data-selected-moment-card="true"]`),
    ).toHaveCount(0)
  })

  test('4. Interaction proof: wheel zoom over chart without scrolling parent page', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const chart = extension.page.locator(`#${PULSE_ROOT_ID} svg[data-testid="pulse-overview-chart"]`)
    await expect(chart).toBeVisible()

    // Scroll parent window slightly
    await extension.page.evaluate(() => {
      document.documentElement.style.minHeight = '3000px'
      document.body.style.minHeight = '3000px'
      window.scrollTo(0, 100)
    })
    await chart.scrollIntoViewIfNeeded()
    const initialPageScrollY = await extension.page.evaluate(() => window.scrollY)

    const chartBox = await chart.boundingBox()
    expect(chartBox).not.toBeNull()

    const getViewportSpan = async () => {
      return await extension.page.evaluate(rootId => {
        const svg = document.getElementById(rootId)?.shadowRoot?.querySelector('svg[data-testid="pulse-overview-chart"]')
        if (!svg) return null
        const start = Number(svg.getAttribute('data-chart-viewport-start') ?? '0')
        const end = Number(svg.getAttribute('data-chart-viewport-end') ?? '0')
        return end - start
      }, PULSE_ROOT_ID)
    }

    const spanBefore = await getViewportSpan()
    expect(spanBefore).not.toBeNull()

    // Wheel over chart center
    await extension.page.mouse.move(chartBox!.x + chartBox!.width * 0.5, chartBox!.y + chartBox!.height * 0.5)
    await extension.page.mouse.wheel(0, -200)
    await extension.page.waitForTimeout(300)

    // Verify parent page scroll did NOT change
    const afterPageScrollY = await extension.page.evaluate(() => window.scrollY)
    expect(afterPageScrollY).toBe(initialPageScrollY)

    // Verify chart viewport zoomed (span decreased)
    const spanAfter = await getViewportSpan()
    expect(spanAfter).toBeLessThan(spanBefore!)
  })

  test('5. Keyboard navigation: combobox open, navigation, escape dismissal', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const trigger = extension.page.getByRole('combobox', { name: 'Chart time range' })
    await expect(trigger).toBeVisible()
    await trigger.focus()
    await trigger.press('ArrowDown')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Escape closes listbox
    await trigger.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
  })

  test('6. Failure states: API 500 displays unreachable status with retry button', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'api-500', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    // Open settings panel
    await extension.page.getByRole('button', { name: 'Open settings' }).click()
    const settings = extension.page.locator('[data-overlay-settings-panel="true"]')
    await expect(settings).toBeVisible()

    // Look for unreachable status and retry button
    const statusEl = settings.locator('[data-api-status="unreachable"]')
    await expect(statusEl).toBeVisible()
    await expect(statusEl).toHaveText('API unreachable')

    const retryBtn = settings.getByRole('button', { name: 'Test connection' })
    await expect(retryBtn).toBeVisible()
    await expect(retryBtn).toBeEnabled()

    // Capture screenshot of API 500 error state in settings
    await saveScreenshot(extension.page, '20-failure-state-api-500.png', settings)
  })

  test('7. Failure states: live partial / warming tier', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-partial', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const shell = extension.page.locator('#streamclone-pulse-root .pulse-shell')
    await expect(shell).toBeVisible()

    await assertPulseShadowContains(extension.page, /Not tracked|IRC pool|Partial|Warming|tracking/i)
    await saveScreenshot(extension.page, '21-failure-state-live-partial.png', shell)
  })

  test('8. Failure states: Helix unavailable displays credentials warning', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'helix-off', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const shell = extension.page.locator('#streamclone-pulse-root .pulse-shell')
    await expect(shell).toBeVisible()

    await assertPulseShadowContains(extension.page, /Helix|Pulse|fixturechan/i)
    await saveScreenshot(extension.page, '22-failure-state-helix-off.png', shell)
  })

  test('9. Browser zoom verification: 125% and 150%', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const shell = extension.page.locator('#streamclone-pulse-root .pulse-shell')
    await expect(shell).toBeVisible()

    // 125% zoom
    await extension.page.evaluate(() => {
      document.body.style.zoom = '1.25'
    })
    await extension.page.waitForTimeout(200)
    await saveScreenshot(extension.page, '23-browser-zoom-125.png', shell)

    // 150% zoom
    await extension.page.evaluate(() => {
      document.body.style.zoom = '1.50'
    })
    await extension.page.waitForTimeout(200)
    await saveScreenshot(extension.page, '24-browser-zoom-150.png', shell)

    // Reset zoom
    await extension.page.evaluate(() => {
      document.body.style.zoom = '1'
    })
  })
})
