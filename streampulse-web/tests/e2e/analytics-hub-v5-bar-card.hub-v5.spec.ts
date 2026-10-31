import { expect, test, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

// The bar card (R5-8 option A): a bar click opens a strip under the chart at
// every width; ‹ › step bars, Zoom to bar zooms the chart, × or Esc closes and
// gives focus back to the plot. The card reads the hub payload and makes no request.
const PLOT = '.figma-global-activity__hub-chart svg[data-bench-plot]'
const CARD = '[data-hub-bar-card]'

async function plotArea(page: Page) {
  const plot = page.locator(PLOT)
  await plot.scrollIntoViewIfNeeded()
  // The page's section-reveal entrance (a 12 px translate on an ancestor) runs after the scroll; measure at rest.
  let last = NaN
  await expect.poll(async () => {
    const y = (await plot.boundingBox())!.y
    const still = Math.abs(y - last) < 0.01
    last = y
    if (!still) await page.waitForTimeout(250)
    return still
  }).toBe(true)
  const box = (await plot.boundingBox())!
  const width = await page.locator('.figma-global-activity__hub-chart [data-hub-plot-box]').evaluate(el => el.getBoundingClientRect().width)
  return { plot, at: (fx: number, fy = .55) => ({ x: box.x + width * fx, y: box.y + box.height * fy }) }
}

async function openHub(page: Page, width: number, { reduced = true } = {}) {
  await page.setViewportSize({ width, height: 1000 })
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHubUxMock(page)
  const momentRequests: string[] = []
  page.on('request', request => { if (request.url().includes('/hub/moments')) momentRequests.push(request.url()) })
  await page.goto('/analytics')
  await expect(page.locator(PLOT)).toBeVisible()
  return momentRequests
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)

test('a bar click opens the card under the chart without covering it, and makes no request', async ({ page }) => {
  const momentRequests = await openHub(page, 1440, { reduced: false })
  const { plot, at } = await plotArea(page)
  await expect(page.locator(CARD)).toHaveCount(0)
  await page.mouse.click(at(.5).x, at(.5).y)
  await expect(plot).toHaveAttribute('data-selection', '')
  const card = page.getByRole('region', { name: /^Bucket selected: / })
  await expect(card).toHaveAttribute('data-hub-bar-card', 'open')
  await expect(card).toBeInViewport()
  await expect(card.locator('.hbk-s')).toHaveText(/^Bucket selected · \d+ min$/)
  await expect(card.locator('.hbk-m')).toHaveText(/^[A-Z][a-z]{2} \d{1,2} local time$/)
  for (const label of ['chat/min', 'emotes/min', 'viewers (sample)']) await expect(card.locator('.hbk-figs')).toContainText(label)
  // The mock's buckets count emotes but send no names: the card says so instead of inventing a list (pick 12A, 10-30).
  await expect(card.locator('.hbk-emo')).toContainText('names not in this update')
  const plotBox = (await plot.boundingBox())!
  const cardBox = (await card.boundingBox())!
  expect(cardBox.y).toBeGreaterThanOrEqual(plotBox.y + plotBox.height - 1)
  // The selected band is the same selection, drawn by the chart.
  await expect(plot.locator('.spc-selband')).toHaveCount(1)
  expect(await noSideScroll(page)).toBe(true)
  expect(momentRequests).toHaveLength(0)
})

test('‹ › and the plot arrows step bars; Zoom to bar zooms the chart and keeps the bar', async ({ page }) => {
  const momentRequests = await openHub(page, 1262)
  const { plot, at } = await plotArea(page)
  await page.mouse.click(at(.5).x, at(.5).y)
  const card = page.locator(CARD)
  const title = card.locator('.hbk-t')
  await expect(title).toHaveText(/\d/)
  const first = await title.textContent()
  await card.getByRole('button', { name: 'Next bar' }).click()
  await expect(title).not.toHaveText(first!)
  const second = await title.textContent()
  await card.getByRole('button', { name: 'Previous bar' }).click()
  await expect(title).toHaveText(first!)
  await plot.focus()
  await page.keyboard.press('ArrowRight')
  await expect(title).toHaveText(second!)
  await page.keyboard.press('ArrowLeft')
  await expect(title).toHaveText(first!)
  await expect(plot).toHaveAttribute('data-selection', '')

  const navigator = page.locator('[data-hub-chart-navigator]')
  const full = await navigator.getAttribute('data-hub-chart-navigator-window')
  await card.getByRole('button', { name: 'Zoom to bar' }).click()
  await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', full!)
  await expect(navigator.getByRole('status')).not.toContainText('240 of 240')
  await expect(plot).toHaveAttribute('data-selection', '')
  await expect(card).toHaveAttribute('data-hub-bar-card', 'open')
  expect(momentRequests).toHaveLength(0)
})

test('× and Esc close the card and give focus back to the plot', async ({ page }) => {
  await openHub(page, 1080)
  const { plot, at } = await plotArea(page)
  const card = page.locator(CARD)

  await page.mouse.click(at(.5).x, at(.5).y)
  await expect(card).toHaveAttribute('data-hub-bar-card', 'open')
  await card.getByRole('button', { name: 'Close (Esc)' }).click()
  await expect(card).toHaveCount(0)
  await expect(plot).not.toHaveAttribute('data-selection', /.*/)
  await expect(plot).toBeFocused()

  // Opening the card may have scrolled it into view: measure the plot again.
  const again = await plotArea(page)
  await page.mouse.click(again.at(.4).x, again.at(.4).y)
  await expect(card).toHaveAttribute('data-hub-bar-card', 'open')
  await card.getByRole('button', { name: 'Next bar' }).focus()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await expect(plot).not.toHaveAttribute('data-selection', /.*/)
  await expect(plot).toBeFocused()
})

test('a bar with a detected moment lists it as a link into Moments', async ({ page }) => {
  await openHub(page, 1440)
  const { plot } = await plotArea(page)
  // The mock's xQc moment is in the second-to-last 6-min bucket: select the latest bar, then step back.
  await plot.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  const card = page.locator(CARD)
  await expect(card).toHaveAttribute('data-hub-bar-card', 'open')
  const link = card.getByRole('link', { name: /^xQc at .+, Twitch emote spike\. Opens in Moments$/ })
  for (let i = 0; i < 3 && !(await link.count()); i += 1) {
    await card.getByRole('button', { name: 'Previous bar' }).click()
  }
  await expect(link).toHaveAttribute('href', '/analytics/moments?login=xqc&stream=s1&offset=120')
  await expect(card.locator('.hbk-ml .hbk-mr').first()).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(/\/analytics\/moments\?login=xqc&stream=s1&offset=120$/)
})

for (const width of [390, 768, 1080, 1440, 1920]) {
  test(`the card fits its column and follows its container layout at ${width}px`, async ({ page }) => {
    await openHub(page, width)
    const { plot, at } = await plotArea(page)
    await page.mouse.click(at(.5).x, at(.5).y)
    await expect(plot).toHaveAttribute('data-selection', '')
    const card = page.locator(CARD)
    await expect(card).toHaveAttribute('data-hub-bar-card', 'open')
    const layout = await card.evaluate(el => {
      const host = el.closest('.hv5-bk')!.getBoundingClientRect()
      const r = (sel: string) => el.querySelector(sel)!.getBoundingClientRect()
      const body = getComputedStyle(el.querySelector('.hbk-body')!)
      const card = el.getBoundingClientRect()
      return {
        host: host.width,
        left: card.left,
        right: card.right,
        id: r('.hbk-id'),
        bodyBox: r('.hbk-body'),
        act: r('.hbk-act'),
        tracks: body.display === 'grid' ? body.gridTemplateColumns.split(' ').length : 1,
      }
    })
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(width)
    expect(await noSideScroll(page)).toBe(true)
    if (layout.host < 600) {
      // Stacked: title, then the figures, then the actions.
      expect(layout.bodyBox.top).toBeGreaterThanOrEqual(layout.id.bottom - 1)
      expect(layout.act.top).toBeGreaterThanOrEqual(layout.bodyBox.bottom - 1)
    } else {
      // The title column on the left, the figures beside it.
      expect(layout.bodyBox.left).toBeGreaterThanOrEqual(layout.id.right - 1)
    }
    if (layout.host >= 900) {
      // Actions under the title; the body splits into columns (three from 1200 px).
      expect(layout.act.right).toBeLessThanOrEqual(layout.bodyBox.left + 1)
      expect(layout.tracks).toBe(layout.host >= 1200 ? 3 : 2)
    } else {
      expect(layout.tracks).toBe(1)
    }
  })
}
