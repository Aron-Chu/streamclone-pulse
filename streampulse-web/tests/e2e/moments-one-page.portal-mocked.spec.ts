import { expect, test, type Page } from './helpers/portalMockedTest'
import { installHubUxMock } from './helpers/hubUxMock'

/**
 * One Moments page on the hub's moments (11-02 deep audit, 4A): Latest leaves
 * out a stream's first 5 minutes and minutes under 1.2x the stream's earlier
 * average, the games sit on top, the open moment says how much it rose and
 * links its stream and game, and a clip address is a 404 while clips are off.
 */
async function serveRows(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    const metric = (current: number, base: number) => ({ state: 'ready', currentPerMin: current, baselinePerMin: base, multiplier: current / base,
      absoluteDeltaPerMin: current - base, currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 30, baselineExpectedMinutes: 30, baselineCoveragePct: 100 })
    window.fetch = async (input, init) => {
      const response = await original(input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!/\/v1\/public\/hub(\?|$)/.test(url) || !response.ok) return response
      const body = await response.clone().json()
      const now = Date.parse(body.generatedAt) || Date.now()
      const game = (name: string, id: string) => ({ category: name, categoryId: id, boxArtUrl: `https://static-cdn.jtvnw.net/ttv-boxart/${id}-52x72.jpg` })
      const row = (i: number, login: string, offsetMin: number, g: ReturnType<typeof game>, chat: [number, number], emotes: [number, number]) => {
        const at = Math.floor((now - (i + 1) * 4 * 60_000) / 60_000) * 60_000 + 20_000
        const minute = Math.floor(at / 60_000) * 60_000
        return { publicMomentId: `pm-${login}`, login, displayName: login, streamId: `st-${login}`, offsetSeconds: offsetMin * 60, score: 90 - i, label: 'Emote spike',
          kind: 'emote_spike', reactionSignal: 'emotes', source: 'live_irc', confidence: 90, vodState: 'live_only', chatPerMin: chat[0], emotesPerMin: emotes[0], viewers: 5000, ...g, at,
          comparison: { baselineKind: 'current_stream_measured_average_before_event', eventAt: at,
            baselineWindow: { start: minute - 30 * 60_000, end: minute, expectedMinutes: 30, measuredMinutes: 30, coveragePct: 100 },
            chat: metric(chat[0], chat[1]), emotes: metric(emotes[0], emotes[1]),
            evidence: { ircBound: true, eventRollupAvailable: true, baselineMeasuredMinutes: 30, baselineExpectedMinutes: 30, baselineCoveragePct: 100 } } }
      }
      body.livePulseMoments = [
        row(0, 'caseoh_', 192, game('Just Chatting', '509658'), [900, 300], [222, 60]),
        // the hello spike at 0:00, and a minute that fell ("0.41x Emote spike")
        row(1, 'yugi2x', 0, game('Just Chatting', '509658'), [400, 100], [90, 20]),
        row(2, 'wendolynortizz', 74, game('IRL', '509672'), [195, 210], [17, 41.5]),
        row(3, 'kaicenat', 140, game('Just Chatting', '509658'), [2000, 700], [600, 150]),
        row(4, 'supertf', 61, game('Elden Ring', '512953'), [500, 200], [150, 40]),
      ]
      return new Response(JSON.stringify(body), { status: response.status, headers: { 'Content-Type': 'application/json' } })
    }
  })
  await page.route(/\/v1\/channels\//, route => route.fulfill({ status: 404, json: { error: 'not_found' } }))
  await page.route(/\/v1\/portal\//, route => route.fulfill({ status: 404, json: { error: 'not_found' } }))
}

const shown = (page: Page) => page.locator('.moments-result [data-discovery-key]')
  .evaluateAll(rows => rows.map(row => JSON.parse(row.getAttribute('data-discovery-key')!)[0] as string))

test.describe('one Moments page', () => {
  test('Latest leaves out early and weak minutes, and the games on top filter it', async ({ page }) => {
    await installHubUxMock(page, { withComparisons: true })
    await serveRows(page)
    await page.goto('/analytics/moments')
    await expect(page.locator('.moments-result').first()).toBeVisible()
    await expect.poll(() => shown(page).then(logins => logins.sort())).toEqual(['caseoh_', 'kaicenat', 'supertf'])

    const covers = page.getByRole('list', { name: 'Games, busiest first' })
    await expect(covers.getByRole('button', { name: /^All games: 3 moments/ })).toHaveAttribute('aria-pressed', 'true')
    await covers.getByRole('button', { name: /^Elden Ring: 1 moment\./ }).click()
    await expect(page).toHaveURL(/[?&]category=Elden(\+|%20)Ring/)
    await expect.poll(() => shown(page)).toEqual(['supertf'])
    await covers.getByRole('button', { name: /^All games: / }).click()
    await expect.poll(() => shown(page).then(logins => logins.length)).toBe(3)
  })

  test('the open moment says how much it rose and links its stream and game', async ({ page }) => {
    await installHubUxMock(page, { withComparisons: true })
    await serveRows(page)
    await page.goto('/analytics/moments')
    const caseoh = page.locator('.moments-result').filter({ has: page.locator('[data-discovery-key^="[\\"caseoh_\\""]') })
    await caseoh.locator('.moments-card-primary').click()
    const detail = page.getByRole('region', { name: /^Selected moment: / })
    await expect(detail.locator('.moments-detail-lede')).toHaveText('3.7× more emotes than this stream’s earlier average')
    await detail.getByRole('button', { name: 'Show Just Chatting moments' }).click()
    await expect(page).toHaveURL(/[?&]category=Just(\+|%20)Chatting/)
    await expect.poll(() => shown(page).then(logins => logins.sort())).toEqual(['caseoh_', 'kaicenat'])

    // A link to a moment outside the list shows it on its own, its name opening the stream's page there.
    await page.goto('/analytics/moments?login=forsen&stream=s9&offset=600')
    const name = page.locator('#moments-selected-detail h2 a.moments-detail-name')
    await expect(name).toHaveText('forsen')
    await expect(name).toHaveAttribute('href', /^\/analytics\/forsen\/s9\?returnTo=.*#t=600$/)
  })

  test('a clip address is a 404 page while clips are off, never a channel named "clips"', async ({ page }) => {
    await installHubUxMock(page)
    await page.goto('/analytics/clips/abc123')
    await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible()
    await expect(page).toHaveTitle('Page not found — StreamPulse')
  })
})
