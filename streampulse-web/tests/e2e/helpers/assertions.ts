import { expect, type Page } from '@playwright/test'

const ANALYTICS_ROOT_SELECTORS = [
  '.figma-analytics',
  '.sc-analytics-console',
  'main[aria-label*="Analytics"]',
  'main[aria-label*="StreamPulse analytics"]',
].join(', ')

export interface ViewportSize {
  width: number
  height: number
}

export function attachConsoleErrorGuard(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

export async function assertNoConsoleErrors(_page: Page, errors: string[]): Promise<void> {
  expect(errors, errors.join('\n')).toEqual([])
}

/** Portal guardrail: flag harsh opaque/near-opaque white card fills (not tokenized low-alpha tints). */
export async function assertNoWhiteAnalyticsSurfaces(page: Page): Promise<void> {
  const violations = await page.evaluate(() => {
    const root = document.querySelector('.figma-analytics__main, .hub-command-center, main')
    if (!root) return [] as string[]
    const nodes = root.querySelectorAll(
      '[class*="figma"], [class*="hub-"], [class*="pulse-moments"], [class*="activity-bucket"], [class*="hx-search"]',
    )
    const hits: string[] = []
    const isHarshWhite = (bg: string): boolean => {
      const opaque = bg.match(/^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/i)
      if (opaque) return true
      const alpha = bg.match(/^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)$/i)
      if (alpha) return Number(alpha[1]) >= 0.08
      return false
    }
    nodes.forEach((node) => {
      const bg = getComputedStyle(node).backgroundColor
      if (isHarshWhite(bg)) {
        const label = node.className?.toString().slice(0, 80) || node.tagName
        hits.push(`${label}: ${bg}`)
      }
    })
    return hits
  })
  expect(violations, violations.join('\n')).toEqual([])
}

/** Fail when the document is wider than the viewport (horizontal page scroll). */
export async function assertNoPageHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    const body = document.body
    const docOverflow = doc.scrollWidth > doc.clientWidth + 1
    const bodyOverflow = body ? body.scrollWidth > body.clientWidth + 1 : false
    return docOverflow || bodyOverflow
  })
  expect(overflow, 'page-level horizontal overflow detected').toBe(false)
}

type ScrollbarViolation = {
  tag: string
  className: string
  overflowX: string
  overflowY: string
  scrollbarWidth: string
  horizontalGutter: number
  verticalGutter: number
}

/** Fail when any scrollable analytics region shows a classic scrollbar gutter. */
export async function assertNoVisibleScrollbars(
  page: Page,
  rootSelector = ANALYTICS_ROOT_SELECTORS,
): Promise<void> {
  await assertNoPageHorizontalOverflow(page)

  const violations = await page.evaluate((selector) => {
    const roots = Array.from(document.querySelectorAll(selector))
    const scope = roots.length > 0 ? roots : [document.body]
    const seen = new Set<Element>()
    const hits: ScrollbarViolation[] = []

    const allowsScroll = (value: string): boolean =>
      value === 'auto' || value === 'scroll' || value === 'overlay'

    const visit = (el: Element) => {
      if (!(el instanceof HTMLElement) || seen.has(el)) return
      seen.add(el)

      const style = getComputedStyle(el)
      const overflowX = style.overflowX
      const overflowY = style.overflowY
      const canScrollX = allowsScroll(overflowX) && el.scrollWidth > el.clientWidth + 1
      const canScrollY = allowsScroll(overflowY) && el.scrollHeight > el.clientHeight + 1
      if (!canScrollX && !canScrollY) {
        Array.from(el.children).forEach(visit)
        return
      }

      const horizontalGutter = el.offsetWidth - el.clientWidth
      const verticalGutter = el.offsetHeight - el.clientHeight
      const scrollbarWidth = style.scrollbarWidth
      const webkitHidden =
        scrollbarWidth === 'none' ||
        (horizontalGutter <= 0 && verticalGutter <= 0)

      if (!webkitHidden && (horizontalGutter > 0 || verticalGutter > 0)) {
        hits.push({
          tag: el.tagName.toLowerCase(),
          className: (el.className?.toString() ?? '').slice(0, 120),
          overflowX,
          overflowY,
          scrollbarWidth,
          horizontalGutter,
          verticalGutter,
        })
      }

      Array.from(el.children).forEach(visit)
    }

    scope.forEach(visit)
    return hits
  }, rootSelector)

  expect(
    violations,
    violations
      .map(
        (v) =>
          `${v.tag}.${v.className || '(no class)'} overflow=${v.overflowX}/${v.overflowY} scrollbarWidth=${v.scrollbarWidth} gutter=${v.horizontalGutter}x${v.verticalGutter}`,
      )
      .join('\n'),
  ).toEqual([])
}

/** Smoke layout expectations per breakpoint (hub landing). */
export async function assertResponsiveLayout(page: Page, viewport: ViewportSize): Promise<void> {
  if (viewport.width < 1100) {
    await expect(page.locator('.figma-analytics__frame--no-sidebar, .figma-analytics__frame')).toBeVisible()
    const embeddedGrid = page.locator('.figma-activity-hub .pulse-moments-live--embedded .pulse-moments-live__grid')
    if ((await embeddedGrid.count()) > 0) {
      const columnCount = await embeddedGrid.evaluate((el) => {
        const raw = getComputedStyle(el).gridTemplateColumns.trim()
        if (!raw || raw === 'none') return 0
        return raw.split(/\s+/).length
      })
      expect(columnCount, 'embedded pulse moments should stack on narrow viewports').toBeLessThanOrEqual(1)
    }
  } else {
    await expect(page.getByRole('navigation', { name: /Analytics sections/i })).toBeVisible()
  }
}