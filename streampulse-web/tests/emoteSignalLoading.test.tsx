import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { KpiCard } from '../src/ui/components/analytics/primitives/KpiCard'

describe('analytics KPI loading honesty', () => {
  it('uses Skeleton in KpiCard instead of an ellipsis glyph', () => {
    const { container } = render(<KpiCard label="Viewers" value="1.2K" loading />)
    expect(container.querySelector('.sc-skeleton')).toBeTruthy()
    expect(container.textContent).not.toContain('…')
    expect(screen.queryByText('1.2K')).toBeNull()
  })
})
