// B-02 stress: scrub 3× round-trips with no settle delay; count all shifts during the scrub itself.

import { test } from '@playwright/test'

test('B-02 page-load CLS', async ({ page }) => {
  await page.addInitScript(() => {
    type Win = Window & { __shifts?: unknown[] }
    type LayoutShiftEntry = PerformanceEntry & {
      readonly value: number
      readonly sources?: readonly { readonly node?: Node | null }[]
    }
    const w = window as Win
    w.__shifts = []
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as LayoutShiftEntry
        const sources = (shift.sources ?? []).map((s) => {
          const node = s.node
          return {
            cls:
              node && (node as HTMLElement).className
                ? String((node as HTMLElement).className).slice(0, 80)
                : null,
          }
        })
        w.__shifts!.push({
          t: entry.startTime,
          v: shift.value,
          sources,
        })
      }
    })
    obs.observe({ type: 'layout-shift', buffered: true })
    ;(window as Win & { __obs?: PerformanceObserver }).__obs = obs
  })

  await page.goto('/analytics', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3_000)

  const shifts = await page.evaluate(() => {
    type Win = Window & { __shifts?: unknown[] }
    return (window as Win).__shifts ?? []
  })

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        count: shifts.length,
        totalValue: shifts.reduce(
          (a: number, s) => a + ((s as { v: number }).v || 0),
          0,
        ),
        topSources: (() => {
          const m = new Map<string | null, number>()
          for (const s of shifts) {
            for (const src of (s as { sources: { cls: string | null }[] }).sources) {
              m.set(src.cls, (m.get(src.cls) || 0) + 1)
            }
          }
          return Array.from(m.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([cls, n]) => ({ cls, n }))
        })(),
      },
      null,
      2,
    ),
  )
})

test('B-02 window-switch CLS', async ({ page }) => {
  await page.addInitScript(() => {
    type Win = Window & { __shifts?: unknown[] }
    type LayoutShiftEntry = PerformanceEntry & {
      readonly value: number
      readonly sources?: readonly { readonly node?: Node | null }[]
    }
    const w = window as Win
    w.__shifts = []
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as LayoutShiftEntry
        const sources = (shift.sources ?? []).map((s) => {
          const node = s.node
          return {
            cls:
              node && (node as HTMLElement).className
                ? String((node as HTMLElement).className).slice(0, 80)
                : null,
          }
        })
        w.__shifts!.push({
          t: entry.startTime,
          v: shift.value,
          sources,
        })
      }
    })
    obs.observe({ type: 'layout-shift', buffered: true })
    ;(window as Win & { __obs?: PerformanceObserver }).__obs = obs
  })

  await page.goto('/analytics', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2_000)

  // Wipe buffered shifts so we only measure the window-switch.
  await page.evaluate(() => {
    type Win = Window & { __shifts?: unknown[] }
    ;(window as Win).__shifts = []
  })

  // Find window-tab buttons (24h, 6h, 30d).
  const tabs = await page.locator('.hx-range-tabs button').allTextContents()
  // eslint-disable-next-line no-console
  console.log('tabs found:', tabs)

  for (const label of ['6h', '30d', '24h', '6h', '30d', '24h']) {
    const tab = page.locator('.hx-range-tabs button', { hasText: new RegExp(`^${label}$`, 'i') }).first()
    if (await tab.count()) {
      await tab.click()
      await page.waitForTimeout(800)
    }
  }
  await page.waitForTimeout(1_500)

  const shifts = await page.evaluate(() => {
    type Win = Window & { __shifts?: unknown[] }
    return (window as Win).__shifts ?? []
  })

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        count: shifts.length,
        totalValue: shifts.reduce(
          (a: number, s) => a + ((s as { v: number }).v || 0),
          0,
        ),
        topSources: (() => {
          const m = new Map<string | null, number>()
          for (const s of shifts) {
            for (const src of (s as { sources: { cls: string | null }[] }).sources) {
              m.set(src.cls, (m.get(src.cls) || 0) + 1)
            }
          }
          return Array.from(m.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([cls, n]) => ({ cls, n }))
        })(),
      },
      null,
      2,
    ),
  )
})

test('B-02 chart scrub CLS stress', async ({ page }) => {
  await page.goto('/analytics')

  const chart = page.locator('.hx-chart2').first()
  await chart.waitFor({ state: 'visible', timeout: 30_000 })

  await page.evaluate(() => {
    type Win = Window & { __shifts?: unknown[] }
    type LayoutShiftEntry = PerformanceEntry & {
      readonly value: number
      readonly sources?: readonly { readonly node?: Node | null }[]
    }
    const w = window as Win
    w.__shifts = []
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as LayoutShiftEntry
        const sources = (shift.sources ?? []).map((s) => {
          const node = s.node
          return {
            cls:
              node && (node as HTMLElement).className
                ? String((node as HTMLElement).className).slice(0, 80)
                : null,
          }
        })
        w.__shifts!.push({
          t: entry.startTime,
          v: shift.value,
          had: (shift as LayoutShiftEntry & { hadRecentInput?: boolean }).hadRecentInput,
          sources,
        })
      }
    })
    obs.observe({ type: 'layout-shift', buffered: false })
    ;(window as Win & { __obs?: PerformanceObserver }).__obs = obs
  })

  const box = await chart.boundingBox()
  if (!box) throw new Error('chart not laid out')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.05, y)
  await page.mouse.down()

  for (let pass = 0; pass < 3; pass += 1) {
    const steps = 40
    const dir = pass % 2 === 0 ? 1 : -1
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps
      const x =
        box.x + box.width * (0.05 + 0.9 * (dir > 0 ? t : 1 - t))
      await page.mouse.move(x, y)
    }
  }
  await page.mouse.up()
  await page.waitForTimeout(500)

  const shifts = await page.evaluate(() => {
    type Win = Window & { __shifts?: unknown[] }
    return (window as Win).__shifts ?? []
  })

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        count: shifts.length,
        totalValue: shifts.reduce(
          (a: number, s) => a + ((s as { v: number }).v || 0),
          0,
        ),
        topSources: (() => {
          const m = new Map<string | null, number>()
          for (const s of shifts) {
            for (const src of (s as { sources: { cls: string | null }[] }).sources) {
              m.set(src.cls, (m.get(src.cls) || 0) + 1)
            }
          }
          return Array.from(m.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([cls, n]) => ({ cls, n }))
        })(),
        firstFew: shifts.slice(0, 4),
      },
      null,
      2,
    ),
  )
})
