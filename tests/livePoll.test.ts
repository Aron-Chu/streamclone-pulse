import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UNCHARTED_RECHECK_MS,
  computeLivePollDelayMs,
  createLivePollController,
  shouldRunLivePoll,
} from '../src/content/livePoll.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

vi.mock('../src/content/twitch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/content/twitch.ts')>()
  return { ...actual, detectTwitchChannelLive: vi.fn(() => true) }
})

vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn() }))

const liveChannel: TwitchPageContext = { kind: 'channel', login: 'xqc', vodId: null }

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

describe('shouldRunLivePoll', () => {
  it('runs for an enabled hosted live channel', () => {
    expect(shouldRunLivePoll({ activeLogin: 'xqc', context: liveChannel, autoUpdate: true, hosted: true })).toBe(true)
  })

  it('requires local collection but not hosted collection', () => {
    expect(shouldRunLivePoll({ activeLogin: 'xqc', context: liveChannel, autoUpdate: true, tracking: false, hosted: false })).toBe(false)
    expect(shouldRunLivePoll({ activeLogin: 'xqc', context: liveChannel, autoUpdate: true, tracking: false, hosted: true })).toBe(true)
  })

  it('rejects disabled, non-channel, and mismatched contexts', () => {
    expect(shouldRunLivePoll({ activeLogin: 'xqc', context: liveChannel, autoUpdate: false })).toBe(false)
    expect(shouldRunLivePoll({ activeLogin: 'xqc', context: { kind: 'non-channel', login: null, vodId: null }, autoUpdate: true })).toBe(false)
    expect(shouldRunLivePoll({ activeLogin: 'xqc', context: { ...liveChannel, login: 'shroud' }, autoUpdate: true })).toBe(false)
  })
})

describe('computeLivePollDelayMs', () => {
  it('uses the base cadence while healthy and capped backoff after failures', () => {
    expect(computeLivePollDelayMs(30_000, 0, () => 0.5)).toBe(30_000)
    expect(computeLivePollDelayMs(30_000, 1, () => 0.5)).toBe(30_000)
    expect(computeLivePollDelayMs(30_000, 2, () => 0.5)).toBe(60_000)
    expect(computeLivePollDelayMs(30_000, 3, () => 0.5)).toBe(120_000)
  })
})

