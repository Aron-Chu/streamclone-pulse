import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStream } from '../../apiTypes.ts'
import { StreamSidebar } from './StreamSidebar.tsx'

const EMPTY_COPY = 'No past streams indexed yet.'

function renderSidebar(props: Partial<Parameters<typeof StreamSidebar>[0]> = {}) {
  return render(
    <MemoryRouter>
      <StreamSidebar
        login="xqc"
        streams={[]}
        isLiveView
        buildSessionPath={(login, id) => `/analytics/${login}/${id}`}
        buildChannelPath={login => `/analytics/${login}`}
        {...props}
      />
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

describe('StreamSidebar list load state', () => {
  it('says the list is loading instead of calling the channel empty', () => {
    renderSidebar({ loading: true })
    expect(screen.getByRole('status').textContent).toContain('Loading streams')
    expect(screen.queryByText(EMPTY_COPY)).toBeNull()
  })

  it('reports a failed list with a retry instead of the empty-channel copy', () => {
    const onRetry = vi.fn()
    renderSidebar({ loadFailed: true, onRetry })
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load streams.")
    expect(screen.queryByText(EMPTY_COPY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps the failure and its retry in place, disabled, while the list is requested again', () => {
    renderSidebar({ loadFailed: true, retrying: true, onRetry: vi.fn() })
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load streams.")
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the empty copy for a successful empty list', () => {
    renderSidebar()
    expect(screen.getByText(EMPTY_COPY)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('hides the stream count while the first list request is in flight, keeping its place', () => {
    renderSidebar({ loading: true })
    const count = document.querySelector('[data-stream-count]')!
    expect(count.classList.contains('invisible')).toBe(true)
  })

  it('shows the count once the list settles, empty, failed or loaded', () => {
    const stream = { streamId: '101', login: 'xqc', startedAt: '2026-07-11T18:00:00.000Z', title: 'Loaded broadcast' } as AnalyticsStream
    const settled: Array<Partial<Parameters<typeof StreamSidebar>[0]>> = [{}, { loadFailed: true }, { streams: [stream], loading: true }]
    for (const props of settled) {
      const view = renderSidebar(props)
      const count = document.querySelector('[data-stream-count]')!
      expect(count.classList.contains('invisible')).toBe(false)
      expect(count.textContent).toBe(String(props.streams?.length ?? 0))
      view.unmount()
    }
  })

  // VOD-4 (fix, 10-30): the console may render the first page of the list
  // before the full list lands; that page's length is not the channel's total.
  it('never shows a partial list as the total: the known count gets a "+"', () => {
    const page = Array.from({ length: 12 }, (_, index) => ({
      streamId: String(300 + index),
      login: 'xqc',
      startedAt: new Date(Date.parse('2026-10-29T09:00:00.000Z') - index * 86_400_000).toISOString(),
      title: `Broadcast ${index + 1}`,
    })) as AnalyticsStream[]
    const view = renderSidebar({ streams: page, streamsPartial: true })
    const count = document.querySelector('[data-stream-count]')!
    expect(count.textContent).toBe('12+')
    expect(count.getAttribute('title')).toBe('At least 12 streams')
    expect(screen.queryByRole('button', { name: 'Show all 12 streams' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show all streams' })).toBeTruthy()
    view.unmount()

    renderSidebar({ streams: page })
    expect(document.querySelector('[data-stream-count]')!.textContent).toBe('12')
    expect(screen.getByRole('button', { name: 'Show all 12 streams' })).toBeTruthy()
  })

  it('keeps loaded rows visible when a later refresh fails', () => {
    const stream = { streamId: '101', login: 'xqc', startedAt: '2026-07-11T18:00:00.000Z', title: 'Loaded broadcast' } as AnalyticsStream
    renderSidebar({ streams: [stream], loadFailed: true, onRetry: vi.fn() })
    expect(screen.getByText('Loaded broadcast')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
