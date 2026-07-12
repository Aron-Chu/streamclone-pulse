import { expect, test, type Page, type Route } from '@playwright/test'

const LOGIN = 'tape-fixture'
const STREAM_ID = 'stream_fixture_v1'
const SESSION_PATH = `/analytics/${LOGIN}/${STREAM_ID}`
const STARTED_AT = '2026-01-01T00:00:00.000Z'
const PEAK_OFFSET_SECONDS = 240
const PEAK_MINUTE = new Date(Date.parse(STARTED_AT) + PEAK_OFFSET_SECONDS * 1_000).toISOString()

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function measuredObservation(observedAt: string, source = 'fixture') {
  return { state: 'measured', observedAt, coveragePct: 100, source }
}

function fixtureMinutes() {
  return Array.from({ length: 300 }, (_, index) => {
    const observedAt = new Date(Date.parse(STARTED_AT) + index * 60_000).toISOString()
    return {
      offsetSeconds: index * 60,
      viewerAvg: 1_000 + index * 30,
      viewerMax: 1_020 + index * 30,
      viewerLatest: 1_010 + index * 30,
      viewerSamples: 2,
      chatCount: 20 + index * 9,
      totalEmoteCount: 8 + index * 6,
      seventvEmoteCount: 5 + index * 4,
      signalObservations: {
        chat: measuredObservation(observedAt),
        emotes: measuredObservation(observedAt),
        viewers: measuredObservation(observedAt, 'helix'),
      },
    }
  })
}

async function installSessionFixtures(page: Page): Promise<void> {
  const minutes = fixtureMinutes()
  const observedThrough = minutes.at(-1)!.offsetSeconds
  const stream = {
    streamId: STREAM_ID,
    login: LOGIN,
    displayName: 'Tape Fixture',
    title: 'Deterministic session signal tape',
    category: 'Just Chatting',
    startedAt: STARTED_AT,
    endedAt: new Date(Date.parse(STARTED_AT) + 300 * 60_000).toISOString(),
    currentViewers: 9_970,
    peakViewers: 10_100,
    viewerSamples: 600,
    chatMessages: 500_000,
  }
  const watermarks = {
    chat: { state: 'current', observedThrough: new Date(Date.parse(STARTED_AT) + observedThrough * 1_000).toISOString(), source: 'fixture', coveragePct: 100 },
    emotes: { state: 'current', observedThrough: new Date(Date.parse(STARTED_AT) + observedThrough * 1_000).toISOString(), source: 'fixture', coveragePct: 100 },
    viewers: { state: 'current', observedThrough: new Date(Date.parse(STARTED_AT) + observedThrough * 1_000).toISOString(), source: 'helix' },
  }

  // The broad fallback makes optional portal calls deterministic too. Register it
  // first so the path-specific fixture below wins.
  await page.route(/\/v1\/.*/, route => json(route, { items: [], streams: [], segments: [], updatedAt: 0 }))
  await page.route(/\/v1\/portal\/analytics\/.*/, async route => {
    const path = new URL(route.request().url()).pathname
    if (path === `/v1/portal/analytics/streams/${STREAM_ID}`) {
      await json(route, {
        channel: LOGIN,
        state: 'historical',
        stream,
        sources: [{ source: 'fixture', state: 'ok', label: 'Fixture data' }],
        updatedAt: 0,
        chatCoveragePct: 100,
        signalWatermarks: watermarks,
      })
      return
    }
    if (path === `/v1/portal/analytics/streams/${STREAM_ID}/minutes`) {
      await json(route, {
        streamId: STREAM_ID,
        channel: LOGIN,
        startedAt: STARTED_AT,
        coverageStartOffsetSeconds: 0,
        minutes,
        updatedAt: 0,
        signalWatermarks: watermarks,
      })
      return
    }
    if (path === `/v1/portal/analytics/streams/${STREAM_ID}/summary`) {
      await json(route, {
        streamId: STREAM_ID,
        channel: LOGIN,
        state: 'historical',
        stream,
        updatedAt: 0,
        metrics: { chat_per_min: 100, emotes_per_min: 60, seventv_per_min: 40, minutesWithData: 300 },
        topEmotes: [],
      })
      return
    }
    if (path === `/v1/portal/analytics/streams/${STREAM_ID}/recap`) {
      await json(route, {
        streamId: STREAM_ID,
        login: LOGIN,
        durationSeconds: 300 * 60,
        topMoments: [{
          offsetSeconds: PEAK_OFFSET_SECONDS,
          score: 99,
          chatCount: 56,
          emoteCount: 32,
          viewerCount: 1_120,
          peakObservation: {
            state: 'measured',
            observedAt: PEAK_MINUTE,
            confirmed: true,
            detector: 'fixture:confirmed_peak',
            value: 99,
            source: 'fixture',
            coveragePct: 100,
          },
        }],
        updatedAt: 0,
      })
      return
    }
    if (path === `/v1/portal/analytics/channels/${LOGIN}/streams`) {
      await json(route, { channel: LOGIN, items: [stream], updatedAt: 0 })
      return
    }
    if (path === `/v1/portal/analytics/channels/${LOGIN}/emotes`) {
      await json(route, { channel: LOGIN, items: [], updatedAt: 0 })
      return
    }
    if (path.endsWith('/games')) {
      await json(route, { streamId: STREAM_ID, segments: [], updatedAt: 0 })
      return
    }
    if (path.endsWith('/sync/status')) {
      await json(route, { streamId: STREAM_ID, phase: 'complete', stale: false, updatedAt: STARTED_AT })
      return
    }
    await json(route, { items: [], streams: [], segments: [], updatedAt: 0 })
  })
}

