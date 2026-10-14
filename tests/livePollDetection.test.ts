import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import type { LivePollController } from '../src/content/livePoll.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn() }))

const channel: TwitchPageContext = { kind: 'channel', login: 'fixturechan', vodId: null }
const firefoxLiveDuration = 9223372036854.775

describe('live polling with Twitch player detection', () => {
  let dom: JSDOM | undefined
  let controller: LivePollController | undefined

  beforeEach(() => {
    // The detector holds a recent live reading in module state. Each test must
    // start without that reading, while exercising the real detector.
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    controller?.stop()
    controller = undefined
    dom?.window.close()
    dom = undefined
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function playerPage(duration: number): Document {
    // Include a finite preview before the primary player, and no LIVE badge,
    // so polling depends on the actual player's duration signal.
    dom = new JSDOM(`
      <div class="preview"><video data-test="preview"></video></div>
      <div data-a-target="video-player"><video aria-label="Twitch video player" data-test="main"></video></div>`)
    const doc = dom.window.document
    const preview = doc.querySelector('[data-test="preview"]') as HTMLVideoElement
    const main = doc.querySelector('[data-test="main"]') as HTMLVideoElement
    Object.defineProperty(preview, 'duration', { configurable: true, value: 30 })
    Object.defineProperty(main, 'duration', { configurable: true, value: duration })
    vi.stubGlobal('document', doc)
    return doc
  }

  async function startPolling(context = channel) {
    const { sendBackgroundMessage } = await import('../src/content/bridge.ts')
    const send = vi.mocked(sendBackgroundMessage)
    send.mockResolvedValue({ type: 'PULSE_UPDATE', login: 'fixturechan', payload: null })
    const { createLivePollController } = await import('../src/content/livePoll.ts')
    controller = createLivePollController(() => context)
    controller.configure({ enabled: true, intervalMs: 30_000 })
    controller.sync('fixturechan', context, false, true)
    return send
  }

  it('polls Firefox live media every 30 seconds and stops at an offline marker', async () => {
    const doc = playerPage(firefoxLiveDuration)
    const send = await startPolling()

    expect(send).not.toHaveBeenCalled()
    expect(controller!.getSnapshot()).toMatchObject({
      phase: 'scheduled',
      nextScheduledAt: Date.now() + 30_000,
    })

    await vi.advanceTimersByTimeAsync(29_999)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith({
      type: 'GET_PULSE', login: 'fixturechan', watch: false, window: 'recent',
    })
    expect(controller!.getSnapshot()).toMatchObject({
      phase: 'scheduled',
      lastSuccessfulCheckAt: Date.now(),
      nextScheduledAt: Date.now() + 30_000,
    })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(send).toHaveBeenCalledTimes(2)

    const offline = doc.createElement('div')
    offline.setAttribute('data-a-target', 'channel-offline-header')
    doc.body.append(offline)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(send).toHaveBeenCalledTimes(2)
    expect(controller!.getSnapshot()).toMatchObject({ phase: 'idle', nextScheduledAt: null })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not poll an ordinary finite channel player or preview', async () => {
    playerPage(7_200)
    const send = await startPolling()

    expect(controller!.getSnapshot()).toMatchObject({ phase: 'idle', nextScheduledAt: null })
    await vi.advanceTimersByTimeAsync(90_000)
    expect(send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not poll a VOD page even if its player has the Firefox live duration', async () => {
    playerPage(firefoxLiveDuration)
    const send = await startPolling({ kind: 'vod', login: 'fixturechan', vodId: '1234567890' })

    expect(controller!.getSnapshot()).toMatchObject({ phase: 'idle', nextScheduledAt: null })
    await vi.advanceTimersByTimeAsync(90_000)
    expect(send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
