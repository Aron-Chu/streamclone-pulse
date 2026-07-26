import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MomentumBadge } from '../src/ui/components/analytics/MomentumBadge'
import { MOMENTUM_NO_SIGNAL_TITLE, MOMENTUM_TITLE } from '../src/ui/components/analytics/hubFormat'

describe('MomentumBadge', () => {
  it('renders single-line momentum delta with tooltip title', () => {
    render(<MomentumBadge pct={21} classPrefix="figma-trend" />)
    expect(screen.getByText('▲ 21%')).toBeTruthy()
    expect(screen.getByTitle(MOMENTUM_TITLE)).toBeTruthy()
    expect(screen.queryByText('vs prior window')).toBeNull()
  })

  it('renders neutral dash when momentum signal is suppressed', () => {
    render(<MomentumBadge pct={-32} hasSignal={false} classPrefix="figma-trend" />)
    expect(screen.getByText('–')).toBeTruthy()
    expect(screen.getByTitle(MOMENTUM_NO_SIGNAL_TITLE)).toBeTruthy()
    expect(screen.queryByText('▼ 32%')).toBeNull()
  })
})
