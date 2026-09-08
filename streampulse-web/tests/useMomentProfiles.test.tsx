import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMomentProfiles } from '../src/hooks/useMomentProfiles'

const mocks = vi.hoisted(() => ({ load: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/lib/momentsApiClient', () => ({ getBackendUrl: () => 'https://api.streampulse.stream' }))
vi.mock('../src/lib/newsroomProfiles', () => ({
  loadNewsroomProfiles: mocks.load,
  getCachedNewsroomProfile: () => undefined,
  newsroomProfileUrl: (value?: string) => value,
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('moment profile loading', () => {
  it('retains pending enrichment across review rerenders and aborts on unmount', () => {
    const items = [{ login: 'creator' }]
    const view = renderHook(() => useMomentProfiles([...items]))
    expect(view.result.current[0].login).toBe('creator')
    expect(mocks.load).toHaveBeenCalledOnce()
    const signal = mocks.load.mock.calls[0][1] as AbortSignal
    view.rerender()
    view.rerender()
    expect(signal.aborted).toBe(false)
    expect(mocks.load).toHaveBeenCalledOnce()
    view.unmount()
    expect(signal.aborted).toBe(true)
  })
})
