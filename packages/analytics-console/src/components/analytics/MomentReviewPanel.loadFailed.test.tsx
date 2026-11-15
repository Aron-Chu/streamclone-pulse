import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MomentReviewPanel } from './MomentReviewPanel.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

afterEach(cleanup)

const props = { rollups: [], selectedRollup: null, onSelectRollup: vi.fn(), embedded: true }

// OP3-DES-011: a failed session read is not a stream with no moments yet.
it('says the moments could not load when the session read failed', () => {
  render(<MomentReviewPanel {...props} loadFailed />)
  expect(screen.getByText("Moments couldn't load. Refresh to try again.")).toBeTruthy()
  expect(screen.queryByText(/live minute buckets/)).toBeNull()
})

it('keeps the waiting text when nothing failed', () => {
  render(<MomentReviewPanel {...props} />)
  expect(screen.getByText('Ranked moments appear once live minute buckets land.')).toBeTruthy()
})
