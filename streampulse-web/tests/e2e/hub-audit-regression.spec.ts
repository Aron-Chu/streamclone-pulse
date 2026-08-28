import { test, expect } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'

async function installHubAuditMock(page: import('@playwright/test').Page): Promise<void> {
  await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
    const now = Date.now()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        poolSize: 2,
        corpus: {
          streamsTracked: 2,
          momentsDetected: 2,
          chatMessagesProcessed: 1000,
          emotesIndexed: 200,
          vodsAnalyzed: 0,
        },
        coverage: {
          liveChannels: 2,
          trackingMax: 5,
          backfillActive: 0,
          backfillMax: 0,
          syncActive: 0,
          emotesIndexed: 200,
          databaseOk: true,
          state: 'operational',
        },
        corpusPipeline: {
          generatedAt: new Date().toISOString(),
          state: 'healthy',
          topN: 500,
          collectorActive: 10,
          collectorMax: 69,
          roster: {
            live: 2,
            collectorTracking: 2,
            expectedCollectorRows: 2,
            liveCollectorDeficitRows: 0,
            metadataOnly: 0,
            metadataStale: 0,
            admissionDisabled: 0,
            capacityBlocked: 0,
            warming: 0,
            collecting: 2,
            viewerOnly: 0,
            zeroChatAfterAge: 0,
          },
        },
        activity: {
          points: [
            { t: now - 10 * 60_000, chat: 120, seventv: 40, twitch: 12, bttv: 8, ffz: 5, viewers: 42000, emotes: 65 },
            { t: now, chat: 180, seventv: 55, twitch: 18, bttv: 11, ffz: 7, viewers: 48000, emotes: 91 },
          ],
          windowMinutes: 30,
          channelCount: 2,
        },
        emoteIntel: {
          emotesPerMin: 88,
          topEmoteSharePct: 22,
          uniqueEmotes: 140,
          biggestPeakPerMin: 320,
          seventvSharePct: 61,
          providerShares: [{ provider: '7TV', count: 1200, sharePct: 58 }],
        },
        topEmotes: [{ name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 }],
        topMovers: [{ login: 'xqc', displayName: 'xQc', emotesPerMin: 40, seventvPerMin: 30 }],
        liveChannels: [
          {
            login: 'xqc',
            displayName: 'xQc',
            category: 'Just Chatting',
            viewers: 12000,
            chatPerMin: 200,
            emotesPerMin: 80,
            seventvPerMin: 60,
            coverageState: 'synced',
            trendPct: 18,
          },
          {
            login: 'sodapoppin',
            displayName: 'sodapoppin',
            category: 'Just Chatting',
            viewers: 8000,
            chatPerMin: 150,
            emotesPerMin: 70,
            seventvPerMin: 50,
            coverageState: 'synced',
            trendPct: -6,
          },
        ],
        moments: [],
        livePulseMoments: [
          {
            login: 'xqc',
            displayName: 'xQc',
            streamId: 's1',
            offsetSeconds: 120,
            score: 92,
            label: 'Chat spike',
            source: 'live_irc',
            confidence: 97,
            vodState: 'live_only',
            chatPerMin: 210,
            viewerDelta: 120,
            at: now - 5 * 60_000,
          },
          {
            login: 'sodapoppin',
            displayName: 'sodapoppin',
            streamId: 's2',
            offsetSeconds: 240,
            score: 85,
            label: 'Emote spike',
            source: 'live_irc',
            confidence: 88,
            vodState: 'live_only',
            chatPerMin: 180,
            viewerDelta: 80,
            at: now - 3 * 60_000,
          },
        ],
        featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
      }),
    })
  })
  await page.route(/\/v1\/extension\/health(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: 'test' }) }),
  )
  await page.route(/\/v1\/public\/stats(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        streamsTracked: 1200,
        momentsDetected: 45000,
        chatMessagesProcessed: 9000000,
        emotesIndexed: 120000,
        vodsAnalyzed: 800,
        updatedAt: new Date().toISOString(),
      }),
    }),
  )
}

