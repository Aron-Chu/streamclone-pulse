import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureAccountDeviceCode, clearAccountDeviceCode, getAccountDeviceCode } from '../src/lib/accountDeviceCode'

afterEach(() => {
  clearAccountDeviceCode()
  window.history.replaceState(null, '', '/')
  vi.useRealTimers()
})

describe('human device code handoff', () => {
  it('captures only the human code in memory and immediately removes the fragment and query', () => {
    window.history.replaceState(null, '', '/account/link-device?unused=1#code=ABCDE12345')
    captureAccountDeviceCode()
    expect(window.location.pathname).toBe('/account/link-device')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
    expect(getAccountDeviceCode()).toBe('ABCDE12345')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('ABCDE12345')
    clearAccountDeviceCode()
    expect(getAccountDeviceCode()).toBe('')
  })

  it.each([
    '#code=abcde12345',
    '#code=ABCDE-12345',
    '#code=ABCDE1234',
    '#code=ABCDE123456',
    '#code=GGGGG12345',
    '#code=ABCDE12345&approve=true',
    '#code=ABCDE12345&pollingSecret=' + 'a'.repeat(64),
    '#code=' + 'a'.repeat(64),
    '#pollingSecret=' + 'a'.repeat(64),
    '#code=%41BCDE12345',
    '#ABCDE12345',
    '',
  ])('discards and strips malformed or extra fields in %s', hash => {
    window.history.replaceState(null, '', '/account/link-device' + hash)
    captureAccountDeviceCode()
    expect(getAccountDeviceCode()).toBe('')
    expect(window.location.hash).toBe('')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('a'.repeat(64))
  })

  it('normalizes the supported trailing-slash account route', () => {
    window.history.replaceState(null, '', '/account/link-device/#code=ABCDE12345')
    captureAccountDeviceCode()
    expect(window.location.pathname).toBe('/account/link-device')
    expect(window.location.hash).toBe('')
    expect(getAccountDeviceCode()).toBe('ABCDE12345')
  })

  it('does not capture or strip fragments on other account routes', () => {
    window.history.replaceState(null, '', '/account/confirm#' + 'a'.repeat(64))
    captureAccountDeviceCode()
    expect(getAccountDeviceCode()).toBe('')
    expect(window.location.hash).toBe('#' + 'a'.repeat(64))
  })

  it('expires the prepared code after ten minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345')
    captureAccountDeviceCode()
    vi.advanceTimersByTime(10 * 60_000 - 1)
    expect(getAccountDeviceCode()).toBe('ABCDE12345')
    vi.advanceTimersByTime(1)
    expect(getAccountDeviceCode()).toBe('')
  })
})
