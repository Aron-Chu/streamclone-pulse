import { sendBackgroundMessage } from './bridge.ts'
import { getAutoUpdateEnabled, getPollIntervalMs, type PulseCacheWindow } from '../shared/storage.ts'
import { detectTwitchChannelLive, type TwitchPageContext } from './twitch.ts'

/** True when the open Twitch watch tab should drive live pulse refresh. */
export function shouldRunLivePoll(args: {
  activeLogin: string | null
  context: TwitchPageContext
  autoUpdate: boolean
  tracking?: boolean
  hosted?: boolean
}): boolean {
  if (!args.autoUpdate) return false
  if (!args.activeLogin) return false
  const pageLogin = args.context.login?.trim().toLowerCase()
  if (!pageLogin || pageLogin !== args.activeLogin.trim().toLowerCase()) return false
  if (args.context.kind !== 'channel') return false
  if (!detectTwitchChannelLive(args.context)) return false
  if (args.hosted) return true
  return args.tracking !== false
}

const JITTER_RATIO = 0.15
const BACKOFF_BASE_MS = 30_000
const BACKOFF_MAX_MS = 120_000

/** Compute next poll delay with jitter and capped exponential backoff after failures. */
export function computeLivePollDelayMs(
  baseIntervalMs: number,
  consecutiveFailures: number,
  random = Math.random,
): number {
  const safeBase = Math.max(5_000, baseIntervalMs)
  const jitterSpan = safeBase * JITTER_RATIO
  const jitter = (random() * 2 - 1) * jitterSpan
  if (consecutiveFailures <= 0) {
    return Math.max(1_000, Math.round(safeBase + jitter))
  }
  const exponent = Math.min(consecutiveFailures - 1, 2)
  const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent)
  return Math.max(1_000, Math.round(backoff + jitter))
}

export type LivePollController = {
  sync: (
    activeLogin: string | null,
    context: TwitchPageContext,
    tracking?: boolean,
    hosted?: boolean,
  ) => void
  setPollWindow: (window: PulseCacheWindow) => void
  stop: () => void
}

/**
 * Keeps pulse payload fresh while a live channel tab is open.
 * Hosted backends use read-only GET_PULSE (no extension-initiated IRC watch).
 */
export function createLivePollController(
  readContext: () => TwitchPageContext,
): LivePollController {
  let timer: ReturnType<typeof setTimeout> | null = null
  let tickInFlight = false
  let intervalMs = 30_000
  let autoUpdate = true
  let activeLogin: string | null = null
  let collecting = false
  let hostedBackend = true
  let consecutiveFailures = 0
  let pollWindow: PulseCacheWindow = 'recent'

  function stopTimer(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function scheduleNext(): void {
    stopTimer()
    const delayMs = computeLivePollDelayMs(intervalMs, consecutiveFailures)
    timer = setTimeout(() => {
      void tick()
    }, delayMs)
  }

  async function refreshSettings(): Promise<void> {
    autoUpdate = await getAutoUpdateEnabled()
    intervalMs = await getPollIntervalMs()
  }

  async function tick(): Promise<void> {
    if (!activeLogin || tickInFlight) return
    const context = readContext()
    if (!shouldRunLivePoll({
      activeLogin,
      context,
      autoUpdate,
      tracking: collecting,
      hosted: hostedBackend,
    })) {
      stopTimer()
      return
    }
    tickInFlight = true
    try {
      await sendBackgroundMessage({
        type: 'GET_PULSE',
        login: activeLogin,
        watch: false,
        window: pollWindow,
      })
      consecutiveFailures = 0
    } catch {
      consecutiveFailures += 1
    } finally {
      tickInFlight = false
      if (shouldRunLivePoll({
        activeLogin,
        context: readContext(),
        autoUpdate,
        tracking: collecting,
        hosted: hostedBackend,
      })) {
        scheduleNext()
      }
    }
  }

  return {
    sync(login: string | null, context: TwitchPageContext, tracking = false, hosted = true) {
      activeLogin = login
      collecting = tracking
      hostedBackend = hosted
      void refreshSettings().then(() => {
        if (!shouldRunLivePoll({
          activeLogin,
          context,
          autoUpdate,
          tracking: collecting,
          hosted: hostedBackend,
        })) {
          stopTimer()
          return
        }
        consecutiveFailures = 0
        void tick()
      })
    },
    setPollWindow(window: PulseCacheWindow) {
      pollWindow = window
    },
    stop() {
      activeLogin = null
      consecutiveFailures = 0
      pollWindow = 'recent'
      stopTimer()
    },
  }
}
