import type { Page } from '@playwright/test'

/**
 * Shared capture logic for the 2026-09-11 analytics drift audit.
 *
 * The mocked and live Playwright projects use mutually exclusive `testMatch`
 * patterns (see playwright.config.ts), so the audit needs two thin spec files
 * over one helper rather than a single spec that runs in both.
 *
 * Evidence is written outside this repo, into the control-plane workspace, so
 * an audit run never adds artifacts to the already very dirty product tree.
 */
export const AUDIT_EVIDENCE_DIR = 'C:/Users/Aron/streampulse-sdlc/artifacts/ui-audit-2026-09-11'

export const AUDIT_WIDTHS = [390, 768, 1440, 1920] as const

/** The ohnePixel day the handoff calls out: 136 detections, one indexed broadcast. */
export const HISTORY_DAY_URL =
  '/analytics/moments?collection=history&creator=ohnepixel&year=2026&day=2026-09-03'

export interface RouteProbe {
  slug: string
  path: string
}

export const AUDIT_ROUTES: RouteProbe[] = [
  { slug: 'hub', path: '/analytics' },
  { slug: 'moments', path: '/analytics/moments' },
  { slug: 'history-day', path: HISTORY_DAY_URL },
  { slug: 'sessions', path: '/analytics/moments?view=sessions' },
  { slug: 'explore', path: '/analytics/explore' },
  { slug: 'explore-params', path: '/analytics/explore?window=24h&signal=chat&category=Just%20Chatting&state=live&sort=strongest' },
]

export interface RouteSurface {
  slug: string
  requestedPath: string
  finalUrl: string
  title: string
  robots: string | null
  canonical: string | null
  h1: string[]
  bodyHead: string
  notFound: boolean
  horizontalOverflow: number
  scrollHeight: number
  pageErrors: string[]
}

/**
 * Record what a route actually resolves to. Deliberately descriptive rather
 * than assertive: the matrix is evidence, and a difference is classified by
 * hand afterwards instead of failing the run.
 */
export async function captureRouteSurface(
  page: Page,
  route: RouteProbe,
  settleMs = 3000,
): Promise<RouteSurface> {
  const pageErrors: string[] = []
  const onError = (error: Error) => pageErrors.push(error.message)
  page.on('pageerror', onError)
  try {
    await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(settleMs)
    const captured = await page.evaluate(() => {
      const meta = (name: string) =>
        document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null
      const text = document.body.innerText
      return {
        finalUrl: location.href,
        title: document.title,
        robots: meta('robots'),
        canonical:
          document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href') ?? null,
        h1: [...document.querySelectorAll('h1')].map(node => node.textContent?.trim() ?? ''),
        bodyHead: text.slice(0, 320),
        // Matches the copy the local router renders for an unmatched route.
        notFound: /page not found/i.test(text),
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
      }
    })
    return { slug: route.slug, requestedPath: route.path, ...captured, pageErrors }
  } finally {
    page.off('pageerror', onError)
  }
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface WheelGesture {
  /** Proof the pointer was genuinely over the chart when the wheel fired. */
  pointerInsideChart: boolean
  pointer: { x: number; y: number }
  chartBox: Box
  scrollYBefore: number
  scrollYAfter: number
  scrolled: boolean
  prevented: WheelRecord[]
}

export interface WheelProbe {
  chartFound: boolean
  /** Ordinary vertical wheel — must scroll the page, must not be consumed. */
  plain: WheelGesture | null
  /** Alt+wheel zooming *in*, which the chart has room to apply and must consume. */
  altZoomIn: WheelGesture | null
  /**
   * Alt+wheel zooming *out* while already at full range. Nothing is left to
   * apply, so the documented rule is that the chart must NOT consume it and the
   * page scrolls — this is the boundary case the handoff called out.
   */
  altZoomOutAtFullRange: WheelGesture | null
}

/**
 * The portal has two independent chart wheel paths, so the audit addresses each
 * by the component's own test hook rather than guessing at "the biggest svg" —
 * an earlier version scrolled `svg.first()`, which is the header logo.
 *
 * - Hub `/analytics` renders `HubActivityChart`; `HubChartNavigator` binds the
 *   wheel listener to the wrapper marked `data-hub-chart-wheel-surface`.
 * - Channel `/analytics/:login/:streamId` renders `AnalyticsConsole`, whose
 *   `PulseMultiSignalChart` binds the listener to its own svg.
 */
export const CHART_SURFACES = {
  hub: '[data-hub-chart-wheel-surface]',
  console: 'svg[data-chart-primary-line-width]',
} as const

/** What the page actually received, so a missing modifier cannot be mistaken
 * for a handler that declined to consume the gesture. */
export interface WheelRecord {
  prevented: boolean
  altKey: boolean
  shiftKey: boolean
  deltaY: number
  target: string
}

async function installWheelAudit(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { wheelAudit?: unknown[] }
    if (store.wheelAudit) return
    store.wheelAudit = []
    document.addEventListener(
      'wheel',
      event => {
        const target = event.target as Element | null
        // defaultPrevented is only reliable once other listeners have run.
        queueMicrotask(() =>
          store.wheelAudit!.push({
            prevented: event.defaultPrevented,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            deltaY: event.deltaY,
            target: target?.tagName ?? 'unknown',
          }),
        )
      },
      { passive: true },
    )
  })
}

