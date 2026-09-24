import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SyncStatusPanel } from './SyncStatusPanel.tsx'

afterEach(cleanup)

describe('SyncStatusPanel coverage labels', () => {
  it.each([
    [239 / 240 * 100, '99.5%'],
    [0, '0%'],
    [100, '100%'],
    [Number.NaN, 'Unknown'],
  ])('renders %s without claiming false completeness', (coveragePct, expected) => {
    render(<SyncStatusPanel detail={{
      state: 'historical',
      stream: { streamId: 'sync-coverage', login: 'xqc' },
      rollups: [],
      topEmotes: [],
      chatCoveragePct: coveragePct,
    }} />)
    expect(screen.getByText(`${expected} of stream minutes`)).not.toBeNull()
  })
})
