import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Button,
  EmptyState,
  ProgressBar,
  Segmented,
  Sparkline,
} from '../src/ui/primitives'

afterEach(() => cleanup())

describe('Button', () => {
  it('defaults to type=button and applies the variant class', () => {
    render(<Button variant="secondary">Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.className).toContain('sc-btn--secondary')
  })

  it('fires onClick', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Segmented', () => {
  const options = [
    { value: 'a', label: 'Full' },
    { value: 'b', label: 'Compact' },
    { value: 'c', label: 'Pill' },
  ] as const

  it('exposes a radiogroup with the selected radio checked', () => {
    render(
      <Segmented aria-label="Density" value="a" options={[...options]} onValueChange={() => {}} />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Density' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Full' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Compact' }).getAttribute('aria-checked')).toBe('false')
  })

  it('selects on click and moves with ArrowRight (roving focus)', () => {
    const onValueChange = vi.fn()
    render(
      <Segmented aria-label="Density" value="a" options={[...options]} onValueChange={onValueChange} />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Compact' }))
    expect(onValueChange).toHaveBeenLastCalledWith('b')

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Full' }), { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith('b')
  })
})

describe('ProgressBar', () => {
  it('renders a progressbar with rounded aria-valuenow', () => {
    render(<ProgressBar value={42.4} max={100} aria-label="Cache usage" />)
    const bar = screen.getByRole('progressbar', { name: 'Cache usage' })
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
  })

  it('omits value bounds when indeterminate', () => {
    render(<ProgressBar indeterminate aria-label="Loading" />)
    const bar = screen.getByRole('progressbar', { name: 'Loading' })
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
  })
})

describe('Sparkline', () => {
  it('is an img with a label when described, otherwise decorative', () => {
    const { rerender } = render(<Sparkline data={[1, 4, 2, 8]} aria-label="trend up" />)
    expect(screen.getByRole('img', { name: 'trend up' })).toBeTruthy()

    rerender(<Sparkline data={[1, 4, 2, 8]} />)
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('EmptyState', () => {
  it('uses role=status for neutral and role=alert for errors', () => {
    const { rerender } = render(<EmptyState title="Nothing yet" />)
    expect(screen.getByRole('status').textContent).toContain('Nothing yet')

    rerender(<EmptyState tone="error" title="Failed to load" />)
    expect(screen.getByRole('alert').textContent).toContain('Failed to load')
  })
})