async function openTape(page: Page): Promise<void> {
  await installSessionFixtures(page)
  await page.goto(SESSION_PATH, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('region', { name: 'Session signals' })).toBeVisible()
  await page.addStyleTag({ content: '.session-signal-scroller { max-width: 120px !important; }' })
  await expect(page.getByRole('button', { name: 'Pause ticker' })).toBeVisible()
}

test.describe('session signal tape', () => {
  test.use({ viewport: { width: 1100, height: 900 } })

  test('B4-B7 and B13-B14: overflowing tape pauses, resumes, reverses, and exposes usable controls', async ({ page }) => {
    await openTape(page)

    const tape = page.getByRole('region', { name: 'Session signals' })
    const scroller = tape.getByTestId('ticker-scroller')
    const pause = tape.locator('.session-signal-pause')
    expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)

    await pause.hover()
    await pause.focus()
    await expect(pause).toHaveAccessibleName('Pause ticker')
    await expect(pause).toHaveAttribute('aria-pressed', 'false')
    await expect(pause).toHaveCSS('outline-style', /solid|auto/)

    const targetSizes = await tape.getByRole('button').evaluateAll(buttons =>
      buttons.map(button => {
        const box = button.getBoundingClientRect()
        return { width: box.width, height: box.height }
      }),
    )
    expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)

    await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth - element.clientWidth - 2 })
    await page.waitForTimeout(900)
    const afterReverse = await scroller.evaluate(element => element.scrollLeft)
    expect(afterReverse).toBeGreaterThanOrEqual(0)
    expect(afterReverse).toBeLessThanOrEqual(await scroller.evaluate(element => element.scrollWidth - element.clientWidth))

    await pause.click()
    await expect(pause).toHaveAccessibleName('Resume ticker')
    const pausedAt = await scroller.evaluate(element => element.scrollLeft)
    await page.waitForTimeout(250)
    expect(await scroller.evaluate(element => element.scrollLeft)).toBeCloseTo(pausedAt, 0)
    await pause.click()
    await expect(pause).toHaveAccessibleName('Pause ticker')

    const chip = tape.getByRole('button', { name: /Confirmed peak/i })
    await chip.focus()
    await expect(chip).toHaveCSS('outline-style', /solid|auto/)
    await expect(chip).toHaveAttribute('data-selected', 'false')
    await chip.press('Enter')
    await expect(chip).toHaveAttribute('data-selected', 'true')
    await expect(chip).toHaveAttribute('aria-pressed', 'true')

    // The 240-second peak is intentionally a normal minute in the 300-point source
    // timeline, so the chart must interpolate this exact time when its display
    // series is downsampled rather than silently selecting a neighbouring point.
    const marker = page.locator('svg[aria-label="Analytics timeline chart"] line[stroke-width="2.5"][stroke-dasharray="4 3"]')
    await expect(marker).toHaveCount(1)
    const markerX = Number(await marker.getAttribute('x1'))
    const expectedX = 90 + (PEAK_OFFSET_SECONDS / 60 / 299) * (1000 - 90 - 34)
    // Chart-side padding/downsampling can slightly alter the terminal span, but
    // a neighbouring downsampled minute would be several viewBox units away.
    expect(Math.abs(markerX - expectedX)).toBeLessThan(1)

    await page.evaluate(() => { document.body.style.zoom = '2' })
    const zoomedSizes = await tape.getByRole('button').evaluateAll(buttons =>
      buttons.map(button => {
        const style = getComputedStyle(button)
        return { minWidth: Number.parseFloat(style.minWidth), minHeight: Number.parseFloat(style.minHeight) }
      }),
    )
    expect(zoomedSizes.every(({ minWidth, minHeight }) => minWidth >= 44 && minHeight >= 44)).toBe(true)
  })

  test('B7: reduced motion leaves an overflowing tape static and omits Pause', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installSessionFixtures(page)
    await page.goto(SESSION_PATH, { waitUntil: 'domcontentloaded' })

    const tape = page.getByRole('region', { name: 'Session signals' })
    await expect(tape).toBeVisible()
    await page.addStyleTag({ content: '.session-signal-scroller { max-width: 120px !important; }' })
    const scroller = tape.getByTestId('ticker-scroller')
    expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    await expect(page.getByRole('button', { name: /ticker/i })).toHaveCount(0)

    const before = await scroller.evaluate(element => element.scrollLeft)
    await page.waitForTimeout(350)
    expect(await scroller.evaluate(element => element.scrollLeft)).toBe(before)
  })
})