describe('createLivePollController', () => {
  let controller: ReturnType<typeof createLivePollController> | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    controller?.stop()
    controller = undefined
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** A page whose tab can be hidden and shown again; set up before the controller. */
  function tabPage() {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    vi.stubGlobal('document', page)
    return {
      set(state: DocumentVisibilityState) {
        page.visibilityState = state
        page.dispatchEvent(new Event('visibilitychange'))
      },
    }
  }

  async function successfulBridge() {
    const { sendBackgroundMessage } = await import('../src/content/bridge.ts')
    vi.mocked(sendBackgroundMessage).mockResolvedValue({ type: 'PULSE_UPDATE', login: 'xqc', payload: null })
    return vi.mocked(sendBackgroundMessage)
  }

  it('hydrates and syncs without an immediate request, then performs one scheduled recent poll', async () => {
    const send = await successfulBridge()
    controller = createLivePollController(() => liveChannel)
    controller.configure({ enabled: true, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, true, true)
    await flush()
    expect(send).not.toHaveBeenCalled()
    expect(controller.getSnapshot().phase).toBe('scheduled')

    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'GET_PULSE', login: 'xqc', watch: false, window: 'recent' })
  })

  it('adds exactly one immediate request per eligible false-to-true transition', async () => {
    const send = await successfulBridge()
    controller = createLivePollController(() => liveChannel)
    controller.configure({ enabled: false, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, true, true)

    controller.setEnabled(true)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)

    controller.setEnabled(true)
    controller.sync('xqc', liveChannel, true, true)
    controller.sync('xqc', liveChannel, true, true)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)

    controller.setEnabled(false)
    controller.setEnabled(true)
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('latches one follow-up when re-enabled during an in-flight request', async () => {
    const { sendBackgroundMessage } = await import('../src/content/bridge.ts')
    const resolvers: Array<(value: { type: 'PULSE_UPDATE'; login: string; payload: null }) => void> = []
    vi.mocked(sendBackgroundMessage).mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
    controller = createLivePollController(() => liveChannel)
    controller.configure({ enabled: false, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, true, true)
    controller.setEnabled(true)
    await flush()
    expect(sendBackgroundMessage).toHaveBeenCalledTimes(1)

    controller.setEnabled(false)
    controller.setEnabled(true)
    controller.setEnabled(true)
    expect(sendBackgroundMessage).toHaveBeenCalledTimes(1)

    resolvers.shift()?.({ type: 'PULSE_UPDATE', login: 'xqc', payload: null })
    await flush()
    expect(sendBackgroundMessage).toHaveBeenCalledTimes(2)

    resolvers.shift()?.({ type: 'PULSE_UPDATE', login: 'xqc', payload: null })
    await flush()
    expect(sendBackgroundMessage).toHaveBeenCalledTimes(2)
  })

  it('publishes success, application failure, retry, and bounded error state', async () => {
    const { sendBackgroundMessage } = await import('../src/content/bridge.ts')
    vi.mocked(sendBackgroundMessage)
      .mockResolvedValueOnce({ type: 'PULSE_UPDATE', login: 'xqc', payload: null, error: 'upstream_down' })
      .mockResolvedValueOnce({ type: 'PULSE_UPDATE', login: 'xqc', payload: null })
    controller = createLivePollController(() => liveChannel)
    const phases: string[] = []
    const unsubscribe = controller.subscribe(() => phases.push(controller!.getSnapshot().phase))
    controller.configure({ enabled: false, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, true, true)
    controller.setEnabled(true)
    await flush()

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'retrying',
      consecutiveFailures: 1,
      lastError: 'upstream_down',
      lastSuccessfulCheckAt: null,
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(controller.getSnapshot().consecutiveFailures).toBe(0)
    expect(controller.getSnapshot().lastSuccessfulCheckAt).not.toBeNull()
    expect(phases).toContain('refreshing')
    expect(phases).toContain('retrying')

    const count = phases.length
    unsubscribe()
    controller.setEnabled(false)
    expect(phases).toHaveLength(count)
  })

  it('clears session state on stop and ignores a stale in-flight result', async () => {
    const { sendBackgroundMessage } = await import('../src/content/bridge.ts')
    const resolvers: Array<(value: { type: 'PULSE_UPDATE'; login: string; payload: null }) => void> = []
    vi.mocked(sendBackgroundMessage).mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
    controller = createLivePollController(() => liveChannel)
    controller.configure({ enabled: false, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, true, true)
    controller.setEnabled(true)
    await flush()
    expect(controller.getSnapshot().phase).toBe('refreshing')

    controller.stop()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'idle',
      lastAttemptAt: null,
      lastSuccessfulCheckAt: null,
      consecutiveFailures: 0,
      lastError: null,
    })

    resolvers.shift()?.({ type: 'PULSE_UPDATE', login: 'xqc', payload: null })
    await flush()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'idle',
      lastSuccessfulCheckAt: null,
      consecutiveFailures: 0,
      lastError: null,
    })
  })

  it('polls nothing while the tab is hidden, then once right away when it shows again', async () => {
    const tab = tabPage()
    const send = await successfulBridge()
    controller = createLivePollController(() => liveChannel)
    controller.configure({ enabled: true, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, true, true)
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)

    tab.set('hidden')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', nextScheduledAt: null })
    // A broadcast while hidden doesn't restart the poll either.
    controller.sync('xqc', liveChannel, true, true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)

    tab.set('visible')
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    tab.set('visible')
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().phase).toBe('scheduled')

    // Back on the chart cadence.
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('adds no poll for a quick hide that skipped none', async () => {
    const tab = tabPage()
    const send = await successfulBridge()
    controller = createLivePollController(() => liveChannel)
    controller.configure({ enabled: true, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, true, true)

    await vi.advanceTimersByTimeAsync(10_000)
    tab.set('hidden')
    await vi.advanceTimersByTimeAsync(5_000)
    tab.set('visible')
    await flush()
    expect(send).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(15_000)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('rechecks a channel off the list every 10 minutes, not on the chart cadence', async () => {
    const send = await successfulBridge()
    controller = createLivePollController(() => liveChannel)
    controller.configure({ enabled: true, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, false, true, true)
    expect(controller.getSnapshot().nextScheduledAt).toBe(Date.now() + UNCHARTED_RECHECK_MS)
    expect(UNCHARTED_RECHECK_MS).toBe(10 * 60_000)

    await vi.advanceTimersByTimeAsync(UNCHARTED_RECHECK_MS - 1)
    await flush()
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith({ type: 'GET_PULSE', login: 'xqc', watch: false, window: 'recent' })

    // Syncs from broadcasts keep the 10-minute timer.
    await vi.advanceTimersByTimeAsync(60_000)
    controller.sync('xqc', liveChannel, false, true, true)
    expect(controller.getSnapshot().nextScheduledAt).toBe(Date.now() + UNCHARTED_RECHECK_MS - 60_000)

    // The recheck found it charted: back on the chart cadence.
    controller.sync('xqc', liveChannel, true, true, false)
    expect(controller.getSnapshot().nextScheduledAt).toBe(Date.now() + 30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(send).toHaveBeenCalledTimes(2)

    // And off the list again: the 30 s timer gives way to the recheck.
    controller.sync('xqc', liveChannel, false, true, true)
    expect(controller.getSnapshot().nextScheduledAt).toBe(Date.now() + UNCHARTED_RECHECK_MS)
  })

  it('keeps recurring polls recent after setPollWindow(full)', async () => {
    const send = await successfulBridge()
    controller = createLivePollController(() => liveChannel)
    controller.configure({ enabled: false, intervalMs: 30_000 })
    controller.sync('xqc', liveChannel, true, true)
    controller.setPollWindow('full')
    controller.setEnabled(true)
    await flush()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ window: 'recent' }))
  })
})
