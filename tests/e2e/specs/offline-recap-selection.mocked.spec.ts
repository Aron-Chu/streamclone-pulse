import { test, expect } from '../helpers/testFixtures.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

const ROOT_ID = 'streamclone-pulse-root'

async function offlineSelectionState(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const chart = root?.querySelector('svg[data-testid="pulse-overview-chart"]')
    return {
      hasSelectedTray: root?.textContent?.includes('Selected moment') ?? false,
      pressedMoments: root?.querySelectorAll('.pulse-moment-row-button[aria-pressed="true"]').length ?? 0,
      pinned: chart?.getAttribute('data-chart-pinned') ?? null,
      detail: chart?.getAttribute('data-chart-detail') ?? null,
      mode: chart?.getAttribute('data-chart-mode') ?? null,
    }
  }, ROOT_ID)
}

async function offlineLockVisualState(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const chart = root?.querySelector('svg[data-testid="pulse-overview-chart"]')
    const ghost = chart?.querySelector('[data-chart-hover-band="muted"]')
    const pin = chart?.querySelector('[data-chart-pin-line="true"]')
    const seam = chart?.querySelector('[data-chart-seam-owner]')
    const chip = chart?.querySelector('[data-time-chip="true"]')
    const numeric = (node: Element | null | undefined, name: string) => {
      const raw = node?.getAttribute(name)
      return raw == null ? null : Number(raw)
    }
    return {
      lockedIndex: chart?.getAttribute('data-chart-locked-index') ?? null,
      activeIndex: chart?.getAttribute('data-chart-active-index') ?? null,
      ghostIndex: ghost?.getAttribute('data-chart-preview-index') ?? null,
      ghostBands: chart?.querySelectorAll('[data-chart-hover-band="muted"]').length ?? 0,
      previewLines: chart?.querySelectorAll('[data-chart-preview-line="true"]').length ?? 0,
      pinTargetX: numeric(pin, 'data-chart-pin-target-x'),
      seamOwner: seam?.getAttribute('data-chart-seam-owner') ?? null,
      timeChipOwner: chip?.getAttribute('data-time-chip-owner') ?? null,
      timeChipText: chip?.textContent?.trim() ?? null,
    }
  }, ROOT_ID)
}

test('offline recap reloads unselected and only pins a Top moment after activation', async ({
  extension,
  prepare,
}, testInfo) => {
  await prepare({ scenario: 'offline-rich', twitchKind: 'offline' })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  await extension.page.mouse.move(10, 10)

  await expect.poll(() => offlineSelectionState(extension.page)).toEqual({
    hasSelectedTray: false,
    pressedMoments: 0,
    pinned: 'false',
    detail: 'idle',
    mode: 'overview',
  })
  await testInfo.attach('offline-recap-unselected.png', {
    body: await extension.page.locator(`#${ROOT_ID}`).screenshot(),
    contentType: 'image/png',
  })

  const topMoment = extension.page.locator('.pulse-moment-row-button').first()
  await topMoment.click()
  await expect.poll(() => offlineSelectionState(extension.page)).toMatchObject({
    hasSelectedTray: true,
    pressedMoments: 1,
    pinned: 'true',
    detail: 'detail',
    mode: 'detail',
  })
  await testInfo.attach('offline-recap-user-selected.png', {
    body: await extension.page.locator(`#${ROOT_ID}`).screenshot(),
    contentType: 'image/png',
  })

  await topMoment.click()
  await expect.poll(() => offlineSelectionState(extension.page)).toEqual({
    hasSelectedTray: false,
    pressedMoments: 0,
    pinned: 'false',
    detail: 'idle',
    mode: 'overview',
  })

  await extension.page.reload()
  await waitForPulseRoot(extension.page)
  await extension.page.mouse.move(10, 10)
  await expect.poll(() => offlineSelectionState(extension.page)).toEqual({
    hasSelectedTray: false,
    pressedMoments: 0,
    pinned: 'false',
    detail: 'idle',
    mode: 'overview',
  })
})

test('offline recap row hover and focus stay ghost-only while a moment is locked', async ({
  extension,
  prepare,
}) => {
  await prepare({ scenario: 'offline-lock-rich', twitchKind: 'offline' })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)

  const rows = extension.page.locator('.pulse-moment-row-button')
  await expect(rows).toHaveCount(2)
  const lockedRow = rows.first()
  const previewRow = rows.nth(1)
  const selectedCard = extension.page.locator('[data-moment-card-mode="selected"]')

  await lockedRow.click()
  await expect(selectedCard).toBeVisible()
  await expect.poll(async () => (await offlineLockVisualState(extension.page)).lockedIndex)
    .not.toBeNull()
  const locked = await offlineLockVisualState(extension.page)
  const selectedLabel = await selectedCard.getAttribute('aria-label')
  expect(locked.activeIndex).toBe(locked.lockedIndex)
  expect(locked.timeChipOwner).toBe('locked')

  await previewRow.hover()
  await expect.poll(async () => (await offlineLockVisualState(extension.page)).ghostBands)
    .toBe(1)
  const hovered = await offlineLockVisualState(extension.page)
  expect(hovered.ghostIndex).not.toBe(locked.lockedIndex)
  expect(hovered.lockedIndex).toBe(locked.lockedIndex)
  expect(hovered.activeIndex).toBe(locked.lockedIndex)
  expect(hovered.pinTargetX).toBe(locked.pinTargetX)
  expect(hovered.seamOwner).toBe(locked.seamOwner)
  expect(hovered.seamOwner).not.toBe('preview')
  expect(hovered.timeChipOwner).toBe('locked')
  expect(hovered.timeChipText).toBe(locked.timeChipText)
  expect(hovered.previewLines).toBe(0)
  await expect(selectedCard).toHaveAttribute('aria-label', selectedLabel!)

  await extension.page.mouse.move(8, 8)
  await expect.poll(async () => (await offlineLockVisualState(extension.page)).ghostBands)
    .toBe(0)
  await previewRow.focus()
  await expect.poll(async () => (await offlineLockVisualState(extension.page)).ghostBands)
    .toBe(1)
  expect((await offlineLockVisualState(extension.page)).lockedIndex).toBe(locked.lockedIndex)
  await previewRow.evaluate(element => (element as HTMLElement).blur())
  await expect.poll(async () => (await offlineLockVisualState(extension.page)).ghostBands)
    .toBe(0)
  await expect(lockedRow).toHaveAttribute('aria-pressed', 'true')
  await expect(selectedCard).toHaveAttribute('aria-label', selectedLabel!)
})
