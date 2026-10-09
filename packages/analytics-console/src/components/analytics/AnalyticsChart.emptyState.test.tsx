import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

afterEach(() => cleanup())

function renderEmpty(sources: Array<{ source: string }>, canSync = false) {
  const detail = {
    state: 'historical',
    stream: { streamId: 'empty-stream', startedAt: '2026-10-07T00:00:00.000Z' },
    rollups: [],
    topEmotes: [],
    sources,
  } as unknown as AnalyticsStreamDetail
  return render(
    <AnalyticsChart
      detail={detail}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
      canSync={canSync}
    />,
  )
}

describe('AnalyticsChart empty state copy', () => {
  it('tells a public visitor the stream has no minute data, without internal names', () => {
    const { container } = renderEmpty([])
    const text = container.textContent ?? ''
    expect(text).toContain('No minute data')
    expect(text).toContain('No minute data was recorded for this stream.')
    expect(text).not.toContain('No recent data')
    expect(text).not.toContain('Streamclone')
  })

  it('keeps the sync copy where a sync is possible', () => {
    const { container } = renderEmpty([{ source: 'twitchtracker' }])
    expect(container.textContent).toContain('Chat & Emotes Offline')
    expect(container.textContent).not.toContain('No minute data')
  })
})
