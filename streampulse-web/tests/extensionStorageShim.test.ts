import {
  getDefaultChartWindow,
  migrateDefaultChartWindowToFullV3Once,
} from '../src/shims/extension-storage'
import { describe, expect, it } from 'vitest'

describe('portal extension-storage shim', () => {
  it('keeps the chart-window migration contract used by extension UI', async () => {
    await expect(migrateDefaultChartWindowToFullV3Once()).resolves.toBeUndefined()
    await expect(getDefaultChartWindow()).resolves.toBe('60m')
  })
})
