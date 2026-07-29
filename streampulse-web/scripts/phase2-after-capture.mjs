// Baseline capture for Phase 2a — pre-implementation screenshots & DOM probe
// Usage: node scripts/phase1-baseline-capture.mjs [outDir]
// Default outDir: docs/website-portal/screenshots/baseline
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const outDir =
  process.argv[2] || path.join(repoRoot, 'docs/website-portal/screenshots/baseline')
const url = 'http://127.0.0.1:5173/analytics'

async function waitForChartLoaded(page) {
  await page.waitForSelector('figure.hx-chart2, .hx-chart2', { timeout: 20_000 })
  // Wait for SVG path to render
  await page.waitForFunction(
    () => {
      const svg = document.querySelector('.hx-chart2 svg')
      return svg && svg.querySelectorAll('path.hx-chart-line').length > 0
    },
    { timeout: 20_000 },
  )
  // Small settle for animations
  await page.waitForTimeout(800)
}

async function snapshot(page, label, suffix = '') {
  const file = path.join(outDir, `${label}${suffix}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log(`  ✔ ${label}${suffix}`)
  return file
}

async function probeChart(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.hx-chart2')
    if (!wrap) return { found: false }
    const rect = wrap.getBoundingClientRect()
    const svg = wrap.querySelector('svg')
    const paths = svg ? Array.from(svg.querySelectorAll('path')) : []
    const tip = document.querySelector('.hx-chart-tip-slot .tip')
    const tab = wrap.getAttribute('tabindex')
    const role = wrap.getAttribute('role')
    const label = wrap.getAttribute('aria-label')
    // Count children of the layer (text overlay)
    const layer = document.querySelector('.hx-chart2__layer')
    const layerKinds = layer
      ? Array.from(new Set(Array.from(layer.children).map((c) => c.className)))
      : []
    return {
      found: true,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      pathCount: paths.length,
      pathClasses: paths.map((p) => p.className?.baseVal || p.getAttribute('class') || ''),
      tipVisible: !!tip,
      tabIndex: tab,
      role,
      ariaLabel: label,
      layerChildCount: layer?.children.length ?? 0,
      layerClasses: layerKinds,
    }
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const captures = []

  // Desktop
  {
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    })
    const page = await desktop.newPage()
    console.log('Desktop → http://127.0.0.1:5173/analytics')
    await page.goto(url, { waitUntil: 'load' })
    await waitForChartLoaded(page)
    captures.push({ label: 'desktop-rest', probe: await probeChart(page) })
    await snapshot(page, 'desktop-rest')

    // Hover the chart
    const box = await page.locator('.hx-chart2').boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
      await page.waitForTimeout(300)
      const probe = await probeChart(page)
      captures.push({ label: 'desktop-hover-left', probe })
      await snapshot(page, 'desktop-hover-left')

      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5)
      await page.waitForTimeout(300)
      const probe2 = await probeChart(page)
      captures.push({ label: 'desktop-hover-right', probe: probe2 })
      await snapshot(page, 'desktop-hover-right')

      // Click to lock
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5)
      await page.waitForTimeout(400)
      const probeLocked = await probeChart(page)
      captures.push({ label: 'desktop-locked', probe: probeLocked })
      await snapshot(page, 'desktop-locked')

      // Pointer exit
      await page.mouse.move(0, 0)
      await page.waitForTimeout(400)
      const probeExit = await probeChart(page)
      captures.push({ label: 'desktop-exit', probe: probeExit })
      await snapshot(page, 'desktop-exit')
    }

    // Reduced motion
    await desktop.close()
  }

  {
    const desktopReduced = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    })
    const page = await desktopReduced.newPage()
    await page.goto(url, { waitUntil: 'load' })
    await waitForChartLoaded(page)
    const probe = await probeChart(page)
    captures.push({ label: 'desktop-rest-reduced-motion', probe })
    await snapshot(page, 'desktop-rest-reduced-motion')

    const box = await page.locator('.hx-chart2').boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
      await page.waitForTimeout(300)
      await snapshot(page, 'desktop-hover-reduced-motion')
    }
    await desktopReduced.close()
  }

  // Mobile (390×844)
  {
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'no-preference',
    })
    const page = await mobile.newPage()
    await page.goto(url, { waitUntil: 'load' })
    await waitForChartLoaded(page)
    captures.push({ label: 'mobile-rest', probe: await probeChart(page) })
    await snapshot(page, 'mobile-rest')

    // Press-drag on mobile (use CDP touch — Playwright mouse.move on mobile is unreliable)
    const cdp = await mobile.newCDPSession(page)
    async function touch(x0, y0, x1, y1, steps = 12) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: x0, y: y0, id: 1 }],
      })
      for (let i = 1; i <= steps; i += 1) {
        const x = x0 + (x1 - x0) * (i / steps)
        const y = y0 + (y1 - y0) * (i / steps)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y, id: 1 }],
        })
        await page.waitForTimeout(20)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const box = await page.locator('.hx-chart2').boundingBox()
    if (box) {
      const startX = box.x + box.width * 0.25
      const endX = box.x + box.width * 0.75
      const y = box.y + box.height * 0.5
      await touch(startX, y, endX, y)
      await page.waitForTimeout(400)
      captures.push({ label: 'mobile-press-drag', probe: await probeChart(page) })
      await snapshot(page, 'mobile-press-drag')

      // Vertical scroll test: assert touch-action is pan-y on the chart and
      // verify page-scroll is not blocked by the chart. CDP synthetic touch
      // events do not trigger native page scroll in Chromium, so we cannot
      // use scrollY as a probe. Instead: read computed touch-action and
      // verify the page does scroll when wheel-scrolled or programmatic.
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(200)
      const touchAction = await page.locator('.hx-chart2--selectable').first().evaluate(
        (el) => getComputedStyle(el).touchAction,
      )
      const scrollYBefore = await page.evaluate(() => window.scrollY)
      // Trigger scroll through the chrome viewport via document scrolling API —
      // this verifies there is no overflow: hidden / scroll-block on the page.
      await page.evaluate(() => window.scrollBy(0, 400))
      await page.waitForTimeout(200)
      const scrollY = await page.evaluate(() => window.scrollY)
      console.log(
        `  mobile vertical scroll after downward touch swipe: touchAction=${touchAction} scrollYBefore=${scrollYBefore} scrollYAfter=${scrollY}`,
      )
      captures.push({
        label: 'mobile-after-vertical-scroll',
        probe: { touchAction, scrollYBefore, scrollYAfter: scrollY },
      })
      await snapshot(page, 'mobile-after-vertical-scroll')
      await page.evaluate(() => window.scrollTo(0, 0))

      // Horizontal scrub (over the chart) to test horizontal intent
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(200)
      await touch(box.x + box.width * 0.2, y, box.x + box.width * 0.8, y)
      await page.waitForTimeout(400)
      captures.push({ label: 'mobile-horizontal-scrub', probe: await probeChart(page) })
      await snapshot(page, 'mobile-horizontal-scrub')
    }
    await mobile.close()
  }

  await browser.close()

  console.log('\n# Captures summary')
  for (const c of captures) {
    console.log(`- ${c.label}: tabIndex=${c.probe.tabIndex} role=${c.probe.role} paths=${c.probe.pathCount} layerChildren=${c.probe.layerChildCount}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
