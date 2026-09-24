import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlashStat } from './FlashStat.tsx'

describe('FlashStat', () => {
  afterEach(cleanup)

  it('tweens only a verified changed finite transition with motion enabled', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    const { rerender } = render(
      <FlashStat label="Chat" value={10} fromValue={10} changed={false} motionEnabled />,
    )

    expect(screen.getByTestId('flash-stat').getAttribute('data-tweening')).toBe('false')
    expect(screen.getByText('10')).toBeTruthy()

    rerender(<FlashStat label="Chat" value={16} fromValue={10} changed motionEnabled />)

    expect(screen.getByTestId('flash-stat').getAttribute('data-tweening')).toBe('true')
    expect(raf).toHaveBeenCalled()
    raf.mockRestore()
  })

  it('snaps without a finite verified baseline or motion', () => {
    const { rerender } = render(
      <FlashStat label="Peak" value={48} fromValue={undefined} changed motionEnabled />,
    )

    expect(screen.getByTestId('flash-stat').getAttribute('data-tweening')).toBe('false')
    expect(screen.getByText('48')).toBeTruthy()

    rerender(<FlashStat label="Peak" value={52} fromValue={48} changed motionEnabled={false} />)
    expect(screen.getByTestId('flash-stat').getAttribute('data-tweening')).toBe('false')
    expect(screen.getByText('52')).toBeTruthy()
  })
})
