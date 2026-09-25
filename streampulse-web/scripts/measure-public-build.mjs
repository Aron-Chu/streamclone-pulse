/** Local production-preview measurement, not a hosted/mobile-user benchmark. */
import { chromium } from '@playwright/test'
import { gzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Use a local production preview origin')
const browser = await chromium.launch()
const records = []
try {
  for (const width of [390, 1440]) {
    for (const routePath of process.env.PERF_ANALYTICS_ONLY === '1' ? ['/analytics'] : ['/', '/docs', '/analytics']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
      const page = await context.newPage()
      const bodies = []
      const pendingBodies = []
      const apiRequests = []
      const mutations = []
      await page.route('**/*', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (!['GET', 'HEAD'].includes(request.method())) mutations.push(`${request.method()} ${url.pathname}`)
        if (url.pathname.startsWith('/v1/')) {
          apiRequests.push(url.pathname)
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        }
        if (url.origin !== origin) return route.abort('blockedbyclient')
        return route.continue()
      })
      page.on('response', response => {
        if (!response.url().startsWith(origin) || !response.ok()) return
        pendingBodies.push((async () => {
          const body = await response.body()
          bodies.push({ path: new URL(response.url()).pathname, bytes: body.length, gzipEstimateBytes: gzipSync(body).length })
        })().catch(() => {}))
      })
      await page.addInitScript(() => {
        window.__localPerf = { lcpMs: null, cls: 0, longTasks: [], shifts: [], clsWindow: 0, clsStart: 0, clsLast: 0 }
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) window.__localPerf.lcpMs = entry.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
        new PerformanceObserver(list => {
          const result = window.__localPerf
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue
            if (result.shifts.length < 12) result.shifts.push({ value: entry.value, at: entry.startTime, sources: entry.sources.map(source => ({
              tag: source.node?.tagName, className: typeof source.node?.className === 'string' ? source.node.className : '',
              previous: source.previousRect.toJSON(), current: source.currentRect.toJSON(),
            })) })
            if (entry.startTime - result.clsLast > 1000 || entry.startTime - result.clsStart > 5000) {
              result.clsWindow = 0
              result.clsStart = entry.startTime
            }
            result.clsLast = entry.startTime
            result.clsWindow += entry.value
            result.cls = Math.max(result.cls, result.clsWindow)
          }
        }).observe({ type: 'layout-shift', buffered: true })
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) window.__localPerf.longTasks.push(entry.duration)
        }).observe({ type: 'longtask', buffered: true })
      })
      await page.goto(`${origin}${routePath}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(2000)
      const metrics = await page.evaluate(() => ({
        ...window.__localPerf,
        transferBytes: performance.getEntriesByType('resource').reduce((sum, item) => sum + item.transferSize, 0),
        encodedResourceBodyBytes: performance.getEntriesByType('resource').reduce((sum, item) => sum + item.encodedBodySize, 0),
        fontsRequested: performance.getEntriesByType('resource').filter(item => /\.woff2?(?:\?|$)/.test(item.name)).length,
        videoElements: document.querySelectorAll('video').length,
        overflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      }))
      await Promise.all(pendingBodies)
      if (bodies.some(item => item.path.includes('/@vite/') || item.path.startsWith('/src/'))) throw new Error('Development server is not a production measurement')
      const record = { route: routePath, width, observation: 'networkidle + 2 seconds, fresh browser context', apiRequests, mutations, metrics, bodies }
      records.push(record)
      console.log(JSON.stringify({ route: routePath, width, lcpMs: metrics.lcpMs, cls: metrics.cls, longTasks: metrics.longTasks, requests: bodies.length, fonts: metrics.fontsRequested }))
      await context.close()
    }
  }
  const runLabel = process.env.PERF_RUN_LABEL || ''
  if (runLabel && !/^[a-z0-9-]{1,40}$/.test(runLabel)) throw new Error('Invalid performance run label')
  const destination = resolve(`artifacts/public-build-performance${runLabel ? `-${runLabel}` : ''}.json`)
  await mkdir(resolve('artifacts'), { recursive: true })
  await writeFile(destination, JSON.stringify({
    measuredAt: new Date().toISOString(), origin, browser: browser.version(), platform: process.platform,
    fixture: 'Empty API JSON; external images and services blocked. Production Vite preview, no CPU/network throttling. Reduced motion. Not representative of populated analytics or real phones.',
    caveats: 'gzipEstimateBytes is offline compression of bodies, not transferred gzip. Resource Timing transfer may exclude intercepted resources. INP is not measured from these short synthetic navigations. No performance score or production acceptance is implied.',
    records,
  }, null, 2))
  console.log(`Saved ${destination}`)
} finally {
  await browser.close()
}
