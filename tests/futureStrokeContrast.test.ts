import { describe, expect, it } from 'vitest'
import {
  AFTER_CURSOR_OPACITY,
  FUTURE_STROKE_MIN_OPACITY,
  futureStrokeOpacity,
} from '../src/ui/chartTheme.ts'
import { contrastRatio } from '../src/ui/surfaceTheme.ts'

/** Composite a stroke colour over the chart background at `alpha`, then measure. */
function compositeContrast(fg: [number, number, number], bg: [number, number, number], alpha: number): number {
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  const mixed = fg.map((channel, i) => channel * alpha + bg[i]! * (1 - alpha))
  return contrastRatio(`#${mixed.map(hex).join('')}`, `#${bg.map(hex).join('')}`)
}

// FUTURE_STROKE in PulseOverviewChart / the darkest chart surface it draws on.
const FUTURE_STROKE_RGB: [number, number, number] = [180, 180, 192]
const CHART_BG_RGB: [number, number, number] = [0x10, 0x10, 0x14]

describe('futureStrokeOpacity', () => {
  it('floors the ahead-of-now stroke at the legibility threshold', () => {
    expect(futureStrokeOpacity(AFTER_CURSOR_OPACITY)).toBe(FUTURE_STROKE_MIN_OPACITY)
    expect(futureStrokeOpacity(0.95 * AFTER_CURSOR_OPACITY)).toBe(FUTURE_STROKE_MIN_OPACITY)
  })

  it('keeps a stroke that is already legible instead of boosting it', () => {
    expect(futureStrokeOpacity(0.8)).toBe(0.8)
  })

  it('never exceeds full opacity', () => {
    expect(futureStrokeOpacity(1.4)).toBe(1)
  })

  it('keeps a fully hidden layer hidden', () => {
    expect(futureStrokeOpacity(0)).toBe(0)
    expect(futureStrokeOpacity(Number.NaN)).toBe(0)
  })
})

describe('ahead-of-now stroke contrast', () => {
  it('clears the WCAG 1.4.11 3:1 floor for graphical objects', () => {
    const contrast = compositeContrast(FUTURE_STROKE_RGB, CHART_BG_RGB, FUTURE_STROKE_MIN_OPACITY)
    expect(contrast).toBeGreaterThanOrEqual(3)
  })

  it('regression: the old unfloored value was effectively invisible', () => {
    // rgba(161, 161, 170, 0.58) * AFTER_CURSOR_OPACITY
    const old = compositeContrast([161, 161, 170], CHART_BG_RGB, 0.58 * AFTER_CURSOR_OPACITY)
    expect(old).toBeLessThan(2)
  })

  it('stays recessive rather than competing with the coloured past', () => {
    expect(FUTURE_STROKE_MIN_OPACITY).toBeLessThan(0.75)
  })
})
