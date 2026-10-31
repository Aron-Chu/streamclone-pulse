import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { StreamQualityDiagnosis } from '../../utils/streamQuality.ts'
import { StreamQualityBanner } from './StreamQualityBanner.tsx'

afterEach(cleanup)

const hint: StreamQualityDiagnosis = {
  issues: ['refresh_only_hint'],
  message: 'Refresh data reloads charts from the server. Use sync actions below to pull missing minute rollups.',
  suggestedAction: 'none',
}

describe('StreamQualityBanner', () => {
  it('does not show the operator hint to visitors, who have no sync actions', () => {
    const { container } = render(<StreamQualityBanner diagnosis={hint} />)
    expect(container.firstChild).toBeNull()
    cleanup()
    const again = render(<StreamQualityBanner diagnosis={hint} canSync={false} />)
    expect(again.container.firstChild).toBeNull()
  })

  it('keeps the hint where sync actions exist (a local backend)', () => {
    render(<StreamQualityBanner diagnosis={hint} canSync />)
    expect(screen.getByRole('status').textContent).toContain('Use sync actions below')
  })

  it('still shows every other diagnosis to visitors', () => {
    render(<StreamQualityBanner diagnosis={{
      issues: ['stats_only'],
      message: 'Session metadata only (duration, averages). Minute-level viewers, chat, and emotes are not synced yet.',
      suggestedAction: 'sync_full',
      actionLabel: 'Sync chat & emotes',
    }} />)
    expect(screen.getByRole('status').textContent).toContain('Session metadata only')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
