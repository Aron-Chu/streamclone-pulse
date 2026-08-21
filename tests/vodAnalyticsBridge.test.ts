import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readVodAnalyticsBridge,
  rememberVodAnalyticsBridge,
  resolveVodAnalyticsBridge,
  VOD_ANALYTICS_BRIDGE_STORAGE_KEY,
  type VodAnalyticsBridge,
} from '../src/shared/vodAnalyticsBridge.ts'

const now = 1_700_000_000_000

function record(overrides: Partial<VodAnalyticsBridge> = {}): VodAnalyticsBridge {
  return {
    vodId: '2839940123',
    login: 'xqc',
    streamId: '319796892764',
    savedAtMs: now,
    ...overrides,
  }
}

describe('resolveVodAnalyticsBridge', () => {
  it('returns the live session identity for the same VOD', () => {
    expect(resolveVodAnalyticsBridge(record(), '2839940123', now)).toEqual({
      login: 'xqc',
      streamId: '319796892764',
    })
  })

  it('ignores a bridge for a different VOD or an expired record', () => {
    expect(resolveVodAnalyticsBridge(record(), '1111111111', now)).toBeNull()
    expect(resolveVodAnalyticsBridge(record({ savedAtMs: now - 16 * 60 * 1000 }), '2839940123', now)).toBeNull()
  })
})

describe('vod analytics bridge storage fail-open', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when content-script session storage is denied', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: vi.fn(async () => {
            throw new Error('Access to storage is not allowed from this context.')
          }),
        },
      },
    })

    await expect(readVodAnalyticsBridge('2839940123')).resolves.toBeNull()
  })

  it('does not reject when remembering a VOD login from a denied session store', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          set: vi.fn(async () => {
            throw new Error('Access to storage is not allowed from this context.')
          }),
        },
      },
    })

    await expect(
      rememberVodAnalyticsBridge({ vodId: '2839940123', login: 'xqc' }),
    ).resolves.toBeUndefined()
  })

  it('still reads a usable bridge when session storage is allowed', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: vi.fn(async () => ({
            [VOD_ANALYTICS_BRIDGE_STORAGE_KEY]: record({ savedAtMs: Date.now() }),
          })),
        },
      },
    })

    await expect(readVodAnalyticsBridge('2839940123')).resolves.toEqual({
      login: 'xqc',
      streamId: '319796892764',
    })
  })
})
