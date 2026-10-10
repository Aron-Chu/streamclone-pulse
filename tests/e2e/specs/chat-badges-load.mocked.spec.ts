import fs from 'node:fs'
import { test, expect } from '@playwright/test'
import { closeExtensionContext, launchExtensionContext, seedExtensionStorage } from '../helpers/extensionContext.ts'
import { installMockApi } from '../helpers/mockApi.ts'
import { CHAT_URL, decoratorStats, evidencePath, serveBadgeList, serveChatPage, setViewerSetting } from '../helpers/chatBadges.ts'
import { chatLine, type ChatFixtureStyle } from '../../fixtures/chat-badges/chatMarkup.ts'
import { syntheticEntries } from '../../helpers/chatBadgeSigner.ts'

/**
 * @perf Seen in chat on a very busy chat: 100 lines/s (6,000/min) for 60 s,
 * 5 % of authors on the list, with a 10k- and a 1k-entry list, in native and
 * 7TV markup. Budget (spec §7.4): decorator self-time ≤ 1 % of wall time,
 * p99 observer callback ≤ 4 ms, no callback ≥ 50 ms (a long task), heap
 * growth ≤ 5 MB per tab at 10k entries.
 *
 * Not part of the PR gate: set PULSE_CHAT_BADGES_PERF=1 to run it.
 * PULSE_CHAT_BADGES_PERF_SECONDS shortens or lengthens the run;
 * PULSE_CHAT_BADGES_EVIDENCE_DIR receives the results as JSON.
 */
const RUN_S = Number(process.env.PULSE_CHAT_BADGES_PERF_SECONDS || 60)
const LINES_PER_S = 100
const HIT_RATE = 0.05

const CASES: Array<{ style: ChatFixtureStyle; entries: number }> = [
  { style: 'native', entries: 10_000 },
  { style: 'native', entries: 1_000 },
  { style: '7tv', entries: 10_000 },
]

