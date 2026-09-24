import { sendBackgroundMessage } from './bridge.ts'
import type { PulseCacheWindow } from '../shared/storage.ts'
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
const DEFAULT_INTERVAL_MS = 30_000
const MIN_INTERVAL_MS = 15_000
const MAX_ERROR_LENGTH = 120

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

export type LivePollPhase = 'paused' | 'idle' | 'scheduled' | 'refreshing' | 'retrying'

export interface LivePollSnapshot {
  phase: LivePollPhase
  enabled: boolean
  lastAttemptAt: number | null
  lastSuccessfulCheckAt: number | null
  nextScheduledAt: number | null
  consecutiveFailures: number
  lastError: string | null
}

export type LivePollController = {
  /** Hydrate preferences without treating them as a user enable transition. */
  configure: (settings: { enabled: boolean; intervalMs: number }) => void
  sync: (
    activeLogin: string | null,
    context: TwitchPageContext,
    tracking?: boolean,
    hosted?: boolean,
  ) => void
  /** The only operation allowed to give false -> true immediate-fetch semantics. */
  setEnabled: (enabled: boolean) => void
  getSnapshot: () => LivePollSnapshot
  subscribe: (listener: () => void) => () => void
  /** Kept for overlay wiring; recurring polls always use `recent`. */
  setPollWindow: (window: PulseCacheWindow) => void
  stop: () => void
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'pulse_check_failed')
  return message.trim().slice(0, MAX_ERROR_LENGTH) || 'pulse_check_failed'
}

function normalizedIntervalMs(value: number): number {
  return Number.isFinite(value) && value >= MIN_INTERVAL_MS
    ? Math.floor(value)
    : DEFAULT_INTERVAL_MS
}

/**
 * Keeps pulse payload fresh while a live channel tab is open.
 * Hosted backends use read-only GET_PULSE (no extension-initiated IRC watch).
 */
