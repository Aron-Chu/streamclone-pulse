import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '../helpers/testFixtures.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

const ROOT_ID = 'streamclone-pulse-root'
const EVIDENCE_DIR = path.resolve('test-results', 'interaction-stabilization')

async function captureRoot(page: import('@playwright/test').Page, name: string): Promise<void> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  await page.locator(`#${ROOT_ID}`).screenshot({
    path: path.join(EVIDENCE_DIR, name),
  })
}

async function chartVisualState(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const chart = document.getElementById(rootId)?.shadowRoot?.querySelector(
      'svg[data-testid="pulse-overview-chart"]',
    )
    const ghost = chart?.querySelector<HTMLElement>('g[data-chart-preview-index]')
    return {
      lockedIndex: chart?.getAttribute('data-chart-locked-index') ?? null,
      activeIndex: chart?.getAttribute('data-chart-active-index') ?? null,
      ghostIndex: ghost?.getAttribute('data-chart-preview-index') ?? null,
      ghostBands: chart?.querySelectorAll('[data-chart-hover-band="muted"]').length ?? 0,
      mode: chart?.getAttribute('data-chart-mode') ?? null,
      signalCount: chart?.querySelectorAll('[data-chart-series]').length ?? 0,
    }
  }, ROOT_ID)
}

async function railState(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const rail = root?.querySelector('[data-plot-emote-rail="compact"]')
    const options = [...(rail?.querySelectorAll<HTMLButtonElement>('.pulse-seven-tv-option') ?? [])]
    return {
      count: options.length,
      selected: options.filter(option => option.getAttribute('aria-pressed') === 'true').length,
      oldCatalog: Boolean(
        root?.querySelector(
          '.pulse-seven-tv-toggle, [data-emote-picker-scroll], .pulse-seven-tv-row, [data-plot-emote-catalog]',
        ),
      ),
      legendCount: root?.querySelectorAll('.pulse-chart-overlay-legend-chip').length ?? 0,
      traceCount: root?.querySelectorAll('path.sc-emote-plot-line').length ?? 0,
    }
  }, ROOT_ID)
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
      rail?.querySelectorAll<HTMLButtonElement>('.pulse-seven-tv-option')[optionIndex]?.click()
    },
    { rootId: ROOT_ID, optionIndex: index },
  )
}

test('Most Reacted previews a second moment while keeping a committed moment fixed', async ({
  extension,
  prepare,
}) => {
  await prepare({
    scenario: 'plot-rich',
    twitchKind: 'live',
    storage: { overlayMode: 'expanded', overlayPlacement: 'sidebar', sidebarTab: 'pulse' },
  })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)

  const rows = extension.page.locator('.pulse-moment-row-button')
  await expect(rows).toHaveCount(2)
  const first = extension.page.locator('.pulse-moment-row-button[aria-label*="00:58:00"]')
  const second = extension.page.locator('.pulse-moment-row-button[aria-label*="00:59:00"]')
  await expect(first).toHaveCount(1)
  await expect(second).toHaveCount(1)
  const tray = extension.page.locator('[data-selected-minute-slot="true"]')

  await first.hover()
  await expect(tray).toHaveAttribute('data-inspection-tray-state', 'active')
  await expect(tray).toContainText('Preview moment')
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await captureRoot(extension.page, 'most-reacted-preview.png')

  await first.click()
  await expect(tray).toContainText('Selected moment')
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await chartVisualState(extension.page)).lockedIndex)
    .not.toBeNull()
  const locked = await chartVisualState(extension.page)
  expect(locked.activeIndex).toBe(locked.lockedIndex)
  expect(locked.mode).toBe('detail')
  expect(locked.signalCount).toBeGreaterThanOrEqual(3)
  await captureRoot(extension.page, 'most-reacted-selected.png')

  await second.hover()
  await expect(tray).toContainText('Preview moment')
  await expect(tray).toContainText('96 chat · 310 emotes')
  await expect(tray).not.toContainText('140 chat · 55 emotes')
  await expect(second).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await chartVisualState(extension.page)).ghostBands).toBe(1)
  const hovered = await chartVisualState(extension.page)
  expect(hovered.ghostIndex).not.toBe(hovered.lockedIndex)
  expect(hovered.lockedIndex).toBe(locked.lockedIndex)
  expect(hovered.activeIndex).toBe(locked.lockedIndex)
  expect(hovered.mode).toBe('detail')

  await extension.page.mouse.move(8, 8)
  await expect.poll(async () => (await chartVisualState(extension.page)).ghostBands).toBe(0)
  await expect(tray).toContainText('Selected moment')
  await expect(first).toHaveAttribute('aria-pressed', 'true')

  await second.focus()
  await expect.poll(async () => (await chartVisualState(extension.page)).ghostBands).toBe(1)
  expect((await chartVisualState(extension.page)).lockedIndex).toBe(locked.lockedIndex)
  await second.evaluate(element => (element as HTMLElement).blur())
  await expect.poll(async () => (await chartVisualState(extension.page)).ghostBands).toBe(0)
  await expect(first).toHaveAttribute('aria-pressed', 'true')

  // Rows are inside the interaction boundary: selecting another row replaces
  // the lock instead of the outside-click listener clearing it first.
  await second.click()
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await expect(tray).toContainText('Selected moment')
  await expect(tray).toContainText('96 chat · 310 emotes')

  await second.click()
  await expect(tray).toHaveAttribute('data-inspection-tray-state', 'idle')
  await expect(second).toHaveAttribute('aria-pressed', 'false')

  await second.click()
  await extension.page.mouse.click(8, 8)
  await expect(tray).toHaveAttribute('data-inspection-tray-state', 'idle')
  await expect(second).toHaveAttribute('aria-pressed', 'false')

  await captureRoot(extension.page, 'most-reacted-cleared.png')
})

test('Plot emotes uses one compact six-option rail', async ({ extension, prepare }) => {
  await prepare({
    scenario: 'live-emote-picker',
    twitchKind: 'live',
    storage: { overlayMode: 'expanded', overlayPlacement: 'sidebar', sidebarTab: 'pulse' },
  })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  await expect
    .poll(async () => extension.page.evaluate(rootId => {
      const rail = document
        .getElementById(rootId)
        ?.shadowRoot?.querySelector('[data-plot-emote-rail="compact"]')
      return rail?.querySelectorAll('.pulse-seven-tv-option').length ?? 0
    }, ROOT_ID))
    .toBe(6)

  let state = await railState(extension.page)
  expect(state.count).toBe(6)
  expect(state.selected).toBe(0)
  expect(state.oldCatalog).toBe(false)

  for (let index = 0; index < 6; index += 1) {
    await clickRailOption(extension.page, index)
    await expect.poll(async () => (await railState(extension.page)).selected).toBe(index + 1)
  }

  state = await railState(extension.page)
  expect(state.selected).toBe(6)
  expect(state.legendCount).toBe(6)
  expect(state.traceCount).toBe(6)

  // A selected option remains enabled and removable at the six-item cap.
  await clickRailOption(extension.page, 0)
  await expect.poll(async () => (await railState(extension.page)).selected).toBe(5)
  state = await railState(extension.page)
  expect(state.count).toBe(6)
  expect(state.oldCatalog).toBe(false)
})
