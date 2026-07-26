import { describe, expect, it } from 'vitest'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from '../src/lib/normalizeTwitchLogin'

describe('normalizeTwitchLogin', () => {
  it('trims, lowercases, and strips @', () => {
    expect(normalizeTwitchLogin('  @XQC  ')).toBe('xqc')
  })

  it('validates plausible logins', () => {
    expect(isPlausibleTwitchLogin('xqc')).toBe(true)
    expect(isPlausibleTwitchLogin('a')).toBe(false)
    expect(isPlausibleTwitchLogin('bad-name')).toBe(false)
  })
})
