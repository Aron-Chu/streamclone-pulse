import { expect, test, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'

// The d3-v5 hub page (behind the build flag). Runs only against a build made with VITE_PUBLIC_HUB_V5=on;
// a default build serves the Command Center, which the spec without .hub-v5 covers.
test.skip(!/^(on|1)$/.test(process.env.VITE_PUBLIC_HUB_V5 ?? ''), 'needs a build with VITE_PUBLIC_HUB_V5=on')

// The page around the chart (d3-v5 mockup, round 5): the search hero, Busiest
// now, Moments beside or under the chart, Top emotes, Where chat is, Channels
// and How this is measured. The shared mock has no screener windows, so this
// spec serves the same reply with one per channel: three games, one channel
// with viewers only and one whose average is too short to compare.

const GAMES = ['Just Chatting', 'Just Chatting', 'Just Chatting', 'Minecraft', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting']

async function openV5Hub(page: Page) {
  await installHubUxMock(page)
  const first = page.waitForResponse(response => /\/v1\/public\/hub\?/.test(response.url()))
  await page.goto('/analytics')
  const payload = await (await first).json()
  const end = Math.floor(Date.now() / 60_000) * 60_000 - 60_000
  payload.liveChannels = payload.liveChannels.map((channel: Record<string, unknown>, index: number) => {
    const next = { ...channel, category: GAMES[index] }
    if (index === 13) return { ...next, coverageState: 'viewers_only' }
    const chat = 400 - index * 20
    const x = index === 2 ? 3.4 : 1 + (index % 4) * 0.4
    const baselineMinutes = index === 12 ? 8 : 60
    return {
      ...next,
      screener: {
        version: 1,
        baselineKind: 'current_stream_measured_average',
        state: 'ready',
        measuredAt: end,
        currentWindow: { start: end - 5 * 60_000, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
        baselineWindow: { start: end - 65 * 60_000, end: end - 5 * 60_000, expectedMinutes: 60, measuredMinutes: baselineMinutes, coveragePct: 100 },
        chat: { state: 'ready', currentPerMin: chat, baselinePerMin: chat / x, multiplier: x, baselineMeasuredMinutes: baselineMinutes },
        emotes: null,
      },
    }
  })
  await page.route(/\/v1\/public\/hub(\?.*)?$/, route => route.fulfill({ json: payload }))
  await page.reload()
  await expect(page.locator('[data-hub-v5-page] .hv5-bzc-it').first()).toBeVisible()
  return payload
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!

// After a resize the strip and the chart re-measure on the next frame and move every row
// below them, so each layout check retries until the boxes it reads agree.
const SETTLED = { timeout: 10_000 }

test('sections stack in the mockup order on a phone and sit in their columns on desktop', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await openV5Hub(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Find your streamer' })).toBeVisible()
  const order = ['.hv5-mast', '#busiest', '#activity', '#latest', '#emotes', '#games', '#channels', '#measured']
  await expect(async () => {
    const tops: number[] = []
    for (const selector of order) tops.push((await box(page, selector)).y)
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
  }).toPass(SETTLED)
  await noSideScroll(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(async () => {
    const [latest, emotes, games] = [await box(page, '#latest'), await box(page, '#emotes'), await box(page, '#games')]
    expect(Math.abs(latest.y - emotes.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(emotes.y - games.y)).toBeLessThanOrEqual(1)
    expect(latest.x + latest.width).toBeLessThanOrEqual(emotes.x + 1)
    expect(emotes.x + emotes.width).toBeLessThanOrEqual(games.x + 1)
  }).toPass(SETTLED)
  await noSideScroll(page)

  await page.setViewportSize({ width: 1920, height: 1000 })
  await expect(async () => {
    const [activity, rail] = [await box(page, '#activity'), await box(page, '#latest')]
    expect(rail.x).toBeGreaterThanOrEqual(activity.x + activity.width - 1)
    const [emotesWide, gamesWide] = [await box(page, '#emotes'), await box(page, '#games')]
    expect(Math.abs(emotesWide.y - gamesWide.y)).toBeLessThanOrEqual(1)
    expect(emotesWide.y).toBeGreaterThanOrEqual(activity.y + activity.height - 1)
  }).toPass(SETTLED)
  await noSideScroll(page)
})

test('the hero search lists live channels, filters as you type and opens the pick', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const input = page.getByRole('combobox', { name: /search/i })
  await page.keyboard.press('Control+k')
  await expect(input).toBeFocused()
  const list = page.getByRole('listbox', { name: 'Channels' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('option')).toHaveCount(6)
  await expect(list.getByRole('option').first()).toContainText('xQc')
  await input.fill('channel1')
  await expect(list.getByRole('option').first()).toContainText('channel1')
  for (const text of await list.getByRole('option').allTextContents()) expect(text).toMatch(/channel1|Open analytics/)
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await input.fill('sodapoppin')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/analytics\/sodapoppin$/)
})

test('Busiest now ranks by chat, pages with the buttons and moves focus with the arrow keys', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const busiest = page.locator('#busiest')
  const tiles = busiest.locator('.hv5-bzc-it')
  // 13 channels have a full window; Busiest shows the top 12 by chat/min.
  await expect(tiles).toHaveCount(12)
  await expect(tiles.first()).toHaveAttribute('data-login', 'xqc')
  await expect(tiles.first().locator('.hv5-bzt-fig')).toContainText('400')
  const track = busiest.locator('.hv5-bzc-track')
  const prev = busiest.getByRole('button', { name: 'Previous channels' })
  const next = busiest.getByRole('button', { name: 'Next channels' })
  await expect(prev).toHaveAttribute('aria-disabled', 'true')
  const before = await track.evaluate(el => el.scrollLeft)
  await next.click()
  await expect.poll(() => track.evaluate(el => el.scrollLeft)).toBeGreaterThan(before)
  await expect(prev).not.toHaveAttribute('aria-disabled', 'true')
  await tiles.first().locator('a').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tiles.nth(1).locator('a')).toBeFocused()
  await page.keyboard.press('End')
  await expect(tiles.last().locator('a')).toBeFocused()
  await noSideScroll(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(tiles).toHaveCount(12)
  await noSideScroll(page)
})

test('Where chat is filters Channels to one game and the chip clears it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const games = page.locator('#games')
  await expect(games.locator('.hv5-gm5')).toHaveCount(3)
  await expect(games.locator('.hv5-gm5').first()).toHaveAttribute('data-game', 'Just Chatting')
  const minecraft = games.locator('[data-game="Minecraft"]')
  await minecraft.click()
  await expect(minecraft).toHaveAttribute('aria-pressed', 'true')
  const channels = page.locator('#channels')
  await expect(channels.locator('[data-chip="game"]')).toContainText('Minecraft')
  await expect(channels.locator('[data-hv5-channel-count]')).toHaveText('4 channels')
  await expect(channels.locator('tbody tr')).toHaveCount(4)
  await channels.getByRole('button', { name: 'Remove the Minecraft filter' }).click()
  await expect(channels.locator('[data-chip="game"]')).toHaveCount(0)
  await expect(minecraft).toHaveAttribute('aria-pressed', 'false')
  await expect(channels.locator('[data-hv5-channel-count]')).toHaveText('14 of 96 live')
  await expect(channels.getByRole('textbox', { name: 'Filter channels or games' })).toBeFocused()
})

test('Channels sorts, filters, shows more and marks what is not measured', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const channels = page.locator('#channels')
  const rows = channels.locator('tbody tr')
  await expect(rows).toHaveCount(10)
  await expect(rows.first()).toHaveAttribute('data-login', 'xqc')
  await channels.getByRole('button', { name: 'Show 4 more' }).click()
  await expect(rows).toHaveCount(14)
  await expect(channels.getByRole('button', { name: 'Show fewer' })).toBeFocused()
  // Viewers only, and an average under 10 measured minutes: a dash with its reason.
  await expect(channels.locator('tr[data-login="channel13"] .hv5-na')).toHaveCount(2)
  await expect(channels.locator('tr[data-login="channel12"] td').nth(4).locator('.hv5-na')).toHaveCount(1)
  await channels.getByRole('button', { name: 'Show fewer' }).click()
  await expect(rows).toHaveCount(10)

  const vs = channels.locator('[data-sort="vs"]')
  await vs.click()
  await expect(vs).toBeFocused()
  await expect(channels.locator('th.c-vs')).toHaveAttribute('aria-sort', 'descending')
  await expect(rows.first()).toHaveAttribute('data-login', 'channel2')
  await vs.click()
  await expect(channels.locator('th.c-vs')).toHaveAttribute('aria-sort', 'ascending')

  await channels.getByRole('textbox', { name: 'Filter channels or games' }).fill('valorant')
  await expect(channels.locator('[data-hv5-channel-count]')).toHaveText('3 channels')
  await channels.getByRole('textbox', { name: 'Filter channels or games' }).fill('nobody-here')
  await expect(channels.getByText('No channels match.')).toBeVisible()
})

test('a Moments row shows its card after a rest and hides it on leave and Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const latest = page.locator('#latest')
  const row = latest.locator('.hv5-mo').first()
  await row.scrollIntoViewIfNeeded()
  const card = page.locator('[data-hv5-moment-card]')
  await row.hover()
  await expect(card).toBeVisible()
  await expect(card).toContainText('xQc')
  await expect(card).toContainText('Click to open in Moments')
  const rowBox = (await row.boundingBox())!
  const cardBox = (await card.boundingBox())!
  // Beside the row, never over it, so the row keeps the click.
  expect(cardBox.x >= rowBox.x + rowBox.width - 1 || cardBox.x + cardBox.width <= rowBox.x + 1 || cardBox.y >= rowBox.y + rowBox.height - 1 || cardBox.y + cardBox.height <= rowBox.y + 1).toBe(true)
  await page.mouse.move(4, 4)
  await expect(card).toHaveCount(0)
  await row.hover()
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await row.click()
  await expect(page).toHaveURL(/\/analytics\/moments\?login=xqc&stream=s1&offset=120$/)
})

test('the chart (i) opens How this is measured with the served-window facts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openV5Hub(page)
  const measured = page.locator('details#measured')
  await expect(measured).not.toHaveAttribute('open', /.*/)
  await page.locator('.figma-global-activity__hub-chart .hub-act-info button').click()
  await page.locator('[data-hub-toggletip-pop]').getByRole('link', { name: 'How this is measured' }).click()
  await expect(measured).toHaveAttribute('open', '')
  await expect(measured.locator('summary')).toBeFocused()
  await expect(measured.locator('.hv5-dis-body li').first()).toBeVisible()
})
