import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { LiveActivityEvent } from '../src/lib/liveActivity'
import { CoverageDiagnostic, LiveActivityPanel } from '../src/ui/components/analytics/LiveActivityPanel'

function event(overrides: Partial<LiveActivityEvent> = {}): LiveActivityEvent {
  return {
    id: 'evt-live',
    kind: 'went_live',
    channel: {
      id: 'chan-1',
      login: 'xqc',
      displayName: 'xQc',
      avatarUrl: undefined,
    },
    streamId: 'stream-a',
    occurredAt: '2026-07-23T11:53:12.000Z',
    detectedAt: '2026-07-23T11:54:01.000Z',
    lastSeenLiveAt: null,
    timestampPrecision: 'twitch_started_at',
    title: 'Ranked grind',
    category: 'Just Chatting',
    source: 'metadata_poll',
    ...overrides,
  }
}

function renderPanel(
  props: Partial<ComponentProps<typeof LiveActivityPanel>> & {
    events?: LiveActivityEvent[]
  } = {},
) {
  const onKindFilterChange = vi.fn()
  return {
    onKindFilterChange,
    ...render(
      <MemoryRouter>
        <LiveActivityPanel
          events={props.events ?? [event()]}
          status={props.status ?? 'ready'}
          metadata={props.metadata ?? { state: 'current' }}
          asOf={props.asOf ?? '2026-07-23T12:00:00.000Z'}
          window={props.window ?? '6h'}
          kindFilter={props.kindFilter ?? 'all'}
          onKindFilterChange={props.onKindFilterChange ?? onKindFilterChange}
          newIds={props.newIds}
          lastSuccessfulAt={props.lastSuccessfulAt ?? Date.parse('2026-07-23T12:00:00.000Z')}
          nowMs={props.nowMs ?? Date.parse('2026-07-23T12:00:00.000Z')}
          loading={props.loading}
        />
      </MemoryRouter>,
    ),
  }
}

describe('LiveActivityPanel', () => {
  it('renders filters and confirmed start row linking to channel analytics', () => {
    const { onKindFilterChange } = renderPanel()
    expect(screen.getByTestId('live-activity')).toBeTruthy()
    expect(screen.getByText('Live Activity')).toBeTruthy()
    expect(screen.getByText('Recent streamer status changes')).toBeTruthy()
    expect(screen.getByTestId('live-activity-filter-all')).toBeTruthy()
    expect(screen.getByTestId('live-activity-filter-went-live')).toBeTruthy()
    expect(screen.getByTestId('live-activity-filter-went-offline')).toBeTruthy()
    fireEvent.click(screen.getByTestId('live-activity-filter-went-offline'))
    expect(onKindFilterChange).toHaveBeenCalledWith('went_offline')

    const row = screen.getByTestId('live-activity-row')
    expect(row.getAttribute('href')).toBe('/analytics/xqc')
    expect(screen.getByText('Confirmed start')).toBeTruthy()
    expect(row.querySelector('.hub-live-activity__action')?.textContent).toBe('Went live')
    expect(screen.queryByText(/POOL\s+Stable/i)).toBeNull()
  })

  it('shows observed offline + last seen for went_offline rows', () => {
    renderPanel({
      events: [
        event({
          id: 'off-1',
          kind: 'went_offline',
          timestampPrecision: 'observed_after_confirmation',
          lastSeenLiveAt: '2026-07-23T11:50:00.000Z',
          title: undefined,
          category: undefined,
        }),
      ],
    })
    expect(screen.getByText('Observed offline')).toBeTruthy()
    expect(screen.getByText(/Last seen live/i)).toBeTruthy()
    expect(screen.queryByText('Confirmed start')).toBeNull()
  })

  it('renders empty state without POOL Stable', () => {
    renderPanel({ events: [], status: 'empty' })
    expect(screen.getByTestId('live-activity-empty').textContent).toMatch(
      /No confirmed stream changes in the last 6 hours/i,
    )
    expect(screen.queryByText(/POOL\s+Stable/i)).toBeNull()
  })

  it('renders unavailable with last successful update', () => {
    renderPanel({
      events: [],
      status: 'unavailable',
      lastSuccessfulAt: Date.parse('2026-07-23T11:55:00.000Z'),
    })
    expect(screen.getByTestId('live-activity-unavailable').textContent).toMatch(
      /Live activity unavailable/i,
    )
    expect(screen.getByTestId('live-activity-unavailable').textContent).toMatch(
      /Last successful update/i,
    )
    expect(screen.queryByText(/POOL\s+Stable/i)).toBeNull()
  })

  it('CoverageDiagnostic shows unavailable when request status is unavailable', () => {
    render(
      <CoverageDiagnostic
        trackedCount={286}
        metadataState="current"
        requestStatus="unavailable"
      />,
    )
    expect(screen.getByTestId('coverage-diagnostic').textContent).toBe(
      '286 tracked channels · metadata unavailable',
    )
    expect(screen.getByTestId('coverage-diagnostic').textContent).not.toMatch(/metadata current/)
  })

  it('marks New only when id is in newIds', () => {
    renderPanel({
      events: [event({ id: 'fresh' })],
      newIds: new Set(['fresh']),
    })
    expect(screen.getByLabelText('New')).toBeTruthy()
  })
})
