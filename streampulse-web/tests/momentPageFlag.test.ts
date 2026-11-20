import { afterEach, describe, expect, it, vi } from 'vitest'
import { handOverMoment, handedMoment, momentPageHref } from '../src/lib/momentPageFlag'
import { momentAtKey, momentMinuteAt } from '../src/lib/momentFeedback'

const AT = Date.UTC(2026, 10, 14, 10, 40, 30)
// A stream that started on a fractional second: the backend's `at` for its 12:01 minute is start + 29 s, 12:00:59.4.
const FRACTIONAL_START = Date.UTC(2026, 10, 14, 12, 0, 30, 400)
const FRACTIONAL_AT = FRACTIONAL_START + 29_000
afterEach(() => vi.unstubAllEnvs())

describe('momentPageHref', () => {
  it('is null while the page is switched off, whatever it is given', () => {
    for (const value of ['', 'off', 'true', '0']) {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', value)
      expect(momentPageHref({ streamId: '9000001', at: AT })).toBeNull()
    }
  })

  it('names the minute that holds a whole-second `at` once switched on', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    expect(momentPageHref({ streamId: '9000001', at: AT })).toBe('/analytics/moments/9000001/20261114T1040Z')
    expect(momentPageHref({ streamId: '9000001', at: Date.UTC(2026, 10, 14, 12, 0) })).toBe('/analytics/moments/9000001/20261114T1200Z')
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', '1')
    expect(momentPageHref({ streamId: '9000001', at: AT })).toBe('/analytics/moments/9000001/20261114T1040Z')
  })

  it('names the Moment’s own minute when the stream started on a fractional second, as Up next and the minute’s time do', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    const upNext = momentAtKey(momentMinuteAt(FRACTIONAL_START, 29))
    expect(upNext).toBe('20261114T1201Z')
    expect(momentPageHref({ streamId: '9000001', at: FRACTIONAL_AT })).toBe(`/analytics/moments/9000001/${upNext}`)
    expect(momentPageHref({ streamId: '9000001', at: Date.UTC(2026, 10, 14, 12, 1) })).toBe(`/analytics/moments/9000001/${upNext}`)
    // A stream's first minute (offset 0) is the minute the start sits in.
    expect(momentPageHref({ streamId: '9000001', at: FRACTIONAL_START })).toBe(`/analytics/moments/9000001/${momentAtKey(momentMinuteAt(FRACTIONAL_START, 0))}`)
  })

  it.each([
    ['no time', { streamId: '9000001', at: undefined }],
    ['a null time', { streamId: '9000001', at: null }],
    ['a time that is not one', { streamId: '9000001', at: Number.NaN }],
    ['no stream id', { streamId: '', at: AT }],
    ['a stream id that is not digits', { streamId: 's-alpha', at: AT }],
    ['a stream id over 20 digits', { streamId: '1'.repeat(21), at: AT }],
  ])('is null for %s', (_name, input) => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    expect(momentPageHref(input)).toBeNull()
  })
})

describe('handing a Moment to its page', () => {
  const moment = { streamId: '9000001', offsetSeconds: 2430, login: 'fakechan01', displayName: 'FakeChan01', category: 'fake-pog', profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/fake.png' }

  it('hands over the minute that holds `at`, and the page takes it back for that address only', () => {
    const handed = handOverMoment(moment, AT)
    expect(handed).toEqual({ ...moment, momentAt: '20261114T1040Z' })
    expect(handedMoment({ from: 'moments', moment: handed }, '9000001', '20261114T1040Z')).toEqual(handed)
    expect(handedMoment({ from: 'moments', moment: handed }, '9000001', '20261114T1041Z')).toBeNull()
    expect(handedMoment({ from: 'moments', moment: handed }, '9000002', '20261114T1040Z')).toBeNull()
  })

  it('hands over the Moment’s own minute when the stream started on a fractional second', () => {
    const handed = handOverMoment({ ...moment, offsetSeconds: 29 }, FRACTIONAL_AT)
    expect(handed?.momentAt).toBe(momentAtKey(momentMinuteAt(FRACTIONAL_START, 29)))
    expect(handed?.momentAt).toBe(momentAtKey(Date.UTC(2026, 10, 14, 12, 1)))
    expect(handedMoment({ from: 'moments', moment: handed }, '9000001', '20261114T1201Z')).toEqual(handed)
  })

  it('hands nothing over without a time', () => {
    expect(handOverMoment(moment, undefined)).toBeUndefined()
    expect(handOverMoment(moment, Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  it.each([
    ['no state', undefined],
    ['no moment', { from: 'hub' }],
    ['a login that is not one', { moment: { ...moment, momentAt: '20261114T1040Z', login: 'Fake Chan' } }],
    ['a negative offset', { moment: { ...moment, momentAt: '20261114T1040Z', offsetSeconds: -1 } }],
    ['an offset that is not a number', { moment: { ...moment, momentAt: '20261114T1040Z', offsetSeconds: '2430' } }],
  ])('takes nothing from %s', (_name, state) => {
    expect(handedMoment(state, '9000001', '20261114T1040Z')).toBeNull()
  })

  it('drops text that is blank or too long', () => {
    const handed = handedMoment({ moment: { ...moment, momentAt: '20261114T1040Z', displayName: '  ', category: 'x'.repeat(201) } }, '9000001', '20261114T1040Z')
    expect(handed).toMatchObject({ login: 'fakechan01', offsetSeconds: 2430 })
    expect(handed?.displayName).toBeUndefined()
    expect(handed?.category).toBeUndefined()
  })
})
