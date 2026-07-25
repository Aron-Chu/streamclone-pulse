import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBackfillOperationController,
  delay,
  isAbortError,
  type BackfillOperationToken,
} from '../src/ui/backfillOperation.ts'
import { makeFullHistoryActivation } from '../src/shared/fullHistoryAuth.ts'

describe('createBackfillOperationController (B2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('invalidate on begin of new op aborts previous', () => {
    const controller = createBackfillOperationController()
    const activationA = makeFullHistoryActivation({ login: 'a', streamId: 's1' })
    const activationB = makeFullHistoryActivation({ login: 'b', streamId: 's2' })

    const first = controller.begin(activationA)
    const second = controller.begin(activationB)

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    expect(controller.current()).toBe(second)
  })

  it('delay rejects AbortError when aborted during wait', async () => {
    const controller = createBackfillOperationController()
    const token = controller.begin(makeFullHistoryActivation({ login: 'a', streamId: 's1' }))

    const pending = delay(500, token.signal)
    controller.invalidate()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(isAbortError(await pending.catch(err => err))).toBe(true)
  })

  it('unmount/nav simulation: invalidate → isCurrent false → no apply', async () => {
    const controller = createBackfillOperationController()
    const mutations: string[] = []
    const token = controller.begin(makeFullHistoryActivation({ login: 'a', streamId: 's1' }))

    async function runOp(op: BackfillOperationToken): Promise<void> {
      try {
        await delay(100, op.signal)
        if (op.isCurrent()) {
          mutations.push('applied')
        }
      } catch (err) {
        if (!isAbortError(err)) throw err
      }
    }

    const pending = runOp(token)
    controller.invalidate()
    await vi.advanceTimersByTimeAsync(150)
    await pending

    expect(mutations).toEqual([])
    expect(token.isCurrent()).toBe(false)
  })

  it('ABA: A begin, B begin, A late must not be current', async () => {
    const controller = createBackfillOperationController()
    const activationA = makeFullHistoryActivation({ login: 'a', streamId: 's1' })
    const activationB = makeFullHistoryActivation({ login: 'b', streamId: 's2' })

    const tokenA = controller.begin(activationA)
    controller.begin(activationB)

    await vi.advanceTimersByTimeAsync(50)
    expect(tokenA.isCurrent()).toBe(false)
    expect(tokenA.signal.aborted).toBe(true)
  })

  it('status-poll loop skips apply when isCurrent becomes false mid-loop', async () => {
    const controller = createBackfillOperationController()
    const mutations: string[] = []
    const token = controller.begin(makeFullHistoryActivation({ login: 'a', streamId: 's1' }))

    async function pollUntilDone(op: BackfillOperationToken): Promise<void> {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (!op.isCurrent()) return
        try {
          await delay(200, op.signal)
        } catch (err) {
          if (isAbortError(err)) return
          throw err
        }
        if (!op.isCurrent()) return
        mutations.push(`tick-${attempt}`)
      }
    }

    const pending = pollUntilDone(token)
    await vi.advanceTimersByTimeAsync(200)
    controller.invalidate()
    await vi.advanceTimersByTimeAsync(800)
    await pending

    expect(mutations).toEqual(['tick-0'])
  })

  it('obsolete ops do not mutate shared mutations array when isCurrent is false', async () => {
    const controller = createBackfillOperationController()
    const sharedMutations: string[] = []

    function applyIfCurrent(op: BackfillOperationToken, value: string): void {
      if (op.isCurrent()) {
        sharedMutations.push(value)
      }
    }

    const tokenA = controller.begin(makeFullHistoryActivation({ login: 'a', streamId: 's1' }))
    const tokenB = controller.begin(makeFullHistoryActivation({ login: 'b', streamId: 's2' }))

    applyIfCurrent(tokenA, 'stale')
    applyIfCurrent(tokenB, 'current')

    expect(sharedMutations).toEqual(['current'])

    const lateApply = (async () => {
      try {
        await delay(300, tokenA.signal)
        applyIfCurrent(tokenA, 'late')
      } catch (err) {
        if (!isAbortError(err)) throw err
      }
    })()

    await vi.advanceTimersByTimeAsync(300)
    await lateApply

    expect(sharedMutations).toEqual(['current'])
  })
})
