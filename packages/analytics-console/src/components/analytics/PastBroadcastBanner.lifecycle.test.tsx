import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PastBroadcastBanner } from './PastBroadcastBanner'

afterEach(cleanup)

it('unknown lifecycle cannot display a late stored end or claim the streamer is offline', () => {
  render(<PastBroadcastBanner isLiveRoute isActiveLiveCollector={false} hasChartData channelLogin="example" buildSessionPath={() => '/session'}
    stream={{ streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z', endedAt: '2026-09-01T10:00:00Z', lifecycleState: 'unknown' }} />)
  expect(screen.getByText(/Session lifecycle unknown/)).toBeTruthy()
  expect(screen.queryByText(/Streamer offline|Ended /)).toBeNull()
})

it('legacy end and confirmed-offline detection never imply an exact duration', () => {
  const stream = { streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z', endedAt: '2026-09-01T10:00:00Z' }
  const props = { isLiveRoute: false, isActiveLiveCollector: false, hasChartData: true, channelLogin: 'example', buildSessionPath: () => '/session' }
  const { rerender } = render(<PastBroadcastBanner {...props} stream={stream} />)
  expect(screen.getByText(/Session lifecycle unknown/)).toBeTruthy()
  expect(screen.queryByText(/Ended |744h|Past broadcast/)).toBeNull()
  rerender(<PastBroadcastBanner {...props} stream={{ ...stream, lifecycleState: 'confirmed_ended', lifecycleDetectedAt: '2026-08-02T12:00:00Z', measuredSpanSeconds: 3600 }} />)
  expect(screen.getByText(/exact end time unknown/)).toBeTruthy()
  expect(screen.getByText(/Measured span 1h 0m/)).toBeTruthy()
  expect(screen.queryByText(/Ended |744h/)).toBeNull()
})

it('marks the lifecycle row, and says when it holds a link, for the wide status row', () => {
  const stream = { streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z', lifecycleState: 'confirmed_ended' as const, lifecycleDetectedAt: '2026-08-02T12:00:00Z' }
  const props = { isActiveLiveCollector: false, hasChartData: true, channelLogin: 'example', buildSessionPath: () => '/session', stream }
  const { container, rerender } = render(<PastBroadcastBanner {...props} isLiveRoute={false} />)
  let row = container.querySelector('[data-session-lifecycle-row]')
  expect(row).not.toBeNull()
  expect(row?.hasAttribute('data-has-action')).toBe(false)

  rerender(<PastBroadcastBanner {...props} isLiveRoute={false} vodLinkState={{ status: 'linked', vodId: '987654321' }} />)
  row = container.querySelector('[data-session-lifecycle-row]')
  expect(row?.hasAttribute('data-has-action')).toBe(true)
  expect(row?.querySelector('a')?.textContent).toMatch(/Watch VOD/i)

  rerender(<PastBroadcastBanner {...props} isLiveRoute />)
  row = container.querySelector('[data-session-lifecycle-row]')
  expect(row?.hasAttribute('data-has-action')).toBe(false)

  rerender(<PastBroadcastBanner {...props} isLiveRoute sessionStreamId="123" />)
  row = container.querySelector('[data-session-lifecycle-row]')
  expect(row?.hasAttribute('data-has-action')).toBe(true)
})
