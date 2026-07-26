import { describe, expect, it, vi } from 'vitest'

/**
 * Mirrors LiveStatsBand's chart-window hydration guard:
 * late async default loads must not overwrite a user pick.
 */
function applyHydratedDefault(args: {
  userPicked: boolean
  hydrated: '15m' | '30m' | '60m' | '2h' | '4h' | 'full'
  current: '15m' | '30m' | '60m' | '2h' | '4h' | 'full'
}): '15m' | '30m' | '60m' | '2h' | '4h' | 'full' {
  if (args.userPicked) return args.current
  return args.hydrated
}

describe('chart window hydration race', () => {
  it('keeps the first user range when storage default arrives late', async () => {
    let chartWindow: '15m' | '30m' | '60m' | '2h' | '4h' | 'full' = '60m'
    let userPicked = false

    const hydrate = vi.fn(async () => {
      await Promise.resolve()
      chartWindow = applyHydratedDefault({
        userPicked,
        hydrated: 'full',
        current: chartWindow,
      })
    })

    const pending = hydrate()
    userPicked = true
    chartWindow = '30m'
    await pending

    expect(chartWindow).toBe('30m')
    expect(hydrate).toHaveBeenCalledOnce()
  })

  it('applies storage default when the user has not picked yet', async () => {
    let chartWindow: '15m' | '30m' | '60m' | '2h' | '4h' | 'full' = '60m'
    const userPicked = false

    await Promise.resolve()
    chartWindow = applyHydratedDefault({
      userPicked,
      hydrated: 'full',
      current: chartWindow,
    })

    expect(chartWindow).toBe('full')
  })
})
