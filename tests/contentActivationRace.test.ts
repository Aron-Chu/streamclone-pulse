import { describe, expect, it, vi } from 'vitest'
import {
  createActivationGate,
  isSameChannelActivationCurrent,
  isVodActivationCurrent,
} from '../src/content/activationGate.ts'

describe('production activation gate (B3)', () => {
  it('delayed A does not win after fast B', async () => {
    const gate = createActivationGate()
    const mounts: string[] = []

    async function activate(login: string, delayMs: number) {
      const generation = gate.begin()
      await new Promise(resolve => setTimeout(resolve, delayMs))
      if (!gate.isCurrent(generation)) return
      mounts.push(login)
    }

    await Promise.all([activate('channel-a', 40), activate('channel-b', 5)])
    expect(mounts).toEqual(['channel-b'])
  })

  it('cancel on deactivate prevents late mount', async () => {
    const gate = createActivationGate()
    let mounted = false
    const generation = gate.begin()
    gate.cancel()
    await new Promise(resolve => setTimeout(resolve, 5))
    if (gate.isCurrent(generation)) mounted = true
    expect(mounted).toBe(false)
  })

  it('same-channel await getBackendUrl re-check via isSameChannelActivationCurrent', async () => {
    const gate = createActivationGate()
    const generation = gate.begin()
    const intendedLogin = 'xqc'

    const backendUrl = await Promise.resolve('http://localhost:8081')
    const activeSession = { kind: 'channel', login: 'xqc' }

    const shouldApply = isSameChannelActivationCurrent({
      generation,
      gateCurrent: gate.current(),
      activeSession,
      intendedLogin,
    })

    expect(backendUrl).toBe('http://localhost:8081')
    expect(shouldApply).toBe(true)

    gate.cancel()
    expect(
      isSameChannelActivationCurrent({
        generation,
        gateCurrent: gate.current(),
        activeSession,
        intendedLogin,
      }),
    ).toBe(false)
  })

  it('VOD apply only after isVodActivationCurrent', async () => {
    const gate = createActivationGate()
    const generation = gate.begin()
    const intendedVodId = '12345'
    const activeSession = { kind: 'vod', vodId: '12345' }

    const vodPayload = await Promise.resolve({ vodId: intendedVodId })
    expect(
      isVodActivationCurrent({
        generation,
        gateCurrent: gate.current(),
        activeSession,
        intendedVodId,
      }),
    ).toBe(true)

    gate.begin()
    expect(
      isVodActivationCurrent({
        generation,
        gateCurrent: gate.current(),
        activeSession,
        intendedVodId,
      }),
    ).toBe(false)

    expect(vodPayload.vodId).toBe(intendedVodId)
  })

  it('getBackendUrl().then callback guard pattern with generation snapshot', async () => {
    vi.useFakeTimers()
    const gate = createActivationGate()
    const applied: string[] = []

    async function activateChannel(login: string, backendDelayMs: number) {
      const generation = gate.begin()
      const backendUrl = await new Promise<string>(resolve => {
        setTimeout(() => resolve(`http://backend/${login}`), backendDelayMs)
      })
      if (!gate.isCurrent(generation)) return
      if (
        !isSameChannelActivationCurrent({
          generation,
          gateCurrent: gate.current(),
          activeSession: { kind: 'channel', login },
          intendedLogin: login,
        })
      ) {
        return
      }
      applied.push(`${login}:${backendUrl}`)
    }

    const slowA = activateChannel('channel-a', 50)
    const fastB = activateChannel('channel-b', 5)
    await vi.advanceTimersByTimeAsync(60)
    await Promise.all([slowA, fastB])

    expect(applied).toEqual(['channel-b:http://backend/channel-b'])
    vi.useRealTimers()
  })
})
