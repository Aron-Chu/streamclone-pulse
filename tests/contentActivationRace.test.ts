import { describe, expect, it } from 'vitest'

/**
 * Activation generation race helpers — mirror entry.ts contract without mounting DOM.
 */
function createActivationGate() {
  let generation = 0
  return {
    begin() {
      generation += 1
      return generation
    },
    isCurrent(g: number) {
      return g === generation
    },
    cancel() {
      generation += 1
    },
  }
}

describe('channel activation generation', () => {
  it('delayed A does not win after fast B', async () => {
    const gate = createActivationGate()
    const mounts: string[] = []

    async function activate(login: string, delayMs: number) {
      const g = gate.begin()
      await new Promise(r => setTimeout(r, delayMs))
      if (!gate.isCurrent(g)) return
      mounts.push(login)
    }

    const a = activate('channel-a', 40)
    const b = activate('channel-b', 5)
    await Promise.all([a, b])
    expect(mounts).toEqual(['channel-b'])
  })

  it('cancel on deactivate prevents late mount', async () => {
    const gate = createActivationGate()
    let mounted = false
    const g = gate.begin()
    gate.cancel()
    await new Promise(r => setTimeout(r, 5))
    if (gate.isCurrent(g)) mounted = true
    expect(mounted).toBe(false)
  })
})
