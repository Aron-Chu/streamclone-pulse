import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimestampToolFeedback } from '../src/ui/components/TimestampToolFeedback'
import type { TimestampFeedbackSession } from '../src/lib/timestampFeedback'

const analytics = vi.hoisted(() => ({ available: false, open: vi.fn(), subscribers: new Set<() => void>() }))
vi.mock('../src/lib/productAnalytics', () => ({
  openTimestampFeedback: (signal: AbortSignal) => analytics.open(signal),
  timestampFeedbackAvailable: () => analytics.available,
  subscribeAnalyticsPreference: (fn: () => void) => { analytics.subscribers.add(fn); return () => { analytics.subscribers.delete(fn) } },
}))
function session(): TimestampFeedbackSession {
  return { question: 'Did this tool help you create the Twitch timestamp link you needed?', choices: ['Yes', 'Not yet'],
    shown: vi.fn(() => true), submit: vi.fn(() => true), dismiss: vi.fn() }
}
function eligibility(value: boolean) { act(() => { analytics.available = value; analytics.subscribers.forEach(fn => fn()) }) }
const returnFocus = vi.fn()
beforeEach(() => { analytics.available = true; analytics.open.mockReset(); analytics.subscribers.clear(); returnFocus.mockClear() })
afterEach(cleanup)

describe('voluntary tool feedback UI', () => {
  it('stays hidden without consent and never fetches until explicitly requested', async () => {
    analytics.available = false
    render(<TimestampToolFeedback returnFocus={returnFocus} />)
    expect(screen.queryByRole('button')).toBeNull()
    eligibility(true)
    expect(screen.getByRole('button', { name: 'Give anonymous feedback' })).toBeTruthy()
    expect(analytics.open).not.toHaveBeenCalled()
    const s = session(); analytics.open.mockResolvedValue(s)
    fireEvent.click(screen.getByRole('button', { name: 'Give anonymous feedback' }))
    expect(await screen.findByText(s.question)).toBeTruthy()
    expect(s.shown).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(screen.getByText('One optional question'))
    expect(screen.getByRole('button', { name: 'Send feedback' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByLabelText('Yes'))
    expect(s.submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(s.submit).toHaveBeenCalledExactlyOnceWith('Yes')
    expect(s.dismiss).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('Thanks for the feedback.')
    expect(returnFocus).toHaveBeenCalledOnce()
  })

  it('cancels on withdrawal, ignores late results and permits a fresh explicit attempt', async () => {
    let finish!: (s: TimestampFeedbackSession) => void
    analytics.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<TimestampToolFeedback returnFocus={returnFocus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Give anonymous feedback' }))
    const signal = analytics.open.mock.calls[0]![0] as AbortSignal
    const stale = session()
    eligibility(false)
    expect(signal.aborted).toBe(true)
    await act(async () => finish(stale))
    expect(stale.shown).not.toHaveBeenCalled()
    const next = session(); analytics.open.mockResolvedValue(next)
    eligibility(true)
    fireEvent.click(screen.getByRole('button', { name: 'Give anonymous feedback' }))
    expect(await screen.findByText(next.question)).toBeTruthy()
    expect(next.shown).toHaveBeenCalledOnce()
  })

  it('makes failed delivery an explicit retry of the same selected answer', async () => {
    const s = session(); vi.mocked(s.submit).mockReturnValueOnce(false).mockReturnValue(true)
    analytics.open.mockResolvedValue(s)
    render(<TimestampToolFeedback returnFocus={returnFocus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Give anonymous feedback' }))
    await screen.findByText(s.question)
    fireEvent.click(screen.getByLabelText('Not yet'))
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(screen.getByRole('group').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry feedback' }))
    expect(vi.mocked(s.submit).mock.calls).toEqual([['Not yet'], ['Not yet']])
    expect(screen.getByText('Thanks for the feedback.')).toBeTruthy()
  })

  it('dismisses without sending an answer and never offers again during the visit', async () => {
    const s = session(); analytics.open.mockResolvedValue(s)
    render(<TimestampToolFeedback returnFocus={returnFocus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Give anonymous feedback' }))
    await screen.findByText(s.question)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    eligibility(false); eligibility(true)
    expect(screen.queryByRole('button')).toBeNull()
    expect(s.dismiss).toHaveBeenCalledOnce(); expect(s.submit).not.toHaveBeenCalled()
  })

  it('does not expose provider errors or send a dismissal on unmount', async () => {
    analytics.open.mockRejectedValueOnce(new Error('provider secret')).mockResolvedValue(session())
    const { unmount } = render(<TimestampToolFeedback returnFocus={returnFocus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Give anonymous feedback' }))
    await screen.findByText('Feedback is unavailable right now. You can keep using the tool.')
    expect(screen.queryByText(/provider secret/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Give anonymous feedback' }))
    await screen.findByText('One optional question')
    const signal = analytics.open.mock.calls[1]![0] as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
    await waitFor(() => expect(analytics.subscribers.size).toBe(0))
  })
})
