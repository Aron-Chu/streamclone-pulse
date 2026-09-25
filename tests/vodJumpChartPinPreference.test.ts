import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_VOD_JUMP_CHART_PIN_ENABLED,
  getVodJumpChartPinEnabled,
  setVodJumpChartPinEnabled,
} from '../src/shared/storage.ts'

describe('VOD jump chart pin preference', () => {
  it('defaults to enabled when no value is stored', async () => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: {
        sync: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
      },
    })
    expect(DEFAULT_VOD_JUMP_CHART_PIN_ENABLED).toBe(true)
    await expect(getVodJumpChartPinEnabled()).resolves.toBe(true)
    vi.unstubAllGlobals()
  })

  it('round-trips an explicit disabled value', async () => {
    let stored: Record<string, unknown> = {}
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: {
        sync: {
          get: vi.fn(async () => ({ ...stored })),
          set: vi.fn(async (next: Record<string, unknown>) => { stored = { ...stored, ...next } }),
        },
      },
    })
    await setVodJumpChartPinEnabled(false)
    await expect(getVodJumpChartPinEnabled()).resolves.toBe(false)
    vi.unstubAllGlobals()
  })
})
