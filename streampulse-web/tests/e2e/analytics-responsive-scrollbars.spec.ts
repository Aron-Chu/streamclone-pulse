import { test, expect } from '@playwright/test'
import {
  attachConsoleErrorGuard,
  assertNoConsoleErrors,
  assertNoPageHorizontalOverflow,
  assertNoVisibleScrollbars,
  assertResponsiveLayout,
} from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'
import { installMockApi } from './helpers/mockApi'
import { installPortalConsoleMock } from './helpers/portalConsoleMock'

const VIEWPORTS = [
  { name: 'iphone-390', width: 390, height: 844 },
  { name: 'ipad-768', width: 768, height: 1024 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'desktop-1366', width: 1366, height: 900 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1600', width: 1600, height: 900 },
] as const

type RouteTarget = {
  slug: string
  path: string
  readySelector: string
  kind: 'hub' | 'console'
}

const TARGETS: RouteTarget[] = [
  {
    slug: 'hub',
    path: '/analytics',
    readySelector: '.figma-global-activity__hub-chart .hx-chart2, #section-pulse-moments',
    kind: 'hub',
  },
  {
    slug: 'channel',
    path: '/analytics/xqc',
    readySelector: '.sc-analytics-console',
    kind: 'console',
  },
  {
    slug: 'session',
    path: '/analytics/xqc/s/fixture-stream',
    readySelector: '.sc-analytics-console',
    kind: 'console',
  },
]

async function assertAnalyticsChrome(page: import('@playwright/test').Page): Promise<void> {
  await assertNoPageHorizontalOverflow(page)
  await assertNoVisibleScrollbars(page)
}

async function interactHub(page: import('@playwright/test').Page): Promise<void> {
  const search = page.getByPlaceholder(/search channels/i)
  if (await search.isVisible().catch(() => false)) {
    await search.click()
    await page.keyboard.press('Escape')
  }

  const chart = page.locator('.figma-global-activity__hub-chart .hx-chart2')
  if (await chart.isVisible().catch(() => false)) {
    const box = await chart.boundingBox()
    if (box) {
      await chart.click({ position: { x: Math.max(8, box.width * 0.55), y: box.height * 0.5 } })
    }
  }

  const momentRow = page.locator('.pulse-moments__row').first()
  if (await momentRow.isVisible().catch(() => false)) {
    await momentRow.click()
  }
}

async function interactConsole(page: import('@playwright/test').Page): Promise<void> {
  const momentsTab = page.locator('.sc-analytics-console').getByRole('button', { name: 'Moments' })
  if (await momentsTab.isVisible().catch(() => false)) {
    await momentsTab.click()
  }

  const sidebar = page.locator('.sc-analytics-console .sc-console-scroll').first()
  if (await sidebar.isVisible().catch(() => false)) {
    await sidebar.evaluate((el) => {
      el.scrollTop = Math.min(120, el.scrollHeight)
    })
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`analytics responsive scrollbars @ ${viewport.name}`, () => {
    for (const target of TARGETS) {
      test(`${target.slug} — no visible scrollbars`, async ({ page }, testInfo) => {
        const errors = attachConsoleErrorGuard(page)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })

        if (target.kind === 'hub') {
          await installHubUxMock(page)
        } else {
          await installMockApi(page)
          await installPortalConsoleMock(page)
        }

        await page.goto(target.path, { waitUntil: 'domcontentloaded' })
        await page.locator(target.readySelector).first().waitFor({ state: 'visible', timeout: 45_000 })

        if (target.kind === 'hub') {
          await assertResponsiveLayout(page, viewport)
        } else {
          await expect(page.getByRole('main', { name: /Analytics for xqc/i })).toBeVisible()
        }

        const audit = async () => {
          try {
            await assertAnalyticsChrome(page)
          } catch (error) {
            await page.screenshot({
              path: testInfo.outputPath(`${viewport.name}-${target.slug}.png`),
              fullPage: true,
            })
            throw error
          }
        }

        await audit()

        if (target.kind === 'hub') {
          await interactHub(page)
        } else {
          await interactConsole(page)
        }

        await audit()
        await assertNoConsoleErrors(page, errors)
      })
    }
  })
}
