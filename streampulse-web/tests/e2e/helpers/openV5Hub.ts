import { expect, type Page } from '@playwright/test'
import { installHubUxMock, READY_FEATURED_SESSION, type HubUxMockOptions } from './hubUxMock'

const GAMES = ['Just Chatting', 'Just Chatting', 'Just Chatting', 'Minecraft', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting', 'Minecraft', 'Valorant', 'Just Chatting']

export async function openV5Hub(page: Page, options: HubUxMockOptions = {}) {
  // on the context, so every page mock wins: an API read nothing here answers gets a 404, never the live API
  await page.context().route(/^https:\/\/api\.streampulse\.stream\//, route => route.fulfill({ status: 404, json: {} }))
  await installHubUxMock(page, { featuredSession: READY_FEATURED_SESSION, ...options })
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
