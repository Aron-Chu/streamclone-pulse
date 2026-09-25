import { test, expect } from '@playwright/test'
import { gzipSync } from 'node:zlib'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'

const HUB_AUDIT_NOW = '2026-09-04T00:55:00.000Z'

async function installHubAuditMock(page: import('@playwright/test').Page, channelCount = 2): Promise<void> {
  await page.route(/\/v1\/public\/hub(\?.*)?$/, async (route) => {
    const now = Date.parse(HUB_AUDIT_NOW)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: HUB_AUDIT_NOW,
        poolSize: channelCount,
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
          generatedAt: HUB_AUDIT_NOW,
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
            { t: now - 5 * 60_000, chat: 140, seventv: 42, twitch: 14, bttv: 8, ffz: 5, viewers: 45000, emotes: 69 },
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
          ...Array.from({ length: Math.max(0, channelCount - 2) }, (_, index) => ({
            login: `audit_${index}`, streamId: `${900000 + index}`, viewers: 100 + index,
            chatPerMin: 20, emotesPerMin: 5, seventvPerMin: 2,
            coverageState: 'synced', trendPct: 0, category: 'Just Chatting',
          })),
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
        updatedAt: HUB_AUDIT_NOW,
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
  for (const width of [390, 986, 1440]) {
    test(`moment review is independent of buckets and contained at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 986 })
      await page.goto('/analytics')
      const rows = page.locator('.pulse-moments__peak-row')
      await expect(rows).toHaveCount(2)
      await rows.first().locator('[data-label="Moment"]').click()
      const inspector = page.locator('.pulse-moments__inspector')
      await expect(inspector).toBeVisible()
      await expect(inspector).toContainText('xQc')
      await expect(page.getByRole('button', { name: 'Clear selected chart bucket' })).toHaveCount(0)
      await expect(rows).toHaveCount(2)
      await rows.nth(1).focus()
      await page.keyboard.press('Enter')
      await expect(inspector).toContainText('sodapoppin')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      const collision = await rows.first().evaluate(row => {
        const channel = row.querySelector('[data-label="Channel"]')!.getBoundingClientRect()
        const time = row.querySelector('[data-label="Time"]')!.getBoundingClientRect()
        return channel.left < time.right && time.left < channel.right && channel.top < time.bottom && time.top < channel.bottom
      })
      expect(collision).toBe(false)
      await inspector.scrollIntoViewIfNeeded()
      await testInfo.attach(`moment-review-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' })
    })
  }

  test('ordinary scrolling does not zoom the activity graph', async ({ page }) => {
    await page.goto('/analytics')
    const navigator = page.locator('[data-hub-chart-navigator]')
    await expect(navigator).toBeVisible()
    const range = await navigator.getAttribute('data-hub-chart-navigator-window')
    const chart = page.locator('[data-hub-chart-wheel-surface]')
    await chart.hover()
    await page.mouse.wheel(0, -400)
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', range!)
    await chart.hover()
    await page.keyboard.down('Alt')
    await page.mouse.wheel(0, -400)
    await page.keyboard.up('Alt')
    await expect(navigator).not.toHaveAttribute('data-hub-chart-navigator-window', range!)
    await page.getByRole('button', { name: 'Reset zoom', exact: true }).click()
    await expect(navigator).toHaveAttribute('data-hub-chart-navigator-window', range!)
  })
  test.beforeEach(async ({ page }) => {
    // Keep relative freshness and visual timestamps deterministic. The mock is
    // constructed from Date.now(), so freeze time before installing it.
    await page.clock.setFixedTime(new Date(HUB_AUDIT_NOW))
    await installHubAuditMock(page)
  })

  test('HUB-AUDIT-050 trend badges disclose momentum via accessible title', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await page.locator('#section-tracked').scrollIntoViewIfNeeded()
    const trend = page.locator('#section-tracked [title^="Momentum:"]').first()
    await expect(trend).toBeVisible()
    await expect(trend).toHaveAttribute('title', /Momentum:/i)
    await assertNoConsoleErrors(page, errors)
  })

  for (const width of [360, 390, 768, 1024, 1440]) {
    test(`populated hub preserves one collection, disclosed diagnostics and usable navigation at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/analytics')
      await expect(page.locator('.live-channels-matrix')).toHaveCount(1)
      await expect(page.locator('#section-live-rail')).toHaveCount(1)
      await expect(page.locator('#section-live-rail .figma-live-rail__card')).toHaveCount(2)
      await expect(page.locator('#section-live-rail .figma-live-rail__card').first()).toHaveAttribute('href', /\/analytics\/xqc/)
      await expect(page.locator('[data-window-peak-disclosure]')).toHaveAttribute('open')
      await expect(page.locator('[data-collection-diagnostics]')).not.toHaveAttribute('open')
      await expect(page.locator('.figma-economy-embed .hx-econstat')).toHaveCount(0)
      expect(await page.getByRole('link', { name: /Skip to.*content/i }).count()).toBe(1)
      for (const link of await page.locator('.analytics-topnav__links a, .analytics-topnav__install').all()) {
        const box = await link.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
        expect(box?.width).toBeGreaterThanOrEqual(44)
      }
      if (width < 768) {
        const anchors = page.locator('.hub-mobile-sections a')
        await expect(anchors).toHaveText(['Overview', 'Hottest Live', 'Moments', 'Emotes', 'Channels'])
        for (const anchor of await anchors.all()) {
          expect((await anchor.boundingBox())?.height).toBeGreaterThanOrEqual(44)
          await anchor.click()
          const href = await anchor.getAttribute('href')
          await expect(page.locator(href!)).toBeVisible()
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await page.screenshot({ path: testInfo.outputPath(`hub-${width}.png`), fullPage: true })
    })
  }

  test('full Hottest Live shelf stays contained across resize and keyboard focus', async ({ page }) => {
    await installHubAuditMock(page, 20)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/analytics')
    const cards = page.locator('#section-live-rail .figma-live-rail__card')
    await expect(cards).toHaveCount(12)
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await cards.last().focus()
      await expect(cards.last()).toBeFocused()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      const grid = page.locator('#section-live-rail .figma-live-rail__grid')
      expect(await grid.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    }
  })

  test('a failed first hub load never masquerades as zero measurements or a stable pool', async ({ page }) => {
    await page.route(/\/v1\/public\/hub(?:\?.*)?$/, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"hub_unavailable"}' }))
    await page.route(/\/v1\/public\/stats(?:\?.*)?$/, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await page.goto('/analytics')
    await expect(page.getByTestId('live-pool-size')).toHaveText('Unknown')
    await expect(page.getByTestId('pool-wire')).toContainText('Pool state unavailable')
    await expect(page.getByTestId('pool-wire-stable')).toHaveCount(0)
    await expect(page.getByText('Emote measurements unavailable')).toBeVisible()
    await expect(page.getByText(/Waiting for live activity/)).toHaveCount(0)
    await expect(page.getByTestId('hub-activity-served-window')).toHaveText('Measurement window unavailable.')
    await expect(page.getByText(/Showing served/)).toHaveCount(0)
    await page.locator('[data-collection-diagnostics] summary').click()
    await expect(page.locator('[data-collection-diagnostics]')).toContainText('No coverage or capacity values can be inferred')
    await expect(page.getByText(/Hover for bucket totals/)).toHaveCount(0)
    await expect(page.locator('.figma-analytics__source-footer')).toHaveCount(0)
  })

  test('500-channel local fixture records payload, parsing, cache and interaction costs without rendering 500 rows', async ({ page }, testInfo) => {
    await installHubAuditMock(page, 500)
    let hubBody = ''
    const responseReady = page.waitForResponse(response => /\/v1\/public\/hub(?:\?|$)/.test(response.url()))
    await page.goto('/analytics')
    hubBody = await (await responseReady).text()
    await expect(page.locator('.live-channels-matrix')).toBeVisible()
    expect(await page.locator('.live-channels-matrix tbody tr').count()).toBeLessThanOrEqual(25)
    const costs = await page.evaluate(body => {
      const iterations = 30
      let start = performance.now()
      for (let i = 0; i < iterations; i++) JSON.parse(body)
      const parseMeanMs = (performance.now() - start) / iterations
      const value = JSON.parse(body)
      start = performance.now()
      for (let i = 0; i < iterations; i++) JSON.stringify(value)
      const serializeMeanMs = (performance.now() - start) / iterations
      const key = 'audit-only-storage-cost'
      start = performance.now()
      try { localStorage.setItem(key, body) } finally { localStorage.removeItem(key) }
      return { parseMeanMs, serializeMeanMs, storageWriteRemoveMs: performance.now() - start }
    }, hubBody)
    const started = Date.now()
    await page.locator('.pulse-moments__peak-row').first().click()
    await expect(page.locator('.pulse-moments__inspector')).toBeVisible()
    const receipt = {
      fixture: 'Synthetic 500-channel local Vite production preview, desktop Chromium, no throttling; not field INP or production payload',
      bytes: Buffer.byteLength(hubBody), offlineGzipBytes: gzipSync(hubBody).length,
      ...costs, clickThroughPlaywrightToVisibleInspectorMs: Date.now() - started,
      renderedChannelRows: await page.locator('.live-channels-matrix tbody tr').count(),
    }
    await testInfo.attach('populated-local-costs.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
    console.log('POPULATED_LOCAL_COSTS', JSON.stringify(receipt))
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

  test('HUB-AUDIT-054 peak leaderboard text stays at least 12px', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.pulse-moments__peak-label').first()).toBeVisible()
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
    expect(minPx).toBeGreaterThanOrEqual(12)
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
    await expect(page.getByTestId('hub-activity-served-window')).toContainText(/Showing served \d+ minutes/i)
    await assertNoConsoleErrors(page, errors)
  })

  test('hub freshness age advances before the next network poll', async ({ page }) => {
    await page.goto('/analytics')
    const trust = page.getByTestId('hub-command-trust')
    await expect(trust).toContainText(/UPDATED 0S AGO/)
    await page.clock.setFixedTime(new Date(Date.parse(HUB_AUDIT_NOW) + 30_000))
    await page.clock.runFor(10_000)
    await expect(trust).toContainText(/UPDATED 30S AGO/)
  })

  test('HUB-AUDIT-034 surface hierarchy uses distinct nested tones', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    await page.goto('/analytics')
    await expect(page.locator('.pulse-moments-live')).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const shell = document.querySelector('.pulse-moments-live')
      const nested = document.querySelector('.pulse-moments__table-panel, .pulse-moments__leaderboard')
      const row = document.querySelector('.pulse-moments__peak-row, .pulse-moments__leaderboard-row')
      const read = (node: Element | null) => (node ? getComputedStyle(node).backgroundColor : '')
      return new Set([read(shell), read(nested), read(row)].filter(Boolean)).size
    })).toBeGreaterThanOrEqual(2)
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
