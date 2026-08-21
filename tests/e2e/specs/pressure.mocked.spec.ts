import { test, expect } from '../helpers/testFixtures.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * Load harness, not a correctness gate. It drives fast-chat churn and SPA channel
 * switches, then reports CDP counters so regressions in the always-on observers
 * show up as forced-layout / listener / node growth instead of "feels laggy".
 *
 * The chat storm is measured twice: once on a control page with no content script
 * and once on the mocked Twitch page. Only the delta is attributable to Pulse —
 * the harness itself forces layout by autoscrolling, so raw counters lie.
 */

const ROOT_ID = 'streamclone-pulse-root'
const CHAT_SELECTOR = '[data-test-selector="chat-scrollable-area"]'
const CONTROL_URL = 'https://pulse-perf-control.test/'

const CONTROL_HTML = `<!doctype html><html><head><title>control</title></head><body>
<div id="root"><main><section data-test-selector="chat-room-component-layout">
<div data-test-selector="chat-scrollable-area" data-a-target="chat-scrollable-area"
     style="height:400px;overflow-y:auto">
<div class="chat-line"><span class="user">viewer_one:</span> seed</div>
</div></section></main></div></body></html>`

type Metrics = Record<string, number>

async function readMetrics(session: import('@playwright/test').CDPSession): Promise<Metrics> {
  const { metrics } = (await session.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[]
  }
  return Object.fromEntries(metrics.map(m => [m.name, m.value]))
}

async function collectGarbage(session: import('@playwright/test').CDPSession): Promise<void> {
  await session.send('HeapProfiler.collectGarbage').catch(() => undefined)
}

function delta(after: Metrics, before: Metrics, key: string): number {
  return Number(((after[key] ?? 0) - (before[key] ?? 0)).toFixed(3))
}

interface StormResult {
  sent: number
  elapsedMs: number
  frames: number
  droppedFrames: number
  droppedFramePct: number
  longTasks: number
  longTaskMsTotal: number
  worstLongTaskMs: number
  layoutCount: number
  recalcStyleCount: number
  layoutDurationMs: number
  recalcStyleDurationMs: number
  scriptDurationMs: number
}

/** Append/trim chat lines the way Twitch does, at a fixed rate, for a fixed duration. */
async function runChatStorm(
  page: import('@playwright/test').Page,
  session: import('@playwright/test').CDPSession,
  opts: { messagesPerSecond: number; durationMs: number; maxLines: number },
): Promise<StormResult> {
  await collectGarbage(session)
  const before = await readMetrics(session)

  const inPage = await page.evaluate(
    async ({ selector, messagesPerSecond, durationMs, maxLines }) => {
      const host = document.querySelector(selector)
      if (!host) throw new Error(`chat host not found: ${selector}`)

      const longTasks: number[] = []
      const longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration)
      })
      try {
        longTaskObserver.observe({ entryTypes: ['longtask'] })
      } catch {
        /* longtask unsupported */
      }

      const frameGaps: number[] = []
      let lastFrame = performance.now()
      let rafId = requestAnimationFrame(function tick() {
        const now = performance.now()
        frameGaps.push(now - lastFrame)
        lastFrame = now
        rafId = requestAnimationFrame(tick)
      })

      const started = performance.now()
      let sent = 0

      await new Promise<void>(resolve => {
        const timer = window.setInterval(() => {
          const line = document.createElement('div')
          line.className = 'chat-line'
          line.innerHTML = `<span class="user">viewer_${sent % 500}:</span> message ${sent} KEKW`
          host.appendChild(line)
          sent += 1
          while (host.childElementCount > maxLines) {
            host.firstElementChild?.remove()
          }
          // Twitch autoscrolls on every message; this is what drives scroll listeners.
          host.scrollTop = host.scrollHeight
          if (performance.now() - started >= durationMs) {
            window.clearInterval(timer)
            resolve()
          }
        }, 1000 / messagesPerSecond)
      })

      cancelAnimationFrame(rafId)
      longTaskObserver.disconnect()

      const dropped = frameGaps.filter(gap => gap > 32).length
      return {
        sent,
        elapsedMs: Math.round(performance.now() - started),
        frames: frameGaps.length,
        droppedFrames: dropped,
        droppedFramePct: frameGaps.length
          ? Number(((dropped / frameGaps.length) * 100).toFixed(1))
          : 0,
        longTasks: longTasks.length,
        longTaskMsTotal: Number(longTasks.reduce((a, b) => a + b, 0).toFixed(1)),
        worstLongTaskMs: Number((longTasks.length ? Math.max(...longTasks) : 0).toFixed(1)),
      }
    },
    {
      selector: CHAT_SELECTOR,
      messagesPerSecond: opts.messagesPerSecond,
      durationMs: opts.durationMs,
      maxLines: opts.maxLines,
    },
  )

  const after = await readMetrics(session)
  return {
    ...inPage,
    layoutCount: delta(after, before, 'LayoutCount'),
    recalcStyleCount: delta(after, before, 'RecalcStyleCount'),
    layoutDurationMs: Number((delta(after, before, 'LayoutDuration') * 1000).toFixed(1)),
    recalcStyleDurationMs: Number((delta(after, before, 'RecalcStyleDuration') * 1000).toFixed(1)),
    scriptDurationMs: Number((delta(after, before, 'ScriptDuration') * 1000).toFixed(1)),
  }
}

