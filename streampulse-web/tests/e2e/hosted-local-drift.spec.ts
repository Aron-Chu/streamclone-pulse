import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIT_EVIDENCE_DIR } from './helpers/driftAudit'

/**
 * Side-by-side hosted vs local capture for the Explorer / Moments / activity
 * calendar surfaces.
 *
 * Purely descriptive: it records what each surface *is* so the drift can be
 * classified by hand. It asserts nothing, because "hosted differs from local"
 * is the subject of the comparison, not a failure.
 *
 * Local is captured twice on the data-bearing routes:
 *  - `local` uses the same hosted API as production, so the data comparison is
 *    apples to apples (both hit the 503).
 *  - `local+fixture` routes discovery through the dev shim, which is the only
 *    way to see the intended structure while the projection is degraded.
 */

const HOSTED = 'https://streampulse.stream'
const SHIM = process.env.SP_FIXTURE_ORIGIN?.trim() || 'http://127.0.0.1:8099'
const outDir = join(AUDIT_EVIDENCE_DIR, 'drift-compare')

interface Surface {
  slug: string
  url: string
  /** Seed the dev backend override so discovery comes from the fixture shim. */
  fixture?: boolean
}

const SURFACES: Surface[] = [
  { slug: 'hosted-explore', url: `${HOSTED}/analytics/explore` },
  { slug: 'hosted-moments', url: `${HOSTED}/analytics/moments` },
  { slug: 'hosted-moments-history', url: `${HOSTED}/analytics/moments?collection=history&creator=ohnepixel` },
  { slug: 'local-explore', url: '/analytics/explore' },
  { slug: 'local-moments', url: '/analytics/moments' },
  { slug: 'local-moments-history', url: '/analytics/moments?collection=history&creator=ohnepixel' },
  { slug: 'local-moments-history-fixture', url: '/analytics/moments?collection=history&creator=ohnepixel', fixture: true },
  { slug: 'local-moments-day-fixture', url: '/analytics/moments?collection=history&month=2026-09&creator=ohnepixel&day=2026-09-03', fixture: true },
]

/** Probe by visible text and structure, so an older hosted build still reports. */
async function describeSurface(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const seen = (selector: string) => document.querySelectorAll(selector).length
    const text = document.body.innerText
    const has = (needle: RegExp) => needle.test(text)
    const controlLabels = [...document.querySelectorAll('label, [aria-label]')]
      .map(node => (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 40))
      .filter(Boolean)
    return {
      finalUrl: location.href,
      title: document.title,
      robots: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null,
      h1: [...document.querySelectorAll('h1')].map(n => n.textContent?.trim() ?? ''),
      h2: [...document.querySelectorAll('h2')].map(n => n.textContent?.trim() ?? '').slice(0, 12),
      tabs: [...document.querySelectorAll('[role="tablist"] button, .moments-tabs button')]
        .map(n => n.textContent?.trim() ?? ''),
      calendar: {
        wrapper: seen('.discovery-calendar'),
        monthGrid: seen('.discovery-calendar__days'),
        dayCells: seen('.discovery-calendar__days button'),
        measuredDayCells: seen('.discovery-calendar__days button[data-state="measured"]'),
        legend: seen('.discovery-calendar__legend'),
        legendRampSwatches: seen('.discovery-calendar__legend-ramp i'),
        yearGrid: seen('.discovery-year__grid'),
        yearCells: seen('.discovery-year__grid button'),
        legacyYearLegend: seen('.discovery-year__legend'),
        modeButtons: [...document.querySelectorAll('.discovery-calendar__modes button')]
          .map(n => n.textContent?.trim() ?? ''),
        measureSelect: seen('[aria-label="Calendar measure"]'),
      },
      broadcasts: {
        sections: seen('.moments-broadcast'),
        tables: seen('.moments-broadcast__table'),
        strips: seen('.moments-broadcast__strip-track'),
        rows: seen('.moments-broadcast__open'),
      },
      results: {
        cards: seen('.moments-result'),
        resultList: seen('.moments-result-list'),
        detail: seen('.moments-detail'),
      },
      /** Explorer-specific controls the hosted build shipped. */
      explorerControls: controlLabels.filter(label =>
        /^(window|signal|category|state|sort)$/i.test(label),
      ),
      copy: {
        browseByDay: has(/Browse by day/i),
        browseStoredActivity: has(/Browse stored activity by day/i),
        storedDayUnavailable: has(/Stored-day browsing is unavailable|Stored history is (?:temporarily unavailable|not available)/i),
        explorerUnavailable: has(/Pulse Explorer is unavailable/i),
        pageNotFound: has(/Page not found/i),
      },
      bodyHead: text.slice(0, 400),
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }
  })
}

test.describe('hosted vs local drift capture', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    mkdirSync(outDir, { recursive: true })
  })

  for (const width of [1440, 390] as const) {
    test(`capture hosted and local surfaces @ ${width}`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(600_000)

      const rows: Record<string, unknown>[] = []
      for (const surface of SURFACES) {
        // A fresh context per surface: addInitScript persists for the life of a
        // page, so reusing one would leak the fixture override into the
        // hosted-API captures and quietly invalidate the comparison.
        const context = await browser.newContext({ viewport: { width, height: 900 } })
        const page = await context.newPage()
        if (surface.fixture) {
          await page.addInitScript(origin => {
            sessionStorage.setItem('sp.backendUrlOverride', origin)
          }, SHIM)
        }
        const target = surface.url.startsWith('http') ? surface.url : `${baseURL}${surface.url}`
        try {
          await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 })
          // Hosted is a cold CDN fetch plus hydration; give both room to settle.
          await page.waitForTimeout(6000)
          const described = await describeSurface(page)
          rows.push({ slug: surface.slug, requested: target, ...described })
          await page.screenshot({
            path: join(outDir, `${surface.slug}-${width}.png`),
            fullPage: true,
          })
          await testInfo.attach(`${surface.slug}-${width}.png`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          })
        } catch (error) {
          rows.push({
            slug: surface.slug,
            requested: target,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await context.close()
      }

      writeFileSync(join(outDir, `compare-${width}.json`), JSON.stringify(rows, null, 2))
    })
  }
})
