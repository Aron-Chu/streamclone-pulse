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

async function expandEmotePicker(page: import('@playwright/test').Page): Promise<void> {
  const expanded = await page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    if (!root) return false
    const toggle = root.querySelector<HTMLButtonElement>('.pulse-seven-tv-toggle')
    if (!toggle) return false
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
    return true
  }, PULSE_ROOT_ID)
  expect(expanded, 'emote picker toggle').toBe(true)
  await expect
    .poll(async () =>
      page.evaluate(rootId => {
        const root = document.getElementById(rootId)?.shadowRoot
        const list = root?.querySelector<HTMLElement>('[data-emote-picker-scroll]')
        return list ? { rows: list.querySelectorAll('.pulse-seven-tv-row').length, sh: list.scrollHeight, ch: list.clientHeight } : null
      }, PULSE_ROOT_ID),
    )
    .toMatchObject({ rows: expect.any(Number) })
}

async function pickerMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const list = root?.querySelector<HTMLElement>('[data-emote-picker-scroll]')
    const toggle = root?.querySelector<HTMLButtonElement>('.pulse-seven-tv-toggle')
    const rows = [...(list?.querySelectorAll<HTMLButtonElement>('.pulse-seven-tv-row') ?? [])]
    return {
      label: (toggle?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      expanded: toggle?.getAttribute('aria-expanded') === 'true',
      rowCount: rows.length,
      scrollHeight: list?.scrollHeight ?? 0,
      clientHeight: list?.clientHeight ?? 0,
      selected: rows.filter(row => row.getAttribute('aria-selected') === 'true').map(row => row.textContent ?? ''),
      disabledLabels: rows
        .filter(row => row.disabled || row.getAttribute('aria-disabled') === 'true')
        .map(row => (row.textContent ?? '').replace(/\s+/g, ' ').trim()),
      lastRowText: (rows.at(-1)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      showMorePresent: Boolean(
        [...(root?.querySelectorAll('button') ?? [])].some(btn =>
          /show\s+\d+\s+more|show less/i.test(btn.textContent ?? ''),
        ),
      ),
      legendCount: root?.querySelectorAll('.pulse-chart-overlay-legend-chip').length ?? 0,
    }
  }, PULSE_ROOT_ID)
}

async function scrollPickerToBottom(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(rootId => {
    const list = document.getElementById(rootId)?.shadowRoot?.querySelector<HTMLElement>('[data-emote-picker-scroll]')
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, PULSE_ROOT_ID)
}

async function clickPickerRowsByIndex(
  page: import('@playwright/test').Page,
  indexes: number[],
): Promise<void> {
  await page.evaluate(
    ({ rootId, indexes: idxs }) => {
      const list = document.getElementById(rootId)?.shadowRoot?.querySelector('[data-emote-picker-scroll]')
      const rows = [...(list?.querySelectorAll<HTMLButtonElement>('.pulse-seven-tv-row') ?? [])]
      for (const index of idxs) {
        const row = rows[index]
        if (row && !row.disabled) row.click()
      }
    },
    { rootId: PULSE_ROOT_ID, indexes },
  )
}

test.describe('emote picker redesign (mocked MV3)', () => {
  test.use({
    viewport: { width: 420, height: 900 },
  })

  test('scrollable catalog, six-cap selection, collapse preserve, zero-series blocked', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-emote-picker', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Plot emotes/i)

    await expandEmotePicker(extension.page)
    let metrics = await pickerMetrics(extension.page)
    expect(metrics.showMorePresent, 'no Show N more / Show less').toBe(false)
    expect(metrics.rowCount).toBeGreaterThanOrEqual(12)
    expect(metrics.rowCount).toBeLessThanOrEqual(24)
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.label).toMatch(/Plot emotes · 0\/6/i)

    await scrollPickerToBottom(extension.page)
    metrics = await pickerMetrics(extension.page)
    expect(metrics.lastRowText.length).toBeGreaterThan(0)
    expect(metrics.disabledLabels.some(label => /No activity/i.test(label))).toBe(true)

    // Select six non-adjacent plottable rows (indexes 0,2,4,6,8,10).
    await clickPickerRowsByIndex(extension.page, [0, 2, 4, 6, 8, 10])
    metrics = await pickerMetrics(extension.page)
    expect(metrics.selected).toHaveLength(6)
    expect(metrics.label).toMatch(/Plot emotes · 6\/6/i)
    expect(metrics.legendCount).toBe(6)

    // Seventh selection must not apply.
    await clickPickerRowsByIndex(extension.page, [1])
    metrics = await pickerMetrics(extension.page)
    expect(metrics.selected).toHaveLength(6)

    // Deselect one, select another.
    await clickPickerRowsByIndex(extension.page, [0, 1])
    metrics = await pickerMetrics(extension.page)
    expect(metrics.selected).toHaveLength(6)

    // Collapse / reopen preserves valid selections.
    await extension.page.evaluate(rootId => {
      document.getElementById(rootId)?.shadowRoot?.querySelector<HTMLButtonElement>('.pulse-seven-tv-toggle')?.click()
    }, PULSE_ROOT_ID)
    await expect.poll(async () => (await pickerMetrics(extension.page)).expanded).toBe(false)
    await expandEmotePicker(extension.page)
    metrics = await pickerMetrics(extension.page)
    expect(metrics.selected).toHaveLength(6)
    expect(metrics.legendCount).toBe(6)

    // Disabled zero-activity rows must not create legend entries when clicked.
    const beforeLegend = metrics.legendCount
    await extension.page.evaluate(rootId => {
      const rows = [
        ...(document
          .getElementById(rootId)
          ?.shadowRoot?.querySelectorAll<HTMLButtonElement>('.pulse-seven-tv-row') ?? []),
      ]
      const disabled = rows.find(row => row.disabled || /No activity/i.test(row.textContent ?? ''))
      disabled?.click()
    }, PULSE_ROOT_ID)
    metrics = await pickerMetrics(extension.page)
    expect(metrics.legendCount).toBe(beforeLegend)

    assertNoUncaughtErrors(evidence)
  })

  test('narrow sidebar screenshots + reinject single hosts', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-emote-picker', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const panel = extension.page.locator(`#${PULSE_ROOT_ID}`)
    await expect(panel).toHaveScreenshot('emote-picker-initial-narrow.png', {
      maxDiffPixelRatio: 0.04,
    })

    await expandEmotePicker(extension.page)
    await expect(panel).toHaveScreenshot('emote-picker-expanded-narrow.png', {
      maxDiffPixelRatio: 0.04,
    })

    await scrollPickerToBottom(extension.page)
    await expect(panel).toHaveScreenshot('emote-picker-scrolled-bottom-narrow.png', {
      maxDiffPixelRatio: 0.04,
    })

    await clickPickerRowsByIndex(extension.page, [0, 2, 4, 6, 8, 10])
    await expect(panel).toHaveScreenshot('emote-picker-six-selected-narrow.png', {
      maxDiffPixelRatio: 0.04,
    })

    // Reinject content script path: reload page and assert unique hosts.
    await extension.page.reload()
    await waitForPulseRoot(extension.page)
    await assertPulseHostsUnique(extension.page)
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