function drainAudit(page: Page): Promise<WheelRecord[]> {
  return page.evaluate(() => {
    const audit = (window as unknown as { wheelAudit: WheelRecord[] }).wheelAudit
    const snapshot = audit.slice()
    audit.length = 0
    return snapshot
  })
}

/**
 * Hover the visual centre of the chart, scrolling it into view first, then fire
 * one wheel gesture. Returns null when the chart cannot be brought fully into
 * the viewport, so an unhoverable chart can never read as a pass.
 */
async function wheelOverChart(
  page: Page,
  selector: string,
  alt: boolean,
  deltaY = 650,
): Promise<WheelGesture | null> {
  const chart = page.locator(selector).first()
  if (!(await chart.count())) return null
  await chart.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(400)

  const measured = await chart.boundingBox()
  if (!measured) return null
  const box: Box = {
    x: measured.x,
    y: measured.y,
    width: measured.width,
    height: measured.height,
  }

  const viewport = page.viewportSize()!
  const pointer = {
    x: Math.round(box.x + box.width * 0.5),
    y: Math.round(box.y + box.height * 0.5),
  }
  // Only trust the gesture when the aim point is inside both the chart and the
  // viewport. The earlier version clamped into empty page space and passed
  // without ever touching the chart.
  const pointerInsideChart =
    pointer.x >= box.x &&
    pointer.x <= box.x + box.width &&
    pointer.y >= box.y &&
    pointer.y <= box.y + box.height &&
    pointer.y > 0 &&
    pointer.y < viewport.height

  await installWheelAudit(page)
  await page.mouse.move(pointer.x, pointer.y)
  await page.waitForTimeout(150)
  await drainAudit(page)

  const scrollYBefore = await page.evaluate(() => window.scrollY)
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.wheel(0, deltaY)
  if (alt) await page.keyboard.up('Alt')
  await page.waitForTimeout(600)
  const prevented = await drainAudit(page)
  const scrollYAfter = await page.evaluate(() => window.scrollY)

  return {
    pointerInsideChart,
    pointer,
    chartBox: box,
    scrollYBefore,
    scrollYAfter,
    scrolled: scrollYAfter !== scrollYBefore,
    prevented,
  }
}

export interface HoverResult {
  selector: string
  index: number
  found: boolean
  /** Hovering must not move the thing being hovered. */
  shifted: boolean
  boxBefore: Box | null
  boxAfter: Box | null
}

/**
 * Hover each match of `selector` and check the hovered element does not move
 * under the pointer — the failure mode that makes a hover target unclickable.
 */
