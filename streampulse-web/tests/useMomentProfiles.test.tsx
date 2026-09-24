import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useMomentProfiles } from '../src/hooks/useMomentProfiles'
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../src/lib/apiClient', () => ({ getBackendUrl: () => 'https://api.streampulse.stream' }))
vi.mock('../src/lib/newsroomProfiles', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/newsroomProfiles')>(), loadNewsroomProfiles: mocks.load,
}))
afterEach(() => { cleanup(); mocks.load.mockReset() })
type ProfileRow = { login: string; profileImageUrl?: string }
describe('moment result profile enrichment', () => {
  it('deduplicates and caps missing identities without refetching equivalent renders', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ login: `creator${i}` }))
    const { rerender } = renderHook(({ rows }) => useMomentProfiles(rows), { initialProps: { rows: [...items, ...items] } })
    expect(mocks.load.mock.calls[0][0]).toHaveLength(20)
    rerender({ rows: [...items, ...items] })
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })
  it('does not request already safe profiles and accepts only current-scope callbacks', () => {
    const photo = 'https://static-cdn.jtvnw.net/jtv_user_pictures/profile.png'
    const { result, rerender, unmount } = renderHook(({ rows }) => useMomentProfiles(rows), {
      initialProps: { rows: [{ login: 'known', profileImageUrl: photo }, { login: 'missing' }] },
    })
    const [logins, signal, accept] = mocks.load.mock.calls[0]
    expect(logins).toEqual(['missing'])
    act(() => accept('missing', photo))
    expect(result.current.find(item => item.login === 'missing')?.profileImageUrl).toBe(photo)
    rerender({ rows: [{ login: 'other' }] })
    expect(signal.aborted).toBe(true)
    act(() => accept('missing', photo))
    expect(result.current).toEqual([{ login: 'other' }])
    const nextSignal = mocks.load.mock.calls[1][1]
    unmount()
    expect(nextSignal.aborted).toBe(true)
  })
  it('keeps profiles and the in-flight request when the same login set reverses', () => {
    const photo = 'https://static-cdn.jtvnw.net/jtv_user_pictures/profile.png'
    const rows: ProfileRow[] = [{ login: 'alpha' }, { login: 'bravo' }, { login: 'charlie' }]
    const { result, rerender } = renderHook(({ items }) => useMomentProfiles(items), { initialProps: { items: rows } })
    const [, signal, accept] = mocks.load.mock.calls[0]
    act(() => accept('alpha', photo))
    expect(result.current[0].profileImageUrl).toBe(photo)

    rerender({ items: [...rows].reverse() })
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(false)
    expect(result.current.find(item => item.login === 'alpha')?.profileImageUrl).toBe(photo)
  })
  it('normalizes aliases, rejects invalid identities, and maps normalized callbacks to raw rows', () => {
    const photo = 'https://static-cdn.jtvnw.net/jtv_user_pictures/profile.png'
    const rows: ProfileRow[] = [{ login: ' @Creator ' }, { login: 'CREATOR' }, { login: 'creator' }, { login: 'x' }, { login: 'bad/name' }]
    const { result } = renderHook(() => useMomentProfiles(rows))
    const [logins, , accept] = mocks.load.mock.calls[0]
    expect(logins).toEqual(['creator'])
    act(() => accept('CREATOR', photo))
    expect(result.current.slice(0, 3).every(item => item.profileImageUrl === photo)).toBe(true)
    expect(result.current.slice(3).every(item => item.profileImageUrl === undefined)).toBe(true)
  })
  it('preserves the first-20 membership budget and cancels when capped membership changes', () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ login: `creator${index}` }))
    const { rerender } = renderHook(({ items }) => useMomentProfiles(items), { initialProps: { items: rows } })
    const [firstLogins, firstSignal] = mocks.load.mock.calls[0]
    expect(firstLogins).toHaveLength(20)
    expect(firstLogins).not.toContain('creator20')

    rerender({ items: [rows[20], ...rows.slice(0, 20)] })
    expect(firstSignal.aborted).toBe(true)
    expect(mocks.load).toHaveBeenCalledTimes(2)
    const nextLogins = mocks.load.mock.calls[1][0]
    expect(nextLogins).toHaveLength(20)
    expect(nextLogins).toContain('creator20')
    expect(nextLogins).not.toContain('creator19')
  })
})
