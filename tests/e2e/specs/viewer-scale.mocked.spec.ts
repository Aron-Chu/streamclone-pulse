/**
 * Diagnose / guard viewers-strip Y headroom in the extension overlay chart.
 * Plateau + brief spike must not leave a tall empty band above the teal line.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../helpers/testFixtures.ts'
import { PULSE_ROOT_ID, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../test-results/viewer-scale')

test.describe('viewers strip scale', () => {
  test('plateau viewers line sits near the top of the strip (Playwright measure)', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-viewer-plateau',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
        defaultChartWindow: 'full',
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await extension.page.waitForTimeout(700)

    mkdirSync(OUT, { recursive: true })

    const metrics = await extension.page.evaluate(async rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      if (!root) return { ok: false as const, reason: 'no-shadow' }

      const chartSvg = root.querySelector('svg[data-testid="pulse-overview-chart"]') as SVGSVGElement | null
      if (!chartSvg) {
        return { ok: false as const, reason: 'no-chart-svg' }
      }

      const axisMaxAttr = Number(chartSvg.getAttribute('data-viewer-axis-max') || 0)
      const rawMaxAttr = Number(chartSvg.getAttribute('data-viewer-raw-max') || 0)
      const plotTopAttr = Number(chartSvg.getAttribute('data-plot-top') || 0)

      chartSvg.scrollIntoView({ block: 'center' })

      const parts = (chartSvg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number)
      const vbH = parts[3] ?? 0
      const vbW = parts[2] ?? 0

      const paths = Array.from(chartSvg.querySelectorAll('path[stroke][fill="none"]'))
      const scored = paths.map(p => {
        const stroke = `${p.getAttribute('stroke') || ''} ${getComputedStyle(p).stroke}`.toLowerCase()
        const isViewer =
          stroke.includes('14b8c8')
          || stroke.includes('22d3ee')
          || stroke.includes('0e7490')
          || stroke.includes('rgb(20, 184, 200)')
          || stroke.includes('rgb(20,184,200)')
          || stroke.includes('rgb(34, 211, 238)')
        const len = typeof p.getTotalLength === 'function' ? p.getTotalLength() : 0
        return { p, isViewer, len, stroke }
      })
      scored.sort((a, b) => Number(b.isViewer) - Number(a.isViewer) || b.len - a.len)
      const chosen = scored[0]?.p
      if (!chosen || scored[0]!.len < 10) {
        return { ok: false as const, reason: 'no-viewer-path', strokes: scored.slice(0, 6).map(s => s.stroke.trim()) }
      }

      const samples: number[] = []
      const total = chosen.getTotalLength()
      for (let i = 0; i <= 24; i += 1) {
        samples.push(chosen.getPointAtLength((total * i) / 24).y)
      }
      const plateauYs = samples.slice(Math.floor(samples.length * 0.35))
      const medianY = [...plateauYs].sort((a, b) => a - b)[Math.floor(plateauYs.length / 2)]!

      const padBottom = 18
      const plotTop = plotTopAttr
      const plotHeight = Math.max(48, vbH - plotTop - padBottom)
      const stripShare = 0.28
      const bandTop = plotTop
      const bandBottom = plotTop + plotHeight * stripShare
      const bandHeight = Math.max(1, bandBottom - bandTop)
      const fracFromBandTop = (medianY - bandTop) / bandHeight

      return {
        ok: true as const,
        stroke: scored[0]!.stroke.trim(),
        medianY,
        bandTop,
        bandBottom,
        bandHeight,
        fracFromBandTop,
        vbH,
        vbW,
        axisMaxAttr,
        rawMaxAttr,
        plotTopAttr,
      }
    }, PULSE_ROOT_ID)

    // Cropped chart screenshot for visual review.
    const chartShot = await extension.page.evaluate(async rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const chartSvg = root?.querySelector('svg[data-testid="pulse-overview-chart"]')
      if (!chartSvg) return null
      const rect = chartSvg.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }, PULSE_ROOT_ID)

    if (chartShot && chartShot.width > 0 && chartShot.height > 0) {
      await extension.page.screenshot({
        path: join(OUT, 'viewer-plateau-chart.png'),
        animations: 'disabled',
        clip: {
          x: Math.max(0, chartShot.x - 4),
          y: Math.max(0, chartShot.y - 4),
          width: Math.min(800, chartShot.width + 8),
          height: Math.min(600, chartShot.height + 8),
        },
      })
    }

    await extension.page.screenshot({
      path: join(OUT, 'viewer-plateau-overlay.png'),
      animations: 'disabled',
    })
    writeFileSync(join(OUT, 'viewer-plateau-metrics.json'), JSON.stringify(metrics, null, 2))

    expect(metrics.ok, JSON.stringify(metrics)).toBe(true)
    if (!metrics.ok) return

    expect(
      metrics.fracFromBandTop,
      `viewers plateau too low in strip (fracFromBandTop=${metrics.fracFromBandTop} axis=${metrics.axisMaxAttr} raw=${metrics.rawMaxAttr}); see ${OUT}`,
    ).toBeLessThan(0.16)
    expect(metrics.axisMaxAttr).toBeLessThan(80_000)
    expect(metrics.fracFromBandTop).toBeGreaterThanOrEqual(-0.05)
    expect(metrics.plotTopAttr).toBeLessThanOrEqual(3)
  })
})