export async function probeHoverTargets(
  page: Page,
  selector: string,
  limit = 3,
): Promise<HoverResult[]> {
  const locator = page.locator(selector)
  const total = Math.min(await locator.count(), limit)
  const results: HoverResult[] = []
  for (let index = 0; index < total; index += 1) {
    const target = locator.nth(index)
    // Measure in document coordinates. Viewport-relative boxes move whenever
    // hover() scrolls the element into view, which is not a layout shift.
    const documentBox = () =>
      target
        .evaluate(node => {
          const rect = node.getBoundingClientRect()
          return {
            x: rect.x + window.scrollX,
            y: rect.y + window.scrollY,
            width: rect.width,
            height: rect.height,
          }
        })
        .catch(() => null)

    // Settle any scrolling before the baseline so hover cannot introduce it.
    await target.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(200)
    const boxBefore = await documentBox()
    if (!boxBefore) {
      results.push({ selector, index, found: false, shifted: false, boxBefore: null, boxAfter: null })
      continue
    }
    await target.hover({ force: true }).catch(() => {})
    await page.waitForTimeout(350)
    const boxAfter = await documentBox()
    const shifted =
      !boxAfter || Math.abs(boxAfter.x - boxBefore.x) > 1 || Math.abs(boxAfter.y - boxBefore.y) > 1
    results.push({ selector, index, found: true, shifted, boxBefore, boxAfter })
  }
  return results
}

export interface OcclusionResult {
  chart: Box | null
  tooltip: Box | null
  /** Share of the chart's area covered by the hover tooltip, 0–1. */
  coveredFraction: number
}

/**
 * Measure how much of the chart its own hover tooltip hides. At narrow chart
 * widths a fixed-width tooltip can cover most of the plot it explains.
 */
export async function probeHoverOcclusion(
  page: Page,
  chartSelector: string,
  tooltipSelector: string,
): Promise<OcclusionResult> {
  const chartLocator = page.locator(chartSelector).first()
  const chart = await chartLocator.boundingBox().catch(() => null)
  if (!chart) return { chart: null, tooltip: null, coveredFraction: 0 }
  await page.mouse.move(chart.x + chart.width * 0.5, chart.y + chart.height * 0.5)
  await page.waitForTimeout(500)
  const tooltip = await page
    .locator(tooltipSelector)
    .first()
    .boundingBox()
    .catch(() => null)
  if (!tooltip) return { chart, tooltip: null, coveredFraction: 0 }
  const overlapWidth = Math.max(
    0,
    Math.min(chart.x + chart.width, tooltip.x + tooltip.width) - Math.max(chart.x, tooltip.x),
  )
  const overlapHeight = Math.max(
    0,
    Math.min(chart.y + chart.height, tooltip.y + tooltip.height) - Math.max(chart.y, tooltip.y),
  )
  const chartArea = chart.width * chart.height
  return {
    chart,
    tooltip,
    coveredFraction: chartArea > 0 ? (overlapWidth * overlapHeight) / chartArea : 0,
  }
}

/**
 * Drift item 5. Ordinary vertical wheel movement over the chart must scroll the
 * page and must not be preventDefault()ed; Alt+wheel is the documented chart
 * gesture and is the only path allowed to consume the event.
 *
 * Each gesture is measured from a fresh hover so the page scroll caused by the
 * first one cannot move the chart out from under the second.
 */
export async function probeWheelBehaviour(page: Page, selector: string): Promise<WheelProbe> {
  const plain = await wheelOverChart(page, selector, false, 650)
  // Order matters: probe the full-range boundary before zooming in, so the
  // zoom-out case is genuinely measured at full range.
  const altZoomOutAtFullRange = await wheelOverChart(page, selector, true, 650)
  const altZoomIn = await wheelOverChart(page, selector, true, -650)
  return {
    chartFound: Boolean(plain && altZoomIn && altZoomOutAtFullRange),
    plain,
    altZoomIn,
    altZoomOutAtFullRange,
  }
}
