export interface FrameCoalescer<T> {
  enqueue: (value: T) => void
  cancel: () => void
}

export interface FrameCoalescerOptions {
  /** Keep heavier consumers below the display refresh rate while retaining the newest value. */
  minimumIntervalMs?: number
}

/**
 * Deliver only the newest high-frequency preview in each animation frame.
 * Graph chrome can still paint immediately while heavier detail panels update
 * at most once per browser frame.
 */
export function createFrameCoalescer<T>(
  deliver: (value: T) => void,
  requestFrame: ((callback: FrameRequestCallback) => number) | null =
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null,
  cancelFrame: ((handle: number) => void) | null =
    typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null,
  options: FrameCoalescerOptions = {},
): FrameCoalescer<T> {
  let frameHandle: number | null = null
  let pendingValue: T
  let hasPendingValue = false
  let lastDeliveryTime: number | null = null
  const minimumIntervalMs = Math.max(0, options.minimumIntervalMs ?? 0)

  const flush = (frameTime = 0) => {
    frameHandle = null
    if (!hasPendingValue) return
    if (
      requestFrame
      && lastDeliveryTime != null
      && frameTime - lastDeliveryTime < minimumIntervalMs
    ) {
      frameHandle = requestFrame(flush)
      return
    }
    const value = pendingValue
    hasPendingValue = false
    lastDeliveryTime = frameTime
    deliver(value)
  }

  return {
    enqueue(value) {
      pendingValue = value
      hasPendingValue = true
      if (frameHandle != null) return
      if (!requestFrame) {
        flush()
        return
      }
      frameHandle = requestFrame(flush)
    },
    cancel() {
      hasPendingValue = false
      if (frameHandle != null && cancelFrame) cancelFrame(frameHandle)
      frameHandle = null
    },
  }
}
