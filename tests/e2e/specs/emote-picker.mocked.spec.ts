import { test, expect } from '../helpers/testFixtures.ts'
import {
  assertExactlyOnePulseRoot,
  assertPulseHostsUnique,
  assertNoUncaughtErrors,
  assertPulseShadowContains,
  PULSE_ROOT_ID,
  waitForPulseRoot,
} from '../helpers/assertions.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'

async function railMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const rail = root?.querySelector<HTMLElement>('[data-plot-emote-rail="compact"]')
    const options = [
      ...(rail?.querySelectorAll<HTMLButtonElement>('.pulse-seven-tv-option') ?? []),
    ]
    const oldCatalog = root?.querySelector(
      '.pulse-seven-tv-toggle, [data-emote-picker-scroll], .pulse-seven-tv-row, [data-plot-emote-catalog]',
    )
    return {
      text: (rail?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      optionCount: options.length,
      optionNames: options.map(option => option.getAttribute('aria-label') ?? ''),
      selected: options.filter(option => option.getAttribute('aria-pressed') === 'true').length,
      disabled: options.filter(option => option.disabled).length,
      oldCatalog: Boolean(oldCatalog),
      legendCount: root?.querySelectorAll('.pulse-chart-overlay-legend-chip').length ?? 0,
      emoteTraceCount: root?.querySelectorAll('path.sc-emote-plot-line').length ?? 0,
    }
  }, PULSE_ROOT_ID)
}

async function clickRailOption(
  page: import('@playwright/test').Page,
  index: number,
): Promise<void> {
  await page.evaluate(
    ({ rootId, optionIndex }) => {
      const rail = document
        .getElementById(rootId)
        ?.shadowRoot?.querySelector('[data-plot-emote-rail="compact"]')
      const option = rail?.querySelectorAll<HTMLButtonElement>('.pulse-seven-tv-option')[optionIndex]
      option?.click()
    },
    { rootId: PULSE_ROOT_ID, optionIndex: index },
  )
}

test.describe('emote picker redesign (mocked MV3)', () => {
  test.use({
    viewport: { width: 420, height: 900 },
  })

  test('compact rail exposes six selectable emotes and preserves the cap', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-emote-picker', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Plot emotes/i)

    let metrics = await railMetrics(extension.page)
    expect(metrics.optionCount).toBe(6)
    expect(metrics.selected).toBe(0)
    expect(metrics.text).toMatch(/Plot emotes\s*0\/6/i)
    expect(metrics.oldCatalog).toBe(false)
    expect(metrics.optionNames.every(name => !/No activity/i.test(name))).toBe(true)

    for (let index = 0; index < 6; index += 1) {
      await clickRailOption(extension.page, index)
      await expect.poll(async () => (await railMetrics(extension.page)).selected).toBe(index + 1)
    }

    metrics = await railMetrics(extension.page)
    expect(metrics.text).toMatch(/Plot emotes\s*6\/6/i)
    expect(metrics.optionCount).toBe(6)
    expect(metrics.disabled).toBe(0)
    expect(metrics.legendCount).toBe(6)
    expect(metrics.emoteTraceCount).toBe(6)

    // At the cap, selected options stay removable. The freed slot can then
    // be filled again without a disclosure panel or catalog reflow.
    await clickRailOption(extension.page, 0)
    await expect.poll(async () => (await railMetrics(extension.page)).selected).toBe(5)
    await clickRailOption(extension.page, 5)
    await expect.poll(async () => (await railMetrics(extension.page)).selected).toBe(6)
    metrics = await railMetrics(extension.page)
    expect(metrics.legendCount).toBe(6)
    expect(metrics.emoteTraceCount).toBe(6)

    assertNoUncaughtErrors(evidence)
  })

  test('compact rail stays one row through reload and host reinjection', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-emote-picker', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Plot emotes/i)
    await expect
      .poll(async () => (await railMetrics(extension.page)).optionCount)
      .toBe(6)

    const geometry = await extension.page.evaluate(rootId => {
      const rail = document
        .getElementById(rootId)
        ?.shadowRoot?.querySelector<HTMLElement>('[data-plot-emote-rail="compact"]')
      const options = [
        ...(rail?.querySelectorAll<HTMLElement>('.pulse-seven-tv-option') ?? []),
      ].map(option => option.getBoundingClientRect())
      return {
        count: options.length,
        widths: options.map(option => Math.round(option.width)),
        heights: options.map(option => Math.round(option.height)),
        tops: [...new Set(options.map(option => Math.round(option.top)))],
      }
    }, PULSE_ROOT_ID)

    expect(geometry.count).toBe(6)
    expect(geometry.widths.every(width => width === 34)).toBe(true)
    expect(geometry.heights.every(height => height === 34)).toBe(true)
    expect(geometry.tops).toHaveLength(1)

    await extension.page.reload()
    await waitForPulseRoot(extension.page)
    await assertPulseHostsUnique(extension.page)
    await expect.poll(async () => (await railMetrics(extension.page)).optionCount).toBe(6)
    assertNoUncaughtErrors(evidence)
  })

  test('recap surface hosts the same picker label', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Plot emotes|Stream recap|Replay|Pulse/i)
    assertNoUncaughtErrors(evidence)
  })
})
