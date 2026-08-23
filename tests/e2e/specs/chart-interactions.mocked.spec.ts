import { test, expect } from '../helpers/testFixtures.ts'
import type { EvidenceCollectors } from '../helpers/evidence.ts'
import type { MockApiController } from '../helpers/mockApi.ts'
import type { TestInfo } from '@playwright/test'
import {
  assertExactlyOnePulseRoot,
  assertNoUncaughtErrors,
  PULSE_ROOT_ID,
  waitForPulseRoot,
} from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

interface ChartProbe {
  svg: { x: number; y: number; width: number; height: number } | null
  lockedIndex: string | null
  previewIndex: string | null
  hoverIndex: string | null
  activeOffset: string | null
  viewportStart: string | null
  viewportEnd: string | null
  pageScrollY: number
}

async function probeChart(page: import('@playwright/test').Page): Promise<ChartProbe> {
  return page.evaluate(rootId => {
    const host = document.getElementById(rootId)
    const root = host?.shadowRoot
    if (!root) {
      return {
        svg: null,
        lockedIndex: null,
        previewIndex: null,
        hoverIndex: null,
        activeOffset: null,
        viewportStart: null,
        viewportEnd: null,
        pageScrollY: window.scrollY,
      }
    }
    const svg = root.querySelector('svg[data-testid="pulse-overview-chart"]')
    if (!svg) {
      return {
        svg: null,
        lockedIndex: null,
        previewIndex: null,
        hoverIndex: null,
        activeOffset: null,
        viewportStart: null,
        viewportEnd: null,
        pageScrollY: window.scrollY,
      }
    }
    const rect = svg.getBoundingClientRect()
    return {
      svg: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      lockedIndex: svg.getAttribute('data-chart-locked-index'),
      previewIndex: svg.getAttribute('data-chart-preview-index'),
      hoverIndex: svg.getAttribute('data-chart-hover-index'),
      activeOffset: svg.getAttribute('data-chart-active-offset'),
      viewportStart: svg.getAttribute('data-chart-viewport-start'),
      viewportEnd: svg.getAttribute('data-chart-viewport-end'),
      pageScrollY: window.scrollY,
    }
  }, PULSE_ROOT_ID)
}

function viewportSpan(probe: ChartProbe): number {
  return Number(probe.viewportEnd ?? 0) - Number(probe.viewportStart ?? 0)
}

function pulseChannelRequests(api: MockApiController) {
  return api.requests().filter(request =>
    /\/v1\/extension\/pulse\/channels\/[^/]+(?:\?|$)/.test(request.url()),
  )
}

function pulseRequestWindow(url: string): 'recent' | 'full' {
  return new URL(url).searchParams.get('window') === 'full' ? 'full' : 'recent'
}

async function attachChartNetworkEvidence(
  testInfo: TestInfo,
  api: MockApiController,
  evidence: EvidenceCollectors,
  observedUrls: string[],
): Promise<void> {
  const pulseRequests = pulseChannelRequests(api).map(request => ({
    method: request.method(),
    url: request.url(),
  }))
  await testInfo.attach('chart-network.json', {
    body: JSON.stringify({
      observedUrls,
      pulseRequests,
      pulseWindows: pulseRequests.map(request => pulseRequestWindow(request.url)),
      pageConsole: evidence.pageConsole,
      serviceWorkerConsole: evidence.serviceWorkerConsole,
      pageErrors: evidence.pageErrors,
      failedRequests: evidence.failedRequests,
    }, null, 2),
    contentType: 'application/json',
  })
}

