import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FigmaEmoteSignalBlock } from '../src/ui/components/analytics/FigmaEmoteSignalBlock'
import { KpiCard } from '../src/ui/components/analytics/primitives/KpiCard'
import type { HubEmoteIntel } from '../src/lib/publicHub'

const intel: HubEmoteIntel = {
  emotesPerMin: 12,
  topEmoteSharePct: 20,
  uniqueEmotes: 40,
  biggestPeakPerMin: 80,
  seventvSharePct: 60,
  providerShares: [],
}

describe('analytics KPI loading honesty', () => {
  it('uses Skeleton in KpiCard instead of an ellipsis glyph', () => {
    const { container } = render(<KpiCard label="Viewers" value="1.2K" loading />)
    expect(container.querySelector('.sc-skeleton')).toBeTruthy()
    expect(container.textContent).not.toContain('…')
    expect(screen.queryByText('1.2K')).toBeNull()
  })

  it('uses Skeleton for Emote Market KPI values while loading', () => {
    const { container } = render(<FigmaEmoteSignalBlock loading intel={intel} />)
    expect(container.querySelectorAll('.figma-kpi .sc-skeleton').length).toBeGreaterThanOrEqual(5)
    expect(screen.queryByText('12')).toBeNull()
    for (const node of container.querySelectorAll('.figma-kpi__val')) {
      expect(node.textContent?.trim()).not.toBe('...')
    }
  })
})
