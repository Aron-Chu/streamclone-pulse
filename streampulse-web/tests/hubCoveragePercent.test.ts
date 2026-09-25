import { describe, expect, it } from 'vitest'
import { formatIncompleteCoveragePercent } from '../src/ui/components/hub/HubActivityChart'
import { formatCoveragePercent } from '../src/ui/components/hub/HubDataHealthBanner'

describe('IncompleteCoverageNeverFormatsAs100', () => {
  it('floors incomplete coverage to one decimal place', () => {
    expect(formatIncompleteCoveragePercent(239, 240)).toBe('99.5%')
    expect(formatIncompleteCoveragePercent(240, 240)).toBe('100%')
    expect(formatCoveragePercent(239, 240)).toBe('99.5%')
    expect(formatCoveragePercent(240, 240)).toBe('100%')
    expect(formatCoveragePercent(0, 0)).toBe('0%')
  })
})
