import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DeltaSessionSignal } from '../../signals/signalTypes.ts'
import { DeltaChip } from './DeltaChip.tsx'

const signal: DeltaSessionSignal = {
  id: 'delta:chat:1',
  kind: 'delta',
  metric: 'chat',
  minuteTs: '2026-07-12T10:00:00Z',
  current: { metric: 'chat', value: 17, state: 'measured', observedAt: '2026-07-12T10:00:00Z' },
  previous: { metric: 'chat', value: 10, state: 'measured', observedAt: '2026-07-12T09:59:00Z' },
  label: 'Chat rose',
  seekable: true,
}

describe('DeltaChip', () => {
  it('uses a native button and derives a signed delta from previous', () => {
    const onSelect = vi.fn()
    render(<DeltaChip signal={signal} motionEnabled={false} onSelect={onSelect} />)

    const button = screen.getByRole('button', { name: /chat rose/i })
    expect(button.tagName).toBe('BUTTON')
    expect(button.textContent).toContain('+7')

    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.keyDown(button, { key: ' ' })
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(signal.minuteTs)
  })
})