const STORM = { messagesPerSecond: 40, durationMs: 15_000, maxLines: 150 }

test('pressure: fast chat costs little above a no-extension control', async ({
  extension,
  prepare,
}) => {
  test.setTimeout(240_000)
  await prepare({ scenario: 'live-ready', twitchKind: 'live' })

  // --- Control: identical DOM churn on a page the content script never touches.
  await extension.context.route(`${CONTROL_URL}**`, route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: CONTROL_HTML }),
  )
  const control = await extension.context.newPage()
  await control.goto(CONTROL_URL, { waitUntil: 'domcontentloaded' })
  expect(await control.evaluate(id => document.getElementById(id) != null, ROOT_ID)).toBe(false)
  const controlSession = await extension.context.newCDPSession(control)
  await controlSession.send('Performance.enable')
  await control.waitForTimeout(1000)
  const baseline = await runChatStorm(control, controlSession, STORM)
  await control.close()

  // --- Treatment: same storm with Pulse mounted.
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const session = await extension.context.newCDPSession(extension.page)
  await session.send('Performance.enable')
  await extension.page.waitForTimeout(2500)
  const withPulse = await runChatStorm(extension.page, session, STORM)

  const attributable = {
    layoutCount: withPulse.layoutCount - baseline.layoutCount,
    recalcStyleCount: withPulse.recalcStyleCount - baseline.recalcStyleCount,
    layoutDurationMs: Number((withPulse.layoutDurationMs - baseline.layoutDurationMs).toFixed(1)),
    scriptDurationMs: Number((withPulse.scriptDurationMs - baseline.scriptDurationMs).toFixed(1)),
    longTasks: withPulse.longTasks - baseline.longTasks,
    droppedFramePct: Number((withPulse.droppedFramePct - baseline.droppedFramePct).toFixed(1)),
  }
  const extraLayoutsPerMessage = attributable.layoutCount / Math.max(1, withPulse.sent)

  console.log(
    'CHAT STORM REPORT',
    JSON.stringify(
      { baseline, withPulse, attributableToPulse: attributable, extraLayoutsPerMessage },
      null,
      2,
    ),
  )

  // The whole point of the mutation filters: chat churn must not force a layout per message.
  expect(extraLayoutsPerMessage).toBeLessThan(0.5)
  expect(attributable.droppedFramePct).toBeLessThan(15)
})

test('pressure: repeated channel switches do not leak nodes or listeners', async ({
  extension,
  prepare,
  api,
}) => {
  test.setTimeout(240_000)
  await prepare({ scenario: 'live-ready', twitchKind: 'live' })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)

  const session = await extension.context.newCDPSession(extension.page)
  await session.send('Performance.enable')

  const switchOnce = async (n: number) => {
    await extension.page.evaluate(login => {
      history.pushState({}, '', `/${login}`)
    }, `pressurechan${n}`)
    await extension.page.waitForTimeout(420)
  }

  // Warm up so first-mount allocations are excluded from the growth measurement.
  for (let i = 0; i < 3; i += 1) await switchOnce(i)
  await extension.page.waitForTimeout(1500)
  await collectGarbage(session)
  const before = await readMetrics(session)
  const requestsBefore = api.pulseChannelRequestCount()

  const SWITCHES = 30
  for (let i = 0; i < SWITCHES; i += 1) await switchOnce(100 + i)

  await extension.page.waitForTimeout(2000)
  await collectGarbage(session)
  await extension.page.waitForTimeout(500)
  await collectGarbage(session)

  const after = await readMetrics(session)
  const requestsAfter = api.pulseChannelRequestCount()

  const hosts = await extension.page.evaluate(rootId => {
    return [rootId, 'streamclone-pulse-tabs'].map(id => ({
      id,
      count: document.querySelectorAll(`[id="${id}"]`).length,
    }))
  }, ROOT_ID)

  const report = {
    switches: SWITCHES,
    pulseRequestsDuringSwitches: requestsAfter - requestsBefore,
    nodesBefore: before.Nodes ?? 0,
    nodesAfter: after.Nodes ?? 0,
    nodeGrowthPerSwitch: Number((delta(after, before, 'Nodes') / SWITCHES).toFixed(2)),
    listenersBefore: before.JSEventListeners ?? 0,
    listenersAfter: after.JSEventListeners ?? 0,
    listenerGrowthPerSwitch: Number(
      (delta(after, before, 'JSEventListeners') / SWITCHES).toFixed(2),
    ),
    heapMbBefore: Number(((before.JSHeapUsedSize ?? 0) / 1048576).toFixed(2)),
    heapMbAfter: Number(((after.JSHeapUsedSize ?? 0) / 1048576).toFixed(2)),
    heapGrowthKbPerSwitch: Number(
      (delta(after, before, 'JSHeapUsedSize') / 1024 / SWITCHES).toFixed(1),
    ),
    documentsAfter: after.Documents ?? 0,
    duplicateHosts: hosts,
  }
  console.log('CHANNEL SWITCH REPORT', JSON.stringify(report, null, 2))

  // Proves the switches actually re-activated the overlay — otherwise this measures nothing.
  expect(report.pulseRequestsDuringSwitches).toBeGreaterThan(0)
  // Exactly one host per id — duplicates would mean an orphaned React root per switch.
  for (const host of hosts) expect(host.count).toBeLessThanOrEqual(1)
  expect(report.listenerGrowthPerSwitch).toBeLessThan(2)
  expect(report.nodeGrowthPerSwitch).toBeLessThan(25)
})

