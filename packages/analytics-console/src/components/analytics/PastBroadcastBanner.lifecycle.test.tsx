import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SessionLifecycleMeta } from './PastBroadcastBanner'

afterEach(cleanup)

const base = { isActiveLiveCollector: false, hasChartData: true, channelLogin: 'example', buildSessionPath: () => '/session' }

it('unknown lifecycle cannot display a late stored end or claim the streamer is offline', () => {
  const { container } = render(<SessionLifecycleMeta {...base} isLiveRoute
    stream={{ streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z', endedAt: '2026-09-01T10:00:00Z', lifecycleState: 'unknown' }} />)
  expect(container.textContent).toMatch(/Session lifecycle unknown/)
  expect(container.textContent).not.toMatch(/Streamer offline|Ended /)
})

it('legacy end and confirmed-offline detection never imply an exact duration', () => {
  const stream = { streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z', endedAt: '2026-09-01T10:00:00Z' }
  const { container, rerender } = render(<SessionLifecycleMeta {...base} isLiveRoute={false} stream={stream} />)
  expect(container.textContent).toMatch(/Session lifecycle unknown/)
  expect(container.textContent).not.toMatch(/Ended |744h|Past broadcast/)
  rerender(<SessionLifecycleMeta {...base} isLiveRoute={false} stream={{ ...stream, lifecycleState: 'confirmed_ended', lifecycleDetectedAt: '2026-08-02T12:00:00Z', measuredSpanSeconds: 3600 }} />)
  expect(container.textContent).toMatch(/Past broadcast/)
  expect(container.textContent).toMatch(/exact end time unknown/)
  expect(container.textContent).toMatch(/Measured span 1h 0m/)
  expect(container.textContent).not.toMatch(/Ended |744h/)
})

it('shows "Started …" as the visible item, with the date and the lifecycle sentence in its title (d3-v2 meta line)', () => {
  const stream = { streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z', lifecycleState: 'confirmed_ended' as const, lifecycleDetectedAt: '2026-08-02T12:00:00Z' }
  const { container } = render(<SessionLifecycleMeta {...base} isLiveRoute={false} stream={stream} />)
  const item = container.querySelector<HTMLElement>('.mi[data-session-lifecycle-row]')!
  expect(item).not.toBeNull()
  expect(item.textContent).toMatch(/^Started \S/)
  expect(item.title).toMatch(/Past broadcast · Offline confirmed/)
  // The lifecycle words stay for screen readers, visually hidden.
  const status = screen.getByRole('status')
  expect(status.className).toContain('sr-only')
  expect(status.textContent).toMatch(/Past broadcast/)
})

it('marks the lifecycle item, and says when the meta line holds its link', () => {
  const stream = { streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z', lifecycleState: 'confirmed_ended' as const, lifecycleDetectedAt: '2026-08-02T12:00:00Z' }
  const props = { ...base, stream }
  const { container, rerender } = render(<SessionLifecycleMeta {...props} isLiveRoute={false} />)
  let row = container.querySelector('[data-session-lifecycle-row]')
  expect(row).not.toBeNull()
  expect(row?.hasAttribute('data-has-action')).toBe(false)

  rerender(<SessionLifecycleMeta {...props} isLiveRoute={false} hasVodLink />)
  row = container.querySelector('[data-session-lifecycle-row]')
  expect(row?.hasAttribute('data-has-action')).toBe(true)

  rerender(<SessionLifecycleMeta {...props} isLiveRoute />)
  row = container.querySelector('[data-session-lifecycle-row]')
  expect(row?.hasAttribute('data-has-action')).toBe(false)

  rerender(<SessionLifecycleMeta {...props} isLiveRoute sessionStreamId="123" />)
  row = container.querySelector('[data-session-lifecycle-row]')
  expect(row?.hasAttribute('data-has-action')).toBe(true)
  expect(screen.getByRole('link', { name: 'Open session page' }).getAttribute('href')).toBe('/session')
})

it('keeps "Started" but drops the lifecycle facts during live collection', () => {
  const { container } = render(<SessionLifecycleMeta {...base} isLiveRoute={false} isActiveLiveCollector
    stream={{ streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z', lifecycleState: 'confirmed_ended' }} />)
  expect(container.textContent).toMatch(/^Started /)
  expect(container.querySelector('[data-session-lifecycle-row]')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
})