export function createLivePollController(
  readContext: () => TwitchPageContext,
  options: { now?: () => number } = {},
): LivePollController {
  const now = options.now ?? Date.now
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let tickInFlight = false
  let immediateFollowUp = false
  let lifecycleGeneration = 0
  let intervalMs = DEFAULT_INTERVAL_MS
  // Start disabled until entry.ts hydrates the stored preference. This prevents
  // module startup or sync() from inventing an enable transition.
  let autoUpdate = false
  let activeLogin: string | null = null
  let collecting = false
  let hostedBackend = true
  let snapshot: LivePollSnapshot = {
    phase: 'paused',
    enabled: false,
    lastAttemptAt: null,
    lastSuccessfulCheckAt: null,
    nextScheduledAt: null,
    consecutiveFailures: 0,
    lastError: null,
  }
  // Recurring live poll is always recent. Explicit full-window chart loads are
  // one-shot GET_PULSE calls from the overlay, not a persistent poll mode.
  const pollWindow: PulseCacheWindow = 'recent'

  function publish(patch: Partial<LivePollSnapshot>): void {
    const next = { ...snapshot, ...patch }
    if (
      next.phase === snapshot.phase
      && next.enabled === snapshot.enabled
      && next.lastAttemptAt === snapshot.lastAttemptAt
      && next.lastSuccessfulCheckAt === snapshot.lastSuccessfulCheckAt
      && next.nextScheduledAt === snapshot.nextScheduledAt
      && next.consecutiveFailures === snapshot.consecutiveFailures
      && next.lastError === snapshot.lastError
    ) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  function canRun(): boolean {
    return shouldRunLivePoll({
      activeLogin,
      context: readContext(),
      autoUpdate,
      tracking: collecting,
      hosted: hostedBackend,
    })
  }

  function stopTimer(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function publishInactive(): void {
    publish({
      phase: autoUpdate ? 'idle' : 'paused',
      enabled: autoUpdate,
      nextScheduledAt: null,
    })
  }

  function scheduleNext(): void {
    stopTimer()
    if (!canRun()) {
      publishInactive()
      return
    }
    const delayMs = computeLivePollDelayMs(intervalMs, snapshot.consecutiveFailures)
    const nextScheduledAt = now() + delayMs
    publish({
      phase: snapshot.consecutiveFailures > 0 ? 'retrying' : 'scheduled',
      enabled: autoUpdate,
      nextScheduledAt,
    })
    timer = setTimeout(() => {
      timer = null
      void tick()
    }, delayMs)
  }

  async function tick(): Promise<void> {
    if (!activeLogin || tickInFlight || !canRun()) {
      if (!tickInFlight) publishInactive()
      return
    }
    tickInFlight = true
    const login = activeLogin
    const requestGeneration = lifecycleGeneration
    publish({
      phase: 'refreshing',
      enabled: autoUpdate,
      lastAttemptAt: now(),
      nextScheduledAt: null,
    })
    try {
      const response = await sendBackgroundMessage({
        type: 'GET_PULSE',
        login,
        watch: false,
        window: pollWindow,
      })
      if (!('type' in response) || response.type !== 'PULSE_UPDATE') {
        throw new Error('unexpected_pulse_response')
      }
      if (response.error) throw new Error(response.error)
      if (requestGeneration === lifecycleGeneration) {
        publish({
          consecutiveFailures: 0,
          lastError: null,
          lastSuccessfulCheckAt: now(),
        })
      }
    } catch (error) {
      if (requestGeneration === lifecycleGeneration) {
        publish({
          consecutiveFailures: snapshot.consecutiveFailures + 1,
          lastError: boundedError(error),
        })
      }
    } finally {
      tickInFlight = false
      if (requestGeneration !== lifecycleGeneration) {
        if (immediateFollowUp && canRun()) {
          immediateFollowUp = false
          queueMicrotask(() => void tick())
        } else if (canRun() && !timer) {
          scheduleNext()
        } else if (!canRun()) {
          publishInactive()
        }
        return
      }
      if (immediateFollowUp && canRun()) {
        immediateFollowUp = false
        queueMicrotask(() => void tick())
      } else {
        immediateFollowUp = false
        scheduleNext()
      }
    }
  }

  return {
    configure(settings) {
      autoUpdate = settings.enabled
      intervalMs = normalizedIntervalMs(settings.intervalMs)
      // Configuration hydration may schedule the next cadence, but must never
      // perform the immediate request reserved for a user false -> true toggle.
      if (!autoUpdate) {
        immediateFollowUp = false
        stopTimer()
        publishInactive()
      } else if (!tickInFlight) {
        scheduleNext()
      } else {
        publish({ enabled: true })
      }
    },
    sync(login: string | null, _context: TwitchPageContext, tracking = false, hosted = true) {
      const loginChanged = activeLogin !== login
      if (loginChanged) {
        lifecycleGeneration += 1
        stopTimer()
        if (activeLogin !== null && login !== activeLogin) {
          publish({
            lastAttemptAt: null,
            lastSuccessfulCheckAt: null,
            consecutiveFailures: 0,
            lastError: null,
          })
        }
      }
      activeLogin = login
      collecting = tracking
      hostedBackend = hosted
      if (!canRun()) {
        stopTimer()
        publishInactive()
        return
      }
      // PULSE_UPDATE handlers and SPA route churn call sync frequently. It may
      // maintain one future timer, but it never performs an immediate request.
      if (!tickInFlight && !timer) scheduleNext()
    },
    setEnabled(enabled: boolean) {
      const wasEnabled = autoUpdate
      autoUpdate = enabled
      if (!enabled) {
        lifecycleGeneration += 1
        immediateFollowUp = false
        stopTimer()
        publishInactive()
        return
      }
      publish({ enabled: true })
      if (wasEnabled) {
        if (!tickInFlight && !timer) scheduleNext()
        return
      }
      if (!canRun()) {
        publishInactive()
        return
      }
      stopTimer()
      if (tickInFlight) {
        immediateFollowUp = true
        return
      }
      void tick()
    },
    getSnapshot() {
      return snapshot
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setPollWindow(_window: PulseCacheWindow) {
      // no-op: recurring polls never leave recent
    },
    stop() {
      lifecycleGeneration += 1
      activeLogin = null
      collecting = false
      immediateFollowUp = false
      stopTimer()
      publish({
        lastAttemptAt: null,
        lastSuccessfulCheckAt: null,
        consecutiveFailures: 0,
        lastError: null,
      })
      publishInactive()
    },
  }
}
