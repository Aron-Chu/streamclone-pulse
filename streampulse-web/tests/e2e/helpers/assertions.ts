import { expect, type Page } from '@playwright/test'

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