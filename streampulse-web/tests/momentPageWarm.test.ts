import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { request, page } = vi.hoisted(() => ({ request: vi.fn(), page: { loads: 0 } }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: request }))
// The page's own code: its factory runs when the page's chunk is first asked for.
vi.mock('../src/routes/analytics/MomentWatchPage', () => {
  page.loads += 1
  return { default: () => null }
})
import { momentPageWarmth, warmMomentPage } from '../src/lib/momentPageFlag'
import { forgetFailedMomentReads, resetMomentReads } from '../src/lib/momentReads'

const AT = Date.UTC(2026, 10, 14, 10, 40, 30)
const stream = { channel: 'creator', stream: { streamId: '9000001', login: 'creator', startedAt: '2026-11-14T09:59:30Z' } }
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
const paths = () => request.mock.calls.map(([path]) => path as string)

beforeEach(() => {
  request.mockReset()
  request.mockImplementation(async (path: string) => ({ data: path.endsWith('/recap') ? { streamId: '9000001', topMoments: [] } : stream }))
  resetMomentReads()
})
afterEach(() => vi.unstubAllEnvs())

describe('warming a Moment page from its link', () => {
  it('does nothing while the page is switched off or the link is not one, then reads and loads once when it is', async () => {
    for (const value of ['', 'off', 'true', '0']) {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', value)
      warmMomentPage({ streamId: '9000001', at: AT })
    }
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    warmMomentPage({ streamId: '9000001', at: null })
    warmMomentPage({ streamId: '9000001', at: Number.NaN })
    warmMomentPage({ streamId: 'not-a-stream', at: AT })
    warmMomentPage({ streamId: '9'.repeat(21), at: AT })
    await settle()
    expect(request).not.toHaveBeenCalled()
    expect(page.loads).toBe(0)

    // Focus, as when tabbing through a list, loads only the page's code.
    momentPageWarmth({ streamId: '9000001', at: AT }).onFocus()
    await settle()
    expect(request).not.toHaveBeenCalled()
    expect(page.loads).toBe(1)

    // A press, then another: one stream read, one recap read, the same chunk.
    warmMomentPage({ streamId: '9000001', at: AT })
    warmMomentPage({ streamId: '9000001', at: AT })
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', '1')
    warmMomentPage({ streamId: '9000001', at: AT + 60_000 })
    await settle()
    expect(paths().sort()).toEqual(['/v1/portal/analytics/streams/9000001', '/v1/portal/analytics/streams/9000001/recap'])
    expect(page.loads).toBe(1)
  })

  it('swallows a failed read: the page reads again and shows its own error', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    request.mockRejectedValue({ kind: 'unreachable', message: 'Network error', status: 0 })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      warmMomentPage({ streamId: '9000002', at: AT })
      await settle()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
    expect(unhandled).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(2)
    // The failure is kept a few seconds: the page opening right after shows it without asking again.
    warmMomentPage({ streamId: '9000002', at: AT })
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    // Its Try again forgets the failure, so the next read asks again.
    request.mockResolvedValue({ data: { ...stream, stream: { ...stream.stream, streamId: '9000002' } } })
    forgetFailedMomentReads('9000002')
    warmMomentPage({ streamId: '9000002', at: AT })
    await settle()
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('gives a link a press that warms the reads and a focus that reads nothing (no touch handler)', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    const handlers = momentPageWarmth({ streamId: '9000003', at: AT })
    expect(Object.keys(handlers).sort()).toEqual(['onFocus', 'onPointerDown'])
    handlers.onFocus()
    await settle()
    expect(request).not.toHaveBeenCalled()
    handlers.onPointerDown()
    handlers.onPointerDown()
    await settle()
    expect(paths().sort()).toEqual(['/v1/portal/analytics/streams/9000003', '/v1/portal/analytics/streams/9000003/recap'])
  })
})
