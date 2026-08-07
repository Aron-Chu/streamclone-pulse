import { test, expect } from '../helpers/testFixtures.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

const ROOT_ID = 'streamclone-pulse-root'

async function chartRect(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const chart = document.getElementById(rootId)?.shadowRoot?.querySelector(
      'svg[data-testid="pulse-overview-chart"]',
    )
    if (!chart) return null
    const rect = chart.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, ROOT_ID)
}

async function chartState(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const chart = root?.querySelector('svg[data-testid="pulse-overview-chart"]')
    if (!chart) return null
    return {
      detail: chart.getAttribute('data-chart-detail'),
      cursor: chart.querySelectorAll('[data-morph-layer="cursor"]').length,
      cursorVisible: chart.querySelector('[data-morph-layer="cursor"]')?.getAttribute('data-cursor-visible'),
      cursorOffset: chart.getAttribute('data-chart-cursor-offset'),
      domainStart: chart.getAttribute('data-chart-domain-start'),
      domainEnd: chart.getAttribute('data-chart-domain-end'),
      viewerIdleBudget: chart.getAttribute('data-viewer-idle-budget'),
      viewerDetailBudget: chart.getAttribute('data-viewer-detail-budget'),
      activityIdleBudget: chart.getAttribute('data-activity-idle-budget'),
      activityDetailBudget: chart.getAttribute('data-activity-detail-budget'),
      after: [...chart.querySelectorAll('[data-morph-layer="after-cursor"]')]
        .map(path => path.getAttribute('opacity')),
      circles: chart.querySelectorAll('circle').length,
    }
  }, ROOT_ID)
}

test('overview chart keeps static detail layers through hover, lock, leave, and keyboard clear', async ({
  extension,
  prepare,
}) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live' })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)

  const chart = extension.page.getByTestId('pulse-overview-chart')
  await chart.scrollIntoViewIfNeeded()
  const rect = await chartRect(extension.page)
  expect(rect).not.toBeNull()
  const x = rect!.x + rect!.width * 0.52
  const y = rect!.y + rect!.height * 0.45

  await extension.page.mouse.move(x, y)
  await expect.poll(async () => (await chartState(extension.page))?.detail).toBe('detail')
  const preview = await chartState(extension.page)
  expect(preview?.cursor).toBe(1)
  expect(preview?.cursorVisible).toBe('true')
  expect(preview?.after.every(opacity => opacity === '0.22')).toBe(true)
  expect(preview?.circles).toBe(0)

  await extension.page.mouse.click(x, y)
  await extension.page.mouse.move(Math.max(1, rect!.x - 12), Math.max(1, rect!.y - 12))
  await expect.poll(async () => (await chartState(extension.page))?.detail).toBe('detail')

  await extension.page.mouse.click(x, y)
  await expect.poll(async () => (await chartState(extension.page))?.detail).toBe('idle')

  await chart.focus()
  await extension.page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await chartState(extension.page))?.detail).toBe('detail')
  await extension.page.keyboard.press('Enter')
  await extension.page.keyboard.press('Escape')
  await expect.poll(async () => (await chartState(extension.page))?.detail).toBe('idle')

  const hitTarget = chart.locator('[data-chart-hit-target="true"]')
  await hitTarget.dispatchEvent('pointerdown', {
    pointerId: 10,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
  })
  await hitTarget.dispatchEvent('pointermove', {
    pointerId: 10,
    pointerType: 'touch',
    clientX: x + 2,
    clientY: y + 32,
  })
  await hitTarget.dispatchEvent('pointerup', {
    pointerId: 10,
    pointerType: 'touch',
    clientX: x + 2,
    clientY: y + 32,
  })
  expect((await chartState(extension.page))?.detail).toBe('idle')

  await hitTarget.dispatchEvent('pointerdown', {
    pointerId: 11,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
  })
  await hitTarget.dispatchEvent('pointermove', {
    pointerId: 11,
    pointerType: 'touch',
    clientX: x + 32,
    clientY: y + 1,
  })
  await hitTarget.dispatchEvent('pointerup', {
    pointerId: 11,
    pointerType: 'touch',
    clientX: x + 32,
    clientY: y + 1,
  })
  await expect.poll(async () => (await chartState(extension.page))?.detail).toBe('detail')

  await extension.page.keyboard.press('Escape')
  await hitTarget.dispatchEvent('pointerdown', {
    pointerId: 12,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
  })
  await hitTarget.dispatchEvent('pointermove', {
    pointerId: 12,
    pointerType: 'touch',
    clientX: x + 32,
    clientY: y + 1,
  })
  await hitTarget.dispatchEvent('pointercancel', {
    pointerId: 12,
    pointerType: 'touch',
    clientX: x + 32,
    clientY: y + 1,
  })
  expect((await chartState(extension.page))?.detail).toBe('idle')
})

test('compact chart keeps bounded geometry and early horizontal lock aligned', async ({
  extension,
  prepare,
}) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live' })
  await extension.page.setViewportSize({ width: 720, height: 800 })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)

  const chart = extension.page.getByTestId('pulse-overview-chart')
  await chart.scrollIntoViewIfNeeded()
  const state = await chartState(extension.page)
  expect(state?.domainStart).toBe('0')
  expect(state?.domainEnd).toBe('3600')
  expect(Number(state?.viewerDetailBudget)).toBeLessThan(100)
  expect(Number(state?.activityDetailBudget)).toBeLessThan(160)

  const rect = await chartRect(extension.page)
  expect(rect).not.toBeNull()
  const x = rect!.x + rect!.width * 0.79
  const y = rect!.y + rect!.height * 0.45
  await extension.page.mouse.click(x, y)
  await expect.poll(async () => (await chartState(extension.page))?.detail).toBe('detail')
  const locked = await chartState(extension.page)
  expect(locked?.cursorOffset).not.toBeNull()

  await extension.page.mouse.move(Math.max(1, rect!.x - 12), Math.max(1, rect!.y - 12))
  await expect.poll(async () => (await chartState(extension.page))?.detail).toBe('detail')
})
