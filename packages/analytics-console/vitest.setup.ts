import { afterEach, beforeEach } from 'vitest'
import { resetChartWheelGuard } from './src/components/analytics/ChartNavigator.tsx'
import { resetChartScrollZoomMemory } from './src/components/analytics/chartScrollZoom.ts'

// The Scroll zoom preference and the scroll-through guard are page-wide;
// every test starts from a fresh page: preference on, no recent page scroll.
beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    // Storage may be stubbed out by a test.
  }
  resetChartScrollZoomMemory()
  resetChartWheelGuard()
})

afterEach(() => {
  resetChartScrollZoomMemory()
  resetChartWheelGuard()
})
