import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  computeLivePollDelayMs,
  createLivePollController,
  shouldRunLivePoll,
} from '../src/content/livePoll.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

vi.mock('../src/content/twitch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/content/twitch.ts')>()
  return {
    ...actual,
    detectTwitchChannelLive: vi.fn(() => true),
  }
})

describe('shouldRunLivePoll', () => {
  const liveChannel: TwitchPageContext = { kind: 'channel', login: 'xqc', vodId: null }

  it('runs on a live watch tab when auto-update is enabled', () => {
    expect(
      shouldRunLivePoll({
        activeLogin: 'xqc',
        context: liveChannel,
        autoUpdate: true,
        tracking: true,
      }),
    ).toBe(true)
  })

  it('does not run when the channel is not collecting', () => {
    expect(
      shouldRunLivePoll({
        activeLogin: 'xqc',
        context: liveChannel,
        autoUpdate: true,
        tracking: false,
      }),
    ).toBe(false)
  })

  it('does not run when auto-update is disabled', () => {
    expect(
      shouldRunLivePoll({
        activeLogin: 'xqc',
        context: liveChannel,
        autoUpdate: false,
      }),
    ).toBe(false)
  })

  it('does not run on browse-only channel tabs', () => {
    expect(
      shouldRunLivePoll({
        activeLogin: 'xqc',
        context: { kind: 'non-channel', login: null, vodId: null },
        autoUpdate: true,
      }),
    ).toBe(false)
  })

  it('does not run when the active login differs from the page login', () => {
    expect(
      shouldRunLivePoll({
        activeLogin: 'xqc',
        context: { kind: 'channel', login: 'shroud', vodId: null },
        autoUpdate: true,
      }),
    ).toBe(false)
  })
})

describe('computeLivePollDelayMs', () => {
  it('applies jitter around the base interval when healthy', () => {
    const delay = computeLivePollDelayMs(30_000, 0, () => 0.5)
    expect(delay).toBeGreaterThanOrEqual(27_000)
    expect(delay).toBeLessThanOrEqual(33_000)
  })

  it('backs off after consecutive failures', () => {
    const firstFailure = computeLivePollDelayMs(30_000, 1, () => 0.5)
    const secondFailure = computeLivePollDelayMs(30_000, 2, () => 0.5)
    const thirdFailure = computeLivePollDelayMs(30_000, 3, () => 0.5)
    expect(firstFailure).toBeGreaterThanOrEqual(27_000)
    expect(secondFailure).toBeGreaterThan(firstFailure)
    expect(thirdFailure).toBeGreaterThanOrEqual(57_000)
    expect(thirdFailure).toBeLessThanOrEqual(123_000)
  })
})

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(),
}))

vi.mock('../src/shared/storage.ts', () => ({
  getAutoUpdateEnabled: vi.fn(async () => true),
  getPollIntervalMs: vi.fn(async () => 30_000),
}))

describe('createLivePollController backoff', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('schedules a longer delay after GET_PULSE failures', async () => {
    vi.useFakeTimers()
    const { sendBackgroundMessage } = await import('../src/content/bridge.ts')
    vi.mocked(sendBackgroundMessage).mockRejectedValue(new Error('network'))

    const controller = createLivePollController(() => ({
      kind: 'channel',
      login: 'xqc',
      vodId: null,
    }))
    controller.sync('xqc', { kind: 'channel', login: 'xqc', vodId: null }, true, true)

    await vi.waitFor(() => {
      expect(sendBackgroundMessage).toHaveBeenCalledTimes(1)
    })

    await vi.advanceTimersByTimeAsync(29_000)
    expect(sendBackgroundMessage).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.waitFor(() => {
      expect(sendBackgroundMessage).toHaveBeenCalledTimes(2)
    })
  })
})