for (const { style, entries } of CASES) {
  test(`@perf ${style}, ${entries.toLocaleString('en-US')} Supporters: 6,000 lines/min stays inside the CPU budget`, async ({}, testInfo) => {
    test.skip(process.env.PULSE_CHAT_BADGES_PERF !== '1', 'set PULSE_CHAT_BADGES_PERF=1 to run the load test')
    test.setTimeout((RUN_S + 90) * 1000)
    const extension = await launchExtensionContext({ viewport: { width: 760, height: 900 } })
    try {
      const list = syntheticEntries(entries)
      const api = await installMockApi(extension.context, 'live-ready')
      await serveBadgeList(extension.context, list)
      await serveChatPage(extension.context, () => style, () => ({ width: 340, lines: '' }))
      await seedExtensionStorage(extension.serviceWorker)
      // Start with crests off so the heap is measured before and after the decorator arrives.
      await setViewerSetting(extension.serviceWorker, { chatSupporterCrestsEnabled: false })
      const page = extension.page
      await page.goto(CHAT_URL, { waitUntil: 'load' })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')
      const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage')
        return (await cdp.send('Runtime.getHeapUsage')).usedSize
      }
      const heapBefore = await heap()
      await setViewerSetting(extension.serviceWorker, { chatSupporterCrestsEnabled: true })
      await expect.poll(async () => (await decoratorStats(extension.serviceWorker))?.attached ?? false, { timeout: 20_000 }).toBe(true)
      const heapAfterList = await heap()

      const template = chatLine(style, { login: 'zzlogin', display: 'ZzDisplay', id: '99999999', text: 'zztext', badge: true })
      const metric = async (name: string) => (await cdp.send('Performance.getMetrics')).metrics.find(entry => entry.name === name)?.value ?? 0
      const scriptBefore = await metric('ScriptDuration')
      const taskBefore = await metric('TaskDuration')
      const statsBefore = (await decoratorStats(extension.serviceWorker))!
      const started = Date.now()
      // The page's own world plays Twitch: 10 lines every 100 ms, keeping about 150 on screen.
      await page.evaluate(async ({ template, logins, seconds, perSecond, hitRate }) => {
        const container = document.querySelector('.seventv-chat-list') ?? document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]')!
        const longTasks: number[] = []
        new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration) }).observe({ type: 'longtask' })
        ;(window as unknown as { __longTasks: number[] }).__longTasks = longTasks
        let n = 0
        const end = performance.now() + seconds * 1000
        await new Promise<void>(resolve => {
          const timer = setInterval(() => {
            let html = ''
            for (let k = 0; k < perSecond / 10; k++, n++) {
              const hit = Math.random() < hitRate
              const login = hit ? logins[n % logins.length] : `viewer${n.toString(36)}`
              html += template.replaceAll('zzlogin', login).replaceAll('ZzDisplay', login).replaceAll('zztext', `message ${n}`)
            }
            container.insertAdjacentHTML('beforeend', html)
            while (container.children.length > 150) container.firstElementChild!.remove()
            if (performance.now() >= end) { clearInterval(timer); resolve() }
          }, 100)
        })
      }, { template, logins: list.filter((_, i) => i % 97 === 0).map(entry => entry[1]), seconds: RUN_S, perSecond: LINES_PER_S, hitRate: HIT_RATE })
      const wallMs = Date.now() - started
      const stats = (await decoratorStats(extension.serviceWorker))!
      const scriptMs = (await metric('ScriptDuration') - scriptBefore) * 1000
      const taskMs = (await metric('TaskDuration') - taskBefore) * 1000
      const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks)
      const heapEnd = await heap()

      const samples = [...stats.samples].sort((a, b) => a - b)
      const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0
      const selfMs = stats.totalMs - statsBefore.totalMs
      const lines = stats.lines - statsBefore.lines
      const result = {
        style, entries, runSeconds: RUN_S, wallMs,
        linesPerMinute: Math.round(lines / (wallMs / 60_000)),
        hits: stats.hits - statsBefore.hits,
        callbacks: stats.callbacks - statsBefore.callbacks,
        decoratorSelfMs: Number(selfMs.toFixed(2)),
        decoratorSelfShareOfWall: Number((selfMs / wallMs).toFixed(5)),
        perLineMicroseconds: Number(((selfMs * 1000) / Math.max(1, lines)).toFixed(2)),
        callbackP50Ms: Number(p(0.5).toFixed(3)),
        callbackP99Ms: Number(p(0.99).toFixed(3)),
        callbackMaxMs: Number(stats.maxMs.toFixed(3)),
        pageScriptMs: Math.round(scriptMs),
        pageTaskMs: Math.round(taskMs),
        pageLongTasks: longTasks.length,
        pageLongTaskMaxMs: Math.round(Math.max(0, ...longTasks)),
        heapListAndDecoratorBytes: heapAfterList - heapBefore,
        heapEndMinusBeforeBytes: heapEnd - heapBefore,
      }
      fs.writeFileSync(evidencePath(testInfo, `chat-badges-load-${style}-${entries}.json`), JSON.stringify(result, null, 2) + '\n')
      await testInfo.attach('result', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
      console.log(JSON.stringify(result))

      expect(lines).toBeGreaterThan(RUN_S * LINES_PER_S * 0.9)
      expect(result.hits).toBeGreaterThan(0)
      expect(result.decoratorSelfShareOfWall).toBeLessThanOrEqual(0.01)
      expect(result.callbackP99Ms).toBeLessThanOrEqual(4)
      // A decorator callback never becomes a long task on its own.
      expect(result.callbackMaxMs).toBeLessThan(50)
      expect(result.heapListAndDecoratorBytes).toBeLessThanOrEqual(5 * 1024 * 1024)
      await api.dispose()
    } finally {
      await closeExtensionContext(extension)
    }
  })
}