test.describe('chart preview/lock interactions', () => {
  test('click locks a bucket, second click releases, Escape releases', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)

    // Wait for the chart to mount with data.
    await expect
      .poll(async () => (await probeChart(extension.page)).svg, { timeout: 20_000 })
      .not.toBeNull()

    const probe = await probeChart(extension.page)
    expect(probe.svg).not.toBeNull()
    const box = probe.svg!
    const midX = box.x + box.width * 0.5
    const midY = box.y + box.height * 0.5

    // Click → lock appears.
    await extension.page.mouse.click(midX, midY)
    await expect
      .poll(async () => (await probeChart(extension.page)).lockedIndex, { timeout: 5_000 })
      .not.toBeNull()
    const locked = await probeChart(extension.page)
    expect(locked.lockedIndex).toBeTruthy()
    expect(locked.activeOffset).toBeTruthy()

    // Second click on the same bucket releases the lock.
    await extension.page.mouse.click(midX, midY)
    await expect
      .poll(async () => (await probeChart(extension.page)).lockedIndex, { timeout: 5_000 })
      .toBeNull()

    // Click again to lock, then Escape releases it.
    await extension.page.mouse.click(midX, midY)
    await expect
      .poll(async () => (await probeChart(extension.page)).lockedIndex, { timeout: 5_000 })
      .not.toBeNull()
    await extension.page.keyboard.press('Escape')
    await expect
      .poll(async () => (await probeChart(extension.page)).lockedIndex, { timeout: 5_000 })
      .toBeNull()

    expect((await probeChart(extension.page)).pageScrollY).toBe(0)
    assertNoUncaughtErrors(evidence)
  })

  test('hover previews a bucket and Enter commits it as the lock', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await expect
      .poll(async () => (await probeChart(extension.page)).svg, { timeout: 20_000 })
      .not.toBeNull()
    const box = (await probeChart(extension.page)).svg!
    const quarterX = box.x + box.width * 0.25
    const midY = box.y + box.height * 0.5

    // Hover previews without locking.
    await extension.page.mouse.move(quarterX, midY)
    await expect
      .poll(async () => (await probeChart(extension.page)).previewIndex, { timeout: 5_000 })
      .not.toBeNull()
    expect((await probeChart(extension.page)).lockedIndex).toBeNull()

    // Keyboard events go to the focused element; hover alone never focuses
    // anything, so focus the scrubber explicitly before committing.
    await extension.page
      .locator(`#${PULSE_ROOT_ID} [data-chart-scrubber="true"]`)
      .focus()
    await extension.page.keyboard.press('Enter')
    await expect
      .poll(async () => (await probeChart(extension.page)).lockedIndex, { timeout: 5_000 })
      .not.toBeNull()
    const committed = await probeChart(extension.page)
    expect(committed.previewIndex).toBeNull()
    expect(committed.activeOffset).toBeTruthy()

    assertNoUncaughtErrors(evidence)
  })

  test('keyboard chart navigation clamps at visible samples and Escape clears it', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const scrubber = extension.page.locator(`#${PULSE_ROOT_ID} [data-chart-scrubber="true"]`)
    await expect(scrubber).toBeVisible()
    await scrubber.focus()

    await scrubber.press('Home')
    await expect
      .poll(async () => (await probeChart(extension.page)).previewIndex, { timeout: 5_000 })
      .toBe('0')

    await scrubber.press('End')
    const pointCountAttribute = await extension.page
      .locator(`#${PULSE_ROOT_ID} svg[data-testid="pulse-overview-chart"]`)
      .getAttribute('data-chart-point-count')
    const pointCount = Number(pointCountAttribute ?? 0)
    await expect
      .poll(async () => (await probeChart(extension.page)).previewIndex, { timeout: 5_000 })
      .toBe(String(Math.max(0, pointCount - 1)))

    await scrubber.press('ArrowLeft')
    await expect
      .poll(async () => (await probeChart(extension.page)).previewIndex, { timeout: 5_000 })
      .toBe(String(Math.max(0, pointCount - 2)))

    await scrubber.press('Escape')
    await expect.poll(async () => (await probeChart(extension.page)).previewIndex, { timeout: 5_000 }).toBeNull()
    await expect(scrubber).not.toBeFocused()
    assertNoUncaughtErrors(evidence)
  })

  test('a locked moment keeps its exact offset while keyboard zoom changes the viewport', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await expect
      .poll(async () => (await probeChart(extension.page)).svg, { timeout: 20_000 })
      .not.toBeNull()
    const box = (await probeChart(extension.page)).svg!
    const midX = box.x + box.width * 0.5
    const midY = box.y + box.height * 0.5

    await extension.page.mouse.click(midX, midY)
    await expect
      .poll(async () => (await probeChart(extension.page)).activeOffset, { timeout: 5_000 })
      .not.toBeNull()
    const locked = await probeChart(extension.page)
    expect(locked.lockedIndex).not.toBeNull()
    expect(locked.activeOffset).not.toBeNull()

    await extension.page
      .locator(`#${PULSE_ROOT_ID} [data-chart-scrubber="true"]`)
      .focus()
    const spanBefore = viewportSpan(locked)
    await extension.page.keyboard.press('=')
    await expect
      .poll(async () => viewportSpan(await probeChart(extension.page)), { timeout: 5_000 })
      .toBeLessThan(spanBefore)

    const zoomed = await probeChart(extension.page)
    expect(zoomed.activeOffset).toBe(locked.activeOffset)
    expect(zoomed.lockedIndex).not.toBeNull()
    assertNoUncaughtErrors(evidence)
  })

  test('wheel over the chart zooms without scrolling the page', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await expect
      .poll(async () => (await probeChart(extension.page)).svg, { timeout: 20_000 })
      .not.toBeNull()

    await extension.page.evaluate(() => {
      document.documentElement.style.minHeight = '2400px'
      document.body.style.minHeight = '2400px'
      window.scrollTo(0, 80)
    })
    await expect
      .poll(async () => (await probeChart(extension.page)).pageScrollY, { timeout: 5_000 })
      .toBeGreaterThan(0)

    const before = await probeChart(extension.page)
    expect(before.svg!.y + before.svg!.height).toBeGreaterThan(0)
    expect(before.svg!.y).toBeLessThan(900)
    const box = before.svg!
    const midX = box.x + box.width * 0.6
    const midY = box.y + box.height * 0.5

    const spanOf = async (): Promise<number> =>
      (await extension.page.evaluate(rootId => {
        const root = document.getElementById(rootId)?.shadowRoot
        const svg = root?.querySelector('svg[data-testid="pulse-overview-chart"]')
        if (!svg) return null
        const start = Number(svg.getAttribute('data-chart-viewport-start') ?? '0')
        const end = Number(svg.getAttribute('data-chart-viewport-end') ?? '0')
        return end - start
      }, PULSE_ROOT_ID)) ?? 0
    const spanBefore = await spanOf()

    await extension.page.mouse.move(midX, midY)
    await extension.page.mouse.wheel(0, -240)
    await extension.page.waitForTimeout(300)

    const after = await probeChart(extension.page)
    // The wheel gesture never scrolls the underlying Twitch page…
    expect(after.pageScrollY).toBe(before.pageScrollY)
    // …and the native non-passive handler collapsed the plotted viewport (zoom).
    expect(await spanOf()).toBeLessThan(spanBefore)

    assertNoUncaughtErrors(evidence)
  })

  test('emote marker rail stays bounded and supports focus, tooltip, and keyboard activation', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-emote-picker', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)

    await expect
      .poll(async () => (await probeChart(extension.page)).svg, { timeout: 20_000 })
      .not.toBeNull()

    const rail = extension.page.locator(`#${PULSE_ROOT_ID} [data-chart-emote-marker-rail="true"]`)
    const markers = extension.page.locator(`#${PULSE_ROOT_ID} [data-chart-emote-marker="true"]`)
    await expect(rail).toBeVisible()
    await expect(markers.first()).toBeVisible()
    expect(await markers.count()).toBeLessThanOrEqual(32)

    const marker = markers.first()
    await expect(marker).toHaveAttribute('aria-label', /uses at/)
    await marker.focus()
    await expect(
      extension.page.locator(`#${PULSE_ROOT_ID} [data-chart-emote-marker-tooltip="true"]`),
    ).toBeVisible()

    await marker.press('Enter')
    await expect
      .poll(async () => (await probeChart(extension.page)).lockedIndex, { timeout: 5_000 })
      .not.toBeNull()
    expect((await probeChart(extension.page)).activeOffset).not.toBeNull()

    assertNoUncaughtErrors(evidence)
  })

  test('keeps Games Played above the plot and opens settings from the bottom bar', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const games = extension.page.locator(`#${PULSE_ROOT_ID} [data-games-played="true"]`)
    const chart = extension.page.locator(`#${PULSE_ROOT_ID} svg[data-testid="pulse-overview-chart"]`)
    await expect(games).toBeVisible()
    await expect(chart).toBeVisible()
    const gamesBox = await games.boundingBox()
    const chartBox = await chart.boundingBox()
    expect(gamesBox?.y ?? Infinity).toBeLessThan(chartBox?.y ?? -Infinity)

    const settings = extension.page.locator(`#${PULSE_ROOT_ID} [data-pulse-settings-entry="bottom-bar"]`)
    await expect(settings).toBeVisible()
    await expect(settings).toHaveAttribute('aria-label', 'Open settings')
    expect(await settings.evaluate(node => Number.parseFloat(getComputedStyle(node).minHeight))).toBeGreaterThanOrEqual(40)
    await settings.focus()
    await settings.press('Enter')
    await expect(extension.page.getByRole('combobox', { name: 'Default chart range' })).toBeVisible()
    assertNoUncaughtErrors(evidence)
  })

  test('chart interactions keep recurring channel polls recent and use no forbidden origins', async ({
    extension,
    prepare,
    api,
    evidence,
  }, testInfo) => {
    const observedUrls: string[] = []
    const onRequest = (request: import('@playwright/test').Request) => {
      observedUrls.push(`${request.method()} ${request.url()}`)
    }
    extension.context.on('request', onRequest)

    try {
      await prepare({ scenario: 'live-ready', twitchKind: 'live' })
      await openTwitchChannel(extension.page)
      await waitForPulseRoot(extension.page)

      await expect
        .poll(() => pulseChannelRequests(api).length, { timeout: 20_000 })
        .toBeGreaterThan(0)
      const requestCountBeforeInteraction = api.pulseChannelRequestCount()
      await expect
        .poll(async () => (await probeChart(extension.page)).svg, { timeout: 20_000 })
        .not.toBeNull()
      const box = (await probeChart(extension.page)).svg!
      await extension.page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5)
      await extension.page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5)
      await extension.page
        .locator(`#${PULSE_ROOT_ID} [data-chart-scrubber="true"]`)
        .focus()
      await extension.page.keyboard.press('Escape')
      await extension.page.waitForTimeout(300)

      expect(api.pulseChannelRequestCount()).toBe(requestCountBeforeInteraction)
      const channelWindows = pulseChannelRequests(api).map(request => pulseRequestWindow(request.url()))
      expect(channelWindows).not.toContain('full')
      expect(channelWindows).toContain('recent')
      expect(evidence.pageConsole.filter(line => /\[error\]/i.test(line))).toEqual([])
      expect([...observedUrls, ...pulseChannelRequests(api).map(request => request.url())]
        .filter(url => /:8090/.test(url))).toEqual([])
      assertNoUncaughtErrors(evidence)
    } finally {
      extension.context.off('request', onRequest)
      await attachChartNetworkEvidence(testInfo, api, evidence, observedUrls)
    }
  })
})
