import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SessionSignal } from '../../signals/signalTypes.ts'
import { SessionSignalTape } from './SessionSignalTape.tsx'

const minuteTs = '2026-07-12T10:00:00Z'

function delta(id: string, current = 20): SessionSignal {
  return {
    id,
    kind: 'delta',
    metric: 'chat',
    minuteTs,
    current: { metric: 'chat', value: current, state: 'measured', observedAt: minuteTs },
    previous: { metric: 'chat', value: 10, state: 'measured', observedAt: '2026-07-12T09:59:00Z' },
    label: 'Chat activity',
    seekable: true,
  }
}

const peak: SessionSignal = {
  id: 'peak:heatmap',
  kind: 'peak',
  metric: 'peaks',
  minuteTs,
  current: { metric: 'peaks', value: 99, state: 'measured', observedAt: minuteTs },
  label: 'Confirmed peak',
  seekable: true,
}

const coverage: SessionSignal = {
  id: 'coverage:chat',
  kind: 'coverage',
  state: 'partial',
  observedThrough: minuteTs,
  label: 'Chat coverage',
  seekable: false,
}

describe('SessionSignalTape', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
  })
  afterEach(cleanup)

  it('returns null for empty signals', () => {
    const { container } = render(<SessionSignalTape signals={[]} onSelectMinute={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('pins coverage and selects peak before deltas at the same minute', () => {
    const onSelectMinute = vi.fn()
    render(
      <SessionSignalTape
        signals={[delta('delta:z'), coverage, delta('delta:a'), peak]}
        selectedMinuteTs={minuteTs}
        onSelectMinute={onSelectMinute}
      />,
    )

    const tape = screen.getByLabelText('Session signals')
    expect(tape.firstElementChild?.textContent).toContain('Chat coverage')
    expect(screen.getByRole('button', { name: /confirmed peak/i }).getAttribute('data-selected')).toBe('true')

    fireEvent.click(screen.getAllByRole('button', { name: /chat activity/i })[0])
    expect(onSelectMinute).toHaveBeenCalledWith(minuteTs)
  })

  it('keeps first paint static and uses render history for subsequent tween baselines', () => {
    const { rerender } = render(
      <SessionSignalTape signals={[delta('delta:chat', 20)]} onSelectMinute={vi.fn()} />,
    )
    expect(screen.getByTestId('flash-stat').getAttribute('data-tweening')).toBe('false')

    rerender(<SessionSignalTape signals={[delta('delta:chat', 30)]} onSelectMinute={vi.fn()} />)
    expect(screen.getByTestId('flash-stat').getAttribute('data-from-value')).toBe('20')
    expect(screen.getByTestId('flash-stat').getAttribute('data-tweening')).toBe('true')
  })
})
