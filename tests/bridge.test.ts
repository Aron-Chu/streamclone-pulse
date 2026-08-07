import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendBackgroundMessage } from '../src/content/bridge.ts'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

afterEach(() => {
  vi.restoreAllMocks()
  if (originalChrome === undefined) delete (globalThis as { chrome?: unknown }).chrome
  else (globalThis as { chrome?: unknown }).chrome = originalChrome
})

describe('sendBackgroundMessage transport failures', () => {
  it('converts a missing service worker rejection into a recoverable error', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'extension-id',
        sendMessage: vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.')),
      },
    }

    await expect(sendBackgroundMessage({ type: 'HEALTH' })).resolves.toEqual({
      ok: false,
      error: 'extension_context_invalidated',
    })
  })

  it('converts arbitrary runtime transport failures into a retryable error', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'extension-id',
        sendMessage: vi.fn().mockRejectedValue(new Error('The message port closed unexpectedly')),
      },
    }

    await expect(sendBackgroundMessage({ type: 'HEALTH' })).resolves.toEqual({
      ok: false,
      error: 'background_unreachable',
    })
  })
})
