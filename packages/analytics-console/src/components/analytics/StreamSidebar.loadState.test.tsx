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

  it('keeps loaded rows visible when a later refresh fails', () => {
    const stream = { streamId: '101', login: 'xqc', startedAt: '2026-07-11T18:00:00.000Z', title: 'Loaded broadcast' } as AnalyticsStream
    renderSidebar({ streams: [stream], loadFailed: true, onRetry: vi.fn() })
    expect(screen.getByText('Loaded broadcast')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
