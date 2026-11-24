import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MomentFeedback } from '../src/lib/momentFeedback'
import { MomentComments } from '../src/ui/components/moments/watch/MomentComments'

// The thread's focus moves (into a Delete or Report panel, back to its opener) on a busy machine, where
// React's scheduler yields between tasks and a press can come before the last render's effects have run.
// Kept as this file's only test: run after another test's render in the same file, the press no longer
// lands in that gap, and the test would pass without the fix.

const STREAM = '9000001'
const FEEDBACK = {
  schemaVersion: 1, streamId: STREAM, momentAt: '2026-11-14T10:40:00Z',
  stream: { login: 'fakechan01', displayName: 'fakechan01', profileImageUrl: '', category: 'fake-pog', startedAt: '2026-11-14T09:59:30Z', endedAt: '2026-11-14T12:00:00Z' },
  window: { from: '2026-11-14T10:35:00Z', to: '2026-11-14T10:45:00Z' },
  clips: [], ratings: { yes: 0, total: null, share: null },
  you: { signedIn: true, canWrite: true, verdict: null }, comments: { total: 1 }, hidden: false,
} as unknown as MomentFeedback

const comment = (mine: boolean) => ({
  id: '00000000-0000-4000-8000-000000000001', at: '2026-11-14T10:40:01Z', body: 'fake comment 1', createdAt: '2026-11-14T10:41:00Z',
  author: { login: 'fakeviewer1', displayName: 'FakeViewer1', profileImageUrl: '' }, mine, reportedByYou: false,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderThread(mine: boolean) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ schemaVersion: 1, items: [comment(mine)], total: 1 })))
  render(
    <MemoryRouter>
      <MomentComments streamId={STREAM} window={FEEDBACK.window} at={Date.parse('2026-11-14T10:40:00Z')} clampAt={ms => ms}
        onAt={() => undefined} feedback={FEEDBACK} returnTo="/analytics/moments" label={() => '0:40:30'}
        onPins={() => undefined} onTotal={() => undefined} onNeedSignIn={() => undefined} onStatus={() => undefined} />
    </MemoryRouter>,
  )
}

describe('Moment comments focus on a busy machine', () => {
  it('moves into the Delete panel when the list’s render still has its effects to run at the press, and back on Cancel', async () => {
    // React's scheduler yields after every task, so the list's render leaves its effects for a later task; the
    // press comes as soon as the list is on the page, before those effects run.
    let clock = performance.now()
    const busy = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 50))
    try {
      renderThread(true)
      await waitFor(() => fireEvent.click(screen.getByRole('button', { name: 'Delete' })))
    } finally { busy.mockRestore() }
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Delete your comment?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }))
  })
})
