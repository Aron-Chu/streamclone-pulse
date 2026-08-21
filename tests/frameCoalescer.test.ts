import { describe, expect, it, vi } from 'vitest'
import { createFrameCoalescer } from '../src/ui/frameCoalescer.ts'

describe('createFrameCoalescer', () => {
  it('delivers only the newest rapid preview in one animation frame', () => {
    const frames: FrameRequestCallback[] = []
    const deliver = vi.fn()
    const coalescer = createFrameCoalescer(
      deliver,
      callback => {
        frames.push(callback)
        return frames.length
      },
      vi.fn(),
    )

    coalescer.enqueue(60)
    coalescer.enqueue(120)
    coalescer.enqueue(180)

    expect(frames).toHaveLength(1)
    expect(deliver).not.toHaveBeenCalled()
    frames.shift()?.(0)
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver).toHaveBeenCalledWith(180)
  })

  it('cancels pending work before a pin or clear action', () => {
    const frames: FrameRequestCallback[] = []
    const cancelFrame = vi.fn()
    const deliver = vi.fn()
    const coalescer = createFrameCoalescer(
      deliver,
      callback => {
        frames.push(callback)
        return 7
      },
      cancelFrame,
    )

    coalescer.enqueue(60)
    coalescer.cancel()
    frames.shift()?.(0)

    expect(cancelFrame).toHaveBeenCalledWith(7)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('rate-limits heavier consumers while retaining the newest trailing value', () => {
    const frames: FrameRequestCallback[] = []
    const deliver = vi.fn()
    const coalescer = createFrameCoalescer(
      deliver,
      callback => {
        frames.push(callback)
        return frames.length
      },
      vi.fn(),
      { minimumIntervalMs: 48 },
    )

    coalescer.enqueue(1)
    frames.shift()?.(0)
    expect(deliver).toHaveBeenLastCalledWith(1)

    coalescer.enqueue(2)
    frames.shift()?.(16)
    coalescer.enqueue(3)
    frames.shift()?.(32)
    expect(deliver).toHaveBeenCalledTimes(1)
    frames.shift()?.(48)
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(deliver).toHaveBeenLastCalledWith(3)
  })
})
