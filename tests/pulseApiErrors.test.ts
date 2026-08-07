import { describe, expect, it } from 'vitest'
import { formatPulseApiError } from '../src/ui/pulseApiErrors.ts'

describe('formatPulseApiError', () => {
  it('maps backfill capacity codes to readable copy', () => {
    expect(formatPulseApiError('backfill_at_capacity')).toMatch(/at capacity/i)
    expect(formatPulseApiError('pulse_backfill_at_capacity')).toMatch(/at capacity/i)
  })

  it('maps archive discovery failures without implying that live tracking is broken', () => {
    expect(formatPulseApiError('archive_candidate_unavailable')).toMatch(/archive discovery is temporarily unavailable/i)
    expect(formatPulseApiError('archive_candidate_auth_required')).toMatch(/authenticated extension session/i)
    expect(formatPulseApiError('pulse_archive_identity_mismatch')).toMatch(/did not match this exact broadcast/i)
  })

  it('passes through unknown errors', () => {
    expect(formatPulseApiError('custom_failure')).toBe('custom_failure')
  })

  it('returns null for empty input', () => {
    expect(formatPulseApiError(null)).toBeNull()
    expect(formatPulseApiError('   ')).toBeNull()
  })
})