test('pressure: 24h chart pointer sweep stays frame-bounded', async ({
  extension,
  prepare,
}) => {
  test.setTimeout(120_000)
  await prepare({ scenario: 'live-long', twitchKind: 'live' })
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)

  const chart = extension.page.getByTestId('pulse-overview-chart')
  await chart.scrollIntoViewIfNeeded()
  await expect(chart).toHaveAttribute('data-display-rollup-count', String(24 * 60))

  const session = await extension.context.newCDPSession(extension.page)
  await session.send('Performance.enable')
  await collectGarbage(session)
  const before = await readMetrics(session)

  const sweep = await extension.page.evaluate(async rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const chart = root?.querySelector<SVGSVGElement>('svg[data-testid="pulse-overview-chart"]')
    const hit = chart?.querySelector<SVGRectElement>('[data-chart-hit-target="true"]')
    if (!chart || !hit) throw new Error('chart hit target not found')
    const rect = hit.getBoundingClientRect()
    const renderCountBefore = Number(chart.getAttribute('data-chart-render-count') ?? 0)
    let mutations = 0
    const observer = new MutationObserver(records => {
      mutations += records.length
    })
    observer.observe(chart, { attributes: true, childList: true, subtree: true })

    const frameGaps: number[] = []
    const eventCosts: number[] = []
    const durationMs = 2_400
    const started = performance.now()
    let lastFrame = started
    await new Promise<void>(resolve => {
      const tick = (now: number) => {
        frameGaps.push(now - lastFrame)
        lastFrame = now
        const elapsed = now - started
        const phase = (elapsed / 360) * Math.PI * 2
        const fraction = 0.06 + ((Math.sin(phase) + 1) / 2) * 0.88
        const eventStarted = performance.now()
        hit.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          clientX: rect.left + rect.width * fraction,
          clientY: rect.top + rect.height * 0.48,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
        }))
        eventCosts.push(performance.now() - eventStarted)
        if (elapsed >= durationMs) {
          resolve()
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    observer.disconnect()
    const renderCountAfter = Number(chart.getAttribute('data-chart-render-count') ?? 0)
    const droppedFrames = frameGaps.filter(gap => gap > 32).length
    return {
      frames: frameGaps.length,
      droppedFrames,
      droppedFramePct: Number(((droppedFrames / Math.max(1, frameGaps.length)) * 100).toFixed(1)),
      worstFrameMs: Number(Math.max(...frameGaps).toFixed(1)),
      averageEventMs: Number((eventCosts.reduce((sum, value) => sum + value, 0) / Math.max(1, eventCosts.length)).toFixed(3)),
      worstEventMs: Number(Math.max(...eventCosts).toFixed(3)),
      mutations,
      chartRenders: renderCountAfter - renderCountBefore,
    }
  }, ROOT_ID)

  const after = await readMetrics(session)
  const report = {
    ...sweep,
    layoutCount: delta(after, before, 'LayoutCount'),
    recalcStyleCount: delta(after, before, 'RecalcStyleCount'),
    layoutDurationMs: Number((delta(after, before, 'LayoutDuration') * 1000).toFixed(1)),
    recalcStyleDurationMs: Number((delta(after, before, 'RecalcStyleDuration') * 1000).toFixed(1)),
    scriptDurationMs: Number((delta(after, before, 'ScriptDuration') * 1000).toFixed(1)),
  }
  console.log('CHART HOVER REPORT', JSON.stringify(report, null, 2))

  expect(report.droppedFramePct).toBeLessThan(20)
  expect(report.chartRenders).toBeLessThan(8)
})