function parseRgb(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function relativeLuminance(rgb: [number, number, number]): number {
  const channels = rgb.map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrastRatio(foreground: string, background: string): number {
  const fg = parseRgb(foreground)
  const bg = parseRgb(background)
  if (!fg || !bg) return 0
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

test.describe('hub audit regression', () => {
  test.beforeEach(async ({ page }) => {
    await installHubAuditMock(page)
  })

  test('HUB-AUDIT-050 trend badges disclose momentum via accessible title', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await page.locator('#section-live-rail').scrollIntoViewIfNeeded()
    const trend = page.locator('.figma-live-rail__trend').first()
    await expect(trend).toBeVisible()
    await expect(trend).toHaveAttribute('title', /Momentum:/i)
    await assertNoConsoleErrors(page, errors)
  })

  test('HUB-AUDIT-053 pulse moments table supports arrow navigation', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const table = page.getByRole('table', { name: /pulse moments/i })
    await expect(table).toBeVisible()
    const rows = page.locator('.pulse-moments__peak-row')
    await expect(rows).toHaveCount(2)
    await rows.first().focus()
    await page.keyboard.press('ArrowDown')
    const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? '')
    expect(focusedText).toContain('sodapoppin')
    await page.keyboard.press('ArrowUp')
    const refocusedText = await page.evaluate(() => document.activeElement?.textContent ?? '')
    expect(refocusedText).toContain('xQc')
    await assertNoConsoleErrors(page, errors)
  })

  test('HUB-AUDIT-054 peak leaderboard text stays at least 11px', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.pulse-moments__peak-rank').first()).toBeVisible()
    const minPx = await page.evaluate(() => {
      const selectors = [
        '.pulse-moments__peak-rank',
        '.pulse-moments__peak-time',
        '.pulse-moments__peak-label',
        '.pulse-moments__peak-meta',
      ]
      const sizes = selectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).map((node) =>
          Number.parseFloat(getComputedStyle(node).fontSize),
        ),
      )
      return sizes.length > 0 ? Math.min(...sizes) : 0
    })
    expect(minPx).toBeGreaterThanOrEqual(11)
    await assertNoConsoleErrors(page, errors)
  })

  test('HUB-AUDIT-052 muted peak text meets WCAG AA contrast', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    const ratios = await page.evaluate(() => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--sp-bg').trim() || '#09090b'
      const samples = ['.pulse-moments__peak-rank', '.pulse-moments__peak-meta']
      return samples
        .map((selector) => {
          const node = document.querySelector(selector)
          if (!node) return null
          const color = getComputedStyle(node).color
          return { selector, color, bg }
        })
        .filter((sample): sample is { selector: string; color: string; bg: string } => sample != null)
    })
    for (const sample of ratios) {
      const ratio = contrastRatio(sample.color, sample.bg === '#09090b' ? 'rgb(9, 9, 11)' : sample.bg)
      expect(ratio, `${sample.selector} contrast`).toBeGreaterThanOrEqual(4.5)
    }
    await assertNoConsoleErrors(page, errors)
  })

  test('HUB-AUDIT-043 freshness captions appear on time-sensitive panels', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.getByText(/As of \d+[smh] ago/).first()).toBeVisible()
    await expect(page.getByText(/Top emotes —/).first()).toBeVisible()
    await assertNoConsoleErrors(page, errors)
  })

  test('HUB-AUDIT-034 surface hierarchy uses distinct nested tones', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.pulse-moments-live')).toBeVisible()
    const surfaces = await page.evaluate(() => {
      const shell = document.querySelector('.pulse-moments-live')
      const nested = document.querySelector('.pulse-moments__table-panel, .pulse-moments__leaderboard')
      const row = document.querySelector('.pulse-moments__peak-row, .pulse-moments__leaderboard-row')
      const read = (node: Element | null) => (node ? getComputedStyle(node).backgroundColor : '')
      return [read(shell), read(nested), read(row)].filter(Boolean)
    })
    expect(new Set(surfaces).size).toBeGreaterThanOrEqual(2)
    await assertNoConsoleErrors(page, errors)
  })

  test('HUB-AUDIT-051 pulse moments live visual baseline', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.pulse-moments-live')).toBeVisible()
    await expect(page.locator('.pulse-moments-live')).toHaveScreenshot('pulse-moments-live-shell.png', {
      maxDiffPixelRatio: 0.03,
    })
    await page.locator('.pulse-moments__peak-row, .pulse-moments__leaderboard-row').first().click()
    await expect(page.locator('.pulse-moments-live__side .pulse-moments__inspector')).toBeVisible()
    await expect(page.locator('.pulse-moments__inspector')).toHaveScreenshot('moment-inspector-compact.png', {
      maxDiffPixelRatio: 0.03,
    })
    await assertNoConsoleErrors(page, errors)
  })
})
