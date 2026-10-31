import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  readPublicHubCacheForCurrentBackend,
  schedulePublicHubCacheWrite,
} from '../lib/publicHubCache'
import {
  fetchPublicHubBase,
  fetchPublicHubStatsFallback,
  type PublicHub,
  type PublicHubActivityWindow,
  type PublicHubLoadSource,
  type PublicHubProjection,
} from '../lib/publicHub'
import { HUB_ACTIVITY_REASON_PORTAL_STAND_IN, hubActivityNeedsRecentFallback } from '../lib/hubActivityHonesty'
import { HUB_READ_HARD_CAP_MS, hubReadTimeoutMs } from '../lib/hubEarlyFetch'
import { computeJitteredDelayMs } from '../lib/pollDelay'
import { isApiError } from '../lib/apiClient'
import { hubDataAsOf, olderHubDataAsOf } from '../lib/hubDataAge'

export interface UsePublicHubOptions {
  /** Poll cadence in ms. Matches the backend cache TTL (~30s) by default. */
  pollMs?: number
  enabled?: boolean
  activityWindow?: PublicHubActivityWindow
  /** A bounded page-specific response, cached separately from full hub snapshots. */
  projection?: PublicHubProjection
  /** Injected RNG for deterministic tests. */
  random?: () => number
}

export interface PublicHubState {
  data: PublicHub | null
  loading: boolean
  refreshing: boolean
  /** True while fetching or repairing activity; verified shell data may already be visible. */
  activityRefreshing: boolean
  error: string | null
  loadSource: PublicHubLoadSource | null
  hubEndpointOk: boolean
  /** Loaded successfully but no live channels in the pool. */
  liveEmpty: boolean
  /**
   * Wall time of the last successful hub apply (network or validated cache hydrate).
   * Does not advance while the API is failing — use for trust-line "UPDATED … AGO".
   */
  lastUpdated: number | null
  /** Local apply time or saved-copy timestamp associated with the displayed data. */
  displayedSnapshotAt: number | null
  /** Browser-clock anchor for the oldest displayed data, independent of receipt. */
  dataAsOf: number | null
  /** Alias of lastUpdated — last successful poll receipt time. */
  lastSuccessfulPollAt: number | null
  /**
   * Monotonic counter incremented only when a successful hub snapshot is applied.
   * Pool Wire and other reducers must consume each sequence at most once.
   */
  pollSequence: number
  /**
   * Counts hub reads started (poll, Try again, back to the tab), answered or
   * not, so a reader that rides the hub's polls keeps going while the hub fails.
   */
  pollAttempt: number
  /** When data was read from browser cache (ms since epoch). */
  cachedAt: number | null
  /** A server Retry-After window is active; refresh() waits for it to end. */
  retryBlocked: boolean
  /**
   * The hub read for this window is still running and nothing on screen came
   * from a hub read (no data yet, totals only, or a saved copy). The read
   * outlives its deadline (up to HUB_READ_HARD_CAP_MS) and replaces what is
   * shown when it lands; false once its load has settled (answered, or failed
   * and its stand-in shown).
   */
  hubReadPending: boolean
  /** A load of this window is running, its stand-in included: Try again would only wait on it. */
  hubReadRunning: boolean
  /** The running read has missed its deadline: only then does the page call it slow. */
  hubReadLate: boolean
  /** Reads now; a read for this window still running is waited on, never started over. */
  refresh: () => void
}

const DEFAULT_POLL_MS = Number(import.meta.env.VITE_PUBLIC_HUB_POLL_MS ?? 45_000)
/** Viewer copy for a hub read that hit its client deadline (never the raw deadline message). */
export const HUB_TIMEOUT_MESSAGE = 'The hub took too long to respond.'
/**
 * How long a cold long-window read runs alone before the 30m view is read to
 * show meanwhile. A healthy API answers within it, so it costs no extra read.
 */
export const HUB_RECENT_VIEW_HEAD_START_MS = 1_000

function canRecoverHubRead(error: unknown): boolean {
  return isApiError(error) &&
    error.code !== 'invalid_json_response' &&
    error.code !== 'invalid_hub_response' &&
    ['server', 'timeout', 'unreachable'].includes(error.kind)
}

/** What a hub read that has not answered by its deadline counts as. */
const HUB_DEADLINE_MISSED = { kind: 'timeout', message: 'Request deadline exceeded', status: 0 } as const

/** True when `read` has not settled after `ms`; false once it settles or `signal` aborts. */
function missesDeadline(read: Promise<unknown>, ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (missed: boolean) => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(missed)
    }
    const onAbort = () => finish(false)
    const timer = window.setTimeout(() => finish(true), ms)
    signal.addEventListener('abort', onAbort, { once: true })
    read.then(() => finish(false), () => finish(false))
  })
}

const WINDOW_MINUTES: Partial<Record<PublicHubActivityWindow, number>> = {
  '30m': 30, 'recent': 30, '24h': 1440, '7d': 10080, '1m': 43200,
  '3m': 129600, '6m': 259200, '1y': 525600,
}

function hydrateFromCache(activityWindow: PublicHubActivityWindow, projection?: PublicHubProjection) {
  const cached = readPublicHubCacheForCurrentBackend(activityWindow, projection)
  if (!cached) {
    return {
      data: null as PublicHub | null,
      loading: true,
      loadSource: null as PublicHubLoadSource | null,
      hubEndpointOk: false,
      lastUpdated: null as number | null,
      dataAsOf: null as number | null,
      cachedAt: null as number | null,
      hasData: false,
      loadedActivityWindow: null as PublicHubActivityWindow | null,
    }
  }
  return {
    data: cached.data,
    loading: false,
    loadSource: 'cache' as PublicHubLoadSource,
    // Cache implies a prior successful hub payload — do not start as "endpoint failed".
    hubEndpointOk: true,
    lastUpdated: cached.cachedAt,
    dataAsOf: cached.dataAsOf,
    cachedAt: cached.cachedAt,
    hasData: true,
    loadedActivityWindow: activityWindow,
  }
}

function persistSuccessfulHub(activityWindow: PublicHubActivityWindow, hub: PublicHub, projection?: PublicHubProjection, dataAsOf?: number | null) {
  // Idle time, never mid-gesture; the projection is computed once per
  // snapshot (plan §2.6).
  schedulePublicHubCacheWrite(activityWindow, hub, projection, dataAsOf)
}

/** Performance mark for the first successful full-hub read of this page load (plan §4.5). */
export const HUB_DATA_MARK = 'sp:hub-data'
let hubDataMarked = false

function markHubDataOnce(): void {
  if (hubDataMarked) return
  hubDataMarked = true
  try {
    if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
    if (typeof performance.getEntriesByName === 'function' && performance.getEntriesByName(HUB_DATA_MARK, 'mark').length > 0) return
    performance.mark(HUB_DATA_MARK)
  } catch {
    // Marks are diagnostics only.
  }
}

/** Test helper: lets the next successful full-hub read mark again. */
export function resetHubDataMarkForTests(): void {
  hubDataMarked = false
}

/**
 * `reason`: the backend's own when it served the fallback; the portal's
 * stand-in reason when the portal's 30m read stands in (fix, 10-30), so the
 * page never claims a cause the backend did not send.
 */
function replaceWithCanonicalRecentActivity(requested: PublicHub, recent: PublicHub, reason = 'historical_projection_unavailable'): PublicHub {
  const requestedActivity = requested.activity
  return {
    ...requested,
    // The recent response is the authoritative generation timestamp for the
    // displayed fallback series; corpus/roster metadata remains from the
    // selected-window response.
    generatedAt: recent.generatedAt,
    activity: {
      ...recent.activity,
      windowMinutes: requestedActivity.windowMinutes,
      requestedWindowMinutes:
        requestedActivity.requestedWindowMinutes ?? requestedActivity.windowMinutes,
      servedWindowMinutes: 30,
      availableWindowMinutes: 30,
      state: 'degraded',
      source: 'live_pool_fallback',
      reason,
      bucketMinutes: recent.activity.bucketMinutes ?? 1,
    },
  }
}

/** A 30m read standing in for a longer requested window: the bounded live-pool view, tagged as the portal's stand-in (fix, 10-30). */
function recentForRequestedWindow(recent: PublicHub, minutes: number): PublicHub {
  return replaceWithCanonicalRecentActivity({
    ...recent,
    activity: { ...recent.activity, windowMinutes: minutes, requestedWindowMinutes: minutes },
  }, recent, HUB_ACTIVITY_REASON_PORTAL_STAND_IN)
}

function withUnavailableActivity(hub: PublicHub): PublicHub {
  return {
    ...hub,
    activity: {
      ...hub.activity,
      points: [],
      servedWindowMinutes: 30,
      availableWindowMinutes: 30,
      bucketMinutes: 1,
      state: 'degraded',
      source: 'live_pool_fallback',
      reason: 'historical_projection_unavailable',
    },
  }
}

export function usePublicHubData(options: UsePublicHubOptions = {}): PublicHubState {
  const { pollMs = DEFAULT_POLL_MS, enabled = true, activityWindow = '24h', projection, random = Math.random } = options
  // Mount-only cache hydrate — do not re-read localStorage on every render (P4-L01).
  // Later activity-window transitions read cache only in the effect below.
  const [initial] = useState(() => hydrateFromCache(activityWindow, projection))
  const [data, setData] = useState<PublicHub | null>(() => initial.data)
  const [loading, setLoading] = useState(() => initial.loading)
  const [refreshing, setRefreshing] = useState(false)
  const [activityRepairing, setActivityRepairing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryBlocked, setRetryBlocked] = useState(false)
  const [loadSource, setLoadSource] = useState<PublicHubLoadSource | null>(() => initial.loadSource)
  const [hubEndpointOk, setHubEndpointOk] = useState(() => initial.hubEndpointOk)
  const [lastUpdated, setLastUpdated] = useState<number | null>(() => initial.lastUpdated)
  const [displayedSnapshotAt, setDisplayedSnapshotAt] = useState<number | null>(() => initial.lastUpdated)
  const [dataAsOf, setDataAsOf] = useState<number | null>(() => initial.dataAsOf)
  const [cachedAt, setCachedAt] = useState<number | null>(() => initial.cachedAt)
  const [pollSequence, setPollSequence] = useState(() => (initial.hasData ? 1 : 0))
  const [pollAttempt, setPollAttempt] = useState(0)
  const [loadedActivityWindow, setLoadedActivityWindow] = useState<PublicHubActivityWindow | null>(
    () => initial.loadedActivityWindow,
  )
  // A load of the requested window is running, its stand-in included (an enabled hook starts one on mount).
  const [hubReadRunning, setHubReadRunning] = useState(enabled)
  const [hubReadLate, setHubReadLate] = useState(false)
  // The window and projection whose load last settled. A newly picked one counts as read from
  // its first render, before its effect starts the load: the page never reads that gap as given up.
  const [settledKey, setSettledKey] = useState<string | null>(null)

  const controllerRef = useRef<AbortController | null>(null)
  // The requested window's own hub read while it runs: refresh() waits on it rather than start the build over.
  const hubReadRef = useRef<Promise<unknown> | null>(null)
  const inFlightRef = useRef(false)
  const lastFetchAtRef = useRef(0)
  const mountedRef = useRef(true)
  const hasDataRef = useRef(initial.hasData)
  // A hub read has answered since mount. A saved copy is not one, so it still
  // gives way to the early 30m view.
  const networkAppliedRef = useRef(false)
  // The window and projection on screen: a reply for any other never lands,
  // even before the effect cleanup aborts its load.
  const loadKey = `${activityWindow}|${projection ?? ''}`
  const loadKeyRef = useRef(loadKey)
  loadKeyRef.current = loadKey
  const prevActivityWindowRef = useRef(activityWindow)
  const pollSequenceRef = useRef(initial.hasData ? 1 : 0)
  const consecutiveFailuresRef = useRef(0)
  const nextRetryAfterMsRef = useRef<number | null>(null)
  const retryNotBeforeRef = useRef(0)
  // Ends retryBlocked when the server's pause ends, whether or not a read runs then.
  const unblockTimerRef = useRef<number>()
  const pendingPersistRef = useRef<{ hub: PublicHub; activityWindow: PublicHubActivityWindow; projection?: PublicHubProjection; dataAsOf: number | null } | null>(null)
  const randomRef = useRef(random)
  randomRef.current = random

  const applySuccessfulLoad = useCallback(
    // interim: the 30m view shown while the requested window loads; never cached or marked.
    (hub: PublicHub, source: PublicHubLoadSource, endpointOk: boolean, interim = false, asOf: number | null = hubDataAsOf(hub, {})) => {
      const appliedAt = Date.now()
      setData(hub)
      setLoadSource(source)
      setHubEndpointOk(endpointOk)
      setError(null)
      // A Retry-After from the stand-in's read ends with this answer.
      setRetryBlocked(false)
      setLastUpdated(appliedAt)
      setDisplayedSnapshotAt(appliedAt)
      setDataAsOf(asOf)
      setCachedAt(null)
      pollSequenceRef.current += 1
      setPollSequence(pollSequenceRef.current)
      hasDataRef.current = true
      if (endpointOk) networkAppliedRef.current = true
      setLoadedActivityWindow(activityWindow)
      // Persisted by the effect below once React has committed this snapshot.
      pendingPersistRef.current = endpointOk && !interim ? { hub, activityWindow, projection, dataAsOf: asOf } : null
      if (endpointOk && !interim && !projection) markHubDataOnce()
      consecutiveFailuresRef.current = 0
      nextRetryAfterMsRef.current = null
      retryNotBeforeRef.current = 0
      window.clearTimeout(unblockTimerRef.current)
    },
    [activityWindow, projection],
  )

  const load = useCallback(async (force = false) => {
    const key = `${activityWindow}|${projection ?? ''}`
    if (Date.now() < retryNotBeforeRef.current) {
      // A window picked during a Retry-After pause: nothing runs for it, so it never reads as loading.
      // The rate-limit error stays on screen, and the poll loads the window when the pause ends.
      if (!inFlightRef.current && mountedRef.current && loadKeyRef.current === key) {
        setLoading(false)
        setRefreshing(false)
        setHubReadRunning(false)
        setHubReadLate(false)
        setSettledKey(key)
      }
      return
    }
    if (inFlightRef.current && !force) return
    setPollAttempt((n) => n + 1)
    setRetryBlocked(false)

    controllerRef.current?.abort(new DOMException('superseded by new request', 'AbortError'))
    const controller = new AbortController()
    controllerRef.current = controller
    inFlightRef.current = true
    setActivityRepairing(false)
    setHubReadRunning(true)
    setHubReadLate(false)
    // This load still owns the hook: not superseded, unmounted or for another window.
    const current = () => !controller.signal.aborted && mountedRef.current && loadKeyRef.current === key

    if (hasDataRef.current) setRefreshing(true)
    else setLoading(true)

    const minutes = WINDOW_MINUTES[activityWindow]
    // The 30m view and the totals read stop with this load, and once the
    // requested window has answered.
    let recentViewTimer: number | undefined
    const sideReads = new AbortController()
    const stopSideReads = () => {
      window.clearTimeout(recentViewTimer)
      sideReads.abort(new DOMException('requested window settled', 'AbortError'))
    }
    controller.signal.addEventListener('abort', stopSideReads, { once: true })
    // Long window with no hub answer yet (a cold load, or only a saved copy): a
    // busy API can take its whole deadline to build it. If it has not answered
    // after the head start, read the 30m view too, with the hard cap as well:
    // whichever lands first fills the page, the chart still updating, and the
    // requested window's own result settles the load and replaces the 30m view.
    let recentView: ReturnType<typeof fetchPublicHubBase> | undefined
    let recentViewStartedAt = 0
    let recentSettled = false
    // Set once recover() takes this reply as its own result.
    let recovering = false
    // The 30m view is on screen: totals read meanwhile never replace it.
    let recentShown = false
    // Past the deadline the 30m view is what stands in for the late read: it is saved like one.
    let pastDeadline = false
    if (!networkAppliedRef.current && minutes != null && minutes > 30) {
      recentViewTimer = window.setTimeout(() => {
        recentViewStartedAt = Date.now()
        recentView = fetchPublicHubBase(sideReads.signal, '30m', projection, HUB_READ_HARD_CAP_MS)
        void recentView.then((recent) => {
          recentSettled = true
          if (recovering || sideReads.signal.aborted || !current() || !recent.hubEndpointOk) return
          applySuccessfulLoad(recentForRequestedWindow(recent.data, minutes), recent.loadSource, true, !pastDeadline, recent.dataAsOf ?? null)
          recentShown = true
          setLoading(false)
          setActivityRepairing(true)
        }, () => { recentSettled = true })
      }, HUB_RECENT_VIEW_HEAD_START_MS)
    }

    // What stands in for a failed or late read of the requested window. A
    // historical outage must not erase independently available live health:
    // a longer window takes the 30m view (at most one 30m read per load), else
    // totals while nothing measured is on screen. Never bypasses auth or 429
    // backoff. Throws what to report; null once the stand-in is not needed.
    // `readEnded`: the requested window failed; else it missed its deadline and runs on.
    const recover = async (primaryError: unknown, readEnded: boolean) => {
      window.clearTimeout(recentViewTimer)
      if (!canRecoverHubRead(primaryError)) throw primaryError
      let recent: Awaited<ReturnType<typeof fetchPublicHubBase>> | undefined
      // A 30m view still under way at the deadline is not waited on: it fills the page when it lands.
      if (minutes != null && minutes > 30 && (readEnded || !recentView || recentSettled)) {
        recovering = true
        try {
          // A 30m view already read or under way is the recovery read: never a second one.
          // A fresh one keeps the 8 s default: the small body, so a failed cold load reaches its error sooner.
          // One under way runs to the hard cap, but a failed read waits on it only to that same 8 s from
          // its start: past that the stand-in or the error shows now, not when the 30m view gives up.
          const pending = recentView
          if (pending && !recentSettled
            && await missesDeadline(pending, Math.max(0, recentViewStartedAt + 8_000 - Date.now()), sideReads.signal)) {
            recovering = false
          } else {
            recent = await (pending ?? fetchPublicHubBase(sideReads.signal, '30m', projection, 8_000))
          }
        } catch (recentError) {
          if (!canRecoverHubRead(recentError)) throw recentError
        }
      }
      if (sideReads.signal.aborted || !current()) return null
      if (recent?.hubEndpointOk && minutes != null) {
        return { hub: recentForRequestedWindow(recent.data, minutes), source: recent.loadSource, endpointOk: true, dataAsOf: recent.dataAsOf ?? null }
      }
      // Keep an existing measured snapshot instead of replacing it with totals.
      // A projection read (Moments, home tickers) shows no totals, so it reports
      // its own error now rather than waiting on /stats it would never show.
      if (hasDataRef.current || projection) throw primaryError
      const fallback = await fetchPublicHubStatsFallback(sideReads.signal).catch((fallbackError: unknown) => {
        // A 30m view that landed meanwhile is on screen: nothing to report.
        if (recentShown) return null
        // When totals are unreachable too, report the slow hub so the timeout stays visible;
        // a typed fallback error (e.g. a 429 with Retry-After) is kept as is.
        throw isApiError(primaryError) && primaryError.kind === 'timeout' && !isApiError(fallbackError) ? primaryError : fallbackError
      })
      if (!fallback || recentShown || sideReads.signal.aborted || !current()) return null
      return { hub: fallback.data, source: fallback.loadSource, endpointOk: false, dataAsOf: null }
    }

    // Honor server Retry-After when present; never shorten below healthy cadence.
    const pauseFor = (err: unknown) => {
      if (!isApiError(err) || typeof err.retryAfterMs !== 'number' || err.retryAfterMs <= 0) return
      const pauseMs = Math.max(pollMs, err.retryAfterMs)
      nextRetryAfterMsRef.current = pauseMs
      retryNotBeforeRef.current = Date.now() + pauseMs
      setRetryBlocked(true)
      // Offer Try again once the pause ends: a hidden tab, polling turned off, or a
      // poll that fired just before the end may not run a read then.
      window.clearTimeout(unblockTimerRef.current)
      unblockTimerRef.current = window.setTimeout(() => setRetryBlocked(false), pauseMs)
    }

    const report = (err: unknown) => {
      if (isApiError(err) && err.kind === 'aborted') return
      consecutiveFailuresRef.current += 1
      pauseFor(err)
      setError(
        isApiError(err)
          ? err.kind === 'timeout' ? HUB_TIMEOUT_MESSAGE : err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load live hub data',
      )
      // Cache hydrate may have set hubEndpointOk=true; a total network miss must clear it.
      setHubEndpointOk(false)
    }

    try {
      // apiClient ends the read itself at the hard cap; its deadline only ends the wait.
      const read = fetchPublicHubBase(controller.signal, activityWindow, projection, HUB_READ_HARD_CAP_MS)
      hubReadRef.current = read
      const readDone = () => { if (hubReadRef.current === read) hubReadRef.current = null }
      read.then(readDone, readDone)
      // Past its deadline the read counts as timed out (the 30m view, totals, or
      // the saved copy with the slow-hub error) but keeps running: its answer
      // replaces whatever stands in for it.
      let standIn: Promise<void> | undefined
      if (await missesDeadline(read, hubReadTimeoutMs(activityWindow, projection) ?? 8_000, controller.signal)) {
        if (!current()) return
        pastDeadline = true
        setHubReadLate(true)
        standIn = recover(HUB_DEADLINE_MISSED, false).then(
          (shown) => {
            if (!shown || sideReads.signal.aborted || !current()) return
            applySuccessfulLoad(shown.hub, shown.source, shown.endpointOk, false, shown.dataAsOf)
            // A 30m view stands in for the requested window: its chart says it is updating, as on a cold load.
            if (shown.endpointOk) setActivityRepairing(true)
          },
          (err: unknown) => {
            if (!sideReads.signal.aborted && current()) report(err)
          },
        ).then(() => {
          if (sideReads.signal.aborted || !current()) return
          // The chart of a 30m view keeps saying it is updating: the requested window still runs.
          setLoading(false)
          setRefreshing(false)
        })
      }

      let base: Awaited<ReturnType<typeof fetchPublicHubBase>>
      try {
        base = await read
      } catch (primaryError) {
        if (!current()) return
        if (standIn) {
          // The stand-in already shows what replaces this read; a 30m view
          // still under way may yet land in its place. Only a Retry-After
          // still holds the next one back.
          await standIn
          if (recentView && canRecoverHubRead(primaryError)) await recentView.catch(() => undefined)
          if (current()) pauseFor(primaryError)
          return
        }
        const shown = await recover(primaryError, true)
        if (shown) applySuccessfulLoad(shown.hub, shown.source, shown.endpointOk, false, shown.dataAsOf)
        return
      }
      if (!current()) return
      // A late unhealthy answer changes nothing the stand-in shows.
      if (standIn && !base.hubEndpointOk) {
        await standIn
        return
      }
      stopSideReads()

      if (base.hubEndpointOk) {
        let next = base.data
        let nextAsOf = base.dataAsOf ?? null
        // Older hosted instances returned coarse long-window rows while
        // claiming a 30m fallback. Fetch the canonical 30m endpoint so the
        // chart never presents repeated aggregates as minute activity.
        if (activityWindow !== '30m' && hubActivityNeedsRecentFallback(base.data.activity)) {
          // The primary response already verified the independent live lanes.
          // Publish them without invalid activity while its repair is pending;
          // only the final snapshot advances freshness, sequence, and cache.
          const withheld = withUnavailableActivity(base.data)
          setData(withheld)
          setDisplayedSnapshotAt(Date.now())
          setDataAsOf(nextAsOf)
          setLoadSource(base.loadSource)
          setHubEndpointOk(true)
          setError(null)
          setCachedAt(null)
          setLoading(false)
          setActivityRepairing(true)
          hasDataRef.current = true
          networkAppliedRef.current = true
          try {
            // Same short deadline as the recovery read: the 30m body is small.
            const recent = await fetchPublicHubBase(controller.signal, '30m', projection, 8_000)
            if (recent.hubEndpointOk) {
              next = replaceWithCanonicalRecentActivity(base.data, recent.data)
              nextAsOf = olderHubDataAsOf(nextAsOf, recent.dataAsOf ?? null)
            } else {
              next = withheld
            }
          } catch (repairError) {
            if (isApiError(repairError) && ['aborted', 'rate_limited', 'unauthorized'].includes(repairError.kind)) {
              throw repairError
            }
            // Never paint a known-invalid coarse payload if the repair request
            // is unavailable; keep the shell and expose an honest empty chart.
            next = withheld
          }
        }
        if (!current()) return
        applySuccessfulLoad(next, base.loadSource, true, false, nextAsOf)
        return
      }

      // On hub failure with existing data: keep stale UI; do not storm fallback.
      // A projection read has no use for totals either.
      if (hasDataRef.current || projection) {
        consecutiveFailuresRef.current += 1
        setHubEndpointOk(false)
        setError('hub offline')
        return
      }

      const fallback = await fetchPublicHubStatsFallback(controller.signal)
      if (!current()) return
      applySuccessfulLoad(fallback.data, fallback.loadSource, fallback.hubEndpointOk)
    } catch (err) {
      // Aborts are intentional cleanup (refresh supersession, unmount, hook disable,
      // or our own apiClient timeout). They are NOT user-facing errors — surfacing
      // them painted the "Could not refresh hub data" banner with Chrome's raw
      // DOMException name ("signal is aborted without reason").
      if (!current()) return
      report(err)
    } finally {
      stopSideReads()
      // A load for a window no longer shown leaves its flags to the effect cleanup that ends it.
      if (controllerRef.current === controller && loadKeyRef.current === key) {
        inFlightRef.current = false
        lastFetchAtRef.current = Date.now()
        if (mountedRef.current) {
          setLoading(false)
          setRefreshing(false)
          setActivityRepairing(false)
          // Only now, with its stand-in shown: the page never reads a gap between them as given up.
          setHubReadRunning(false)
          setHubReadLate(false)
          setSettledKey(key)
        }
      }
    }
  }, [activityWindow, applySuccessfulLoad, pollMs, projection])

  const refresh = useCallback(() => {
    // The origin may still be building the read under way: starting over would
    // only push its answer back. Wait on it instead, and show that it is waited on.
    if (hubReadRef.current) {
      if (hasDataRef.current) setRefreshing(true)
      else setLoading(true)
      return
    }
    void load(true)
  }, [load])

  // Persist only a snapshot the page has committed: a render crash above this
  // hook never commits one. A crash that does commit (in an effect, or below a
  // nested boundary) is discarded by the error boundary that catches it.
  useEffect(() => {
    const pending = pendingPersistRef.current
    if (!pending) return
    pendingPersistRef.current = null
    persistSuccessfulHub(pending.activityWindow, pending.hub, pending.projection, pending.dataAsOf)
  }, [pollSequence])

  useEffect(() => {
    if (prevActivityWindowRef.current === activityWindow) return
    prevActivityWindowRef.current = activityWindow
    const cached = readPublicHubCacheForCurrentBackend(activityWindow, projection)
    if (cached) {
      setData(cached.data)
      setLoading(false)
      setLoadSource('cache')
      setHubEndpointOk(true)
      setLastUpdated(cached.cachedAt)
      setDisplayedSnapshotAt(cached.cachedAt)
      setDataAsOf(cached.dataAsOf)
      setCachedAt(cached.cachedAt)
      pollSequenceRef.current += 1
      setPollSequence(pollSequenceRef.current)
      hasDataRef.current = true
      setLoadedActivityWindow(activityWindow)
      return
    }
    // Stale-while-revalidate: keep prior hub payload visible while the new window loads.
    if (!hasDataRef.current) {
      setLoading(true)
    }
  }, [activityWindow, projection])

  useEffect(() => {
    mountedRef.current = true
    setActivityRepairing(false)
    if (!enabled) {
      setLoading(false)
      setRefreshing(false)
      setHubReadRunning(false)
      return () => {
        mountedRef.current = false
        const controller = controllerRef.current
        controller?.abort(new DOMException('hook disabled', 'AbortError'))
        if (controllerRef.current === controller) {
          controllerRef.current = null
          inFlightRef.current = false
        }
      }
    }

    let active = true
    let pollTimer: number | undefined
    const scheduleNext = () => {
      if (!active || pollMs <= 0) return
      const retryAfter = nextRetryAfterMsRef.current
      nextRetryAfterMsRef.current = null
      // A window picked during a Retry-After pause loads as soon as the pause ends.
      const paused = retryNotBeforeRef.current - Date.now()
      const delay =
        retryAfter ??
        (paused > 0 ? paused : computeJitteredDelayMs(pollMs, consecutiveFailuresRef.current, randomRef.current))
      arm(delay)
    }
    const arm = (delay: number) => {
      pollTimer = window.setTimeout(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          scheduleNext()
          return
        }
        // A read pressed while this poll waited may have set a later Retry-After:
        // poll when that pause ends, not a whole Retry-After after this tick.
        const wait = retryNotBeforeRef.current - Date.now()
        if (wait > 0) {
          nextRetryAfterMsRef.current = null
          arm(wait)
          return
        }
        void load().finally(() => {
          if (active) scheduleNext()
        })
      }, delay)
    }
    // Initial failures must establish their Retry-After before scheduling a poll.
    void load().finally(scheduleNext)

    const onVisible = () => {
      if (pollMs <= 0) return
      if (document.visibilityState !== 'visible') return
      const sinceLastFetch = Date.now() - lastFetchAtRef.current
      if (sinceLastFetch < Math.min(pollMs / 2, 15_000)) return
      void load()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      active = false
      mountedRef.current = false
      const controller = controllerRef.current
      controller?.abort(new DOMException('component unmounted', 'AbortError'))
      if (controllerRef.current === controller) {
        controllerRef.current = null
        inFlightRef.current = false
      }
      if (pollTimer) window.clearTimeout(pollTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, pollMs, load])

  useEffect(() => () => window.clearTimeout(unblockTimerRef.current), [])

  const activityRefreshing = useMemo(
    () =>
      Boolean(
        activityRepairing || (refreshing && data && loadedActivityWindow !== activityWindow),
      ),
    [activityRepairing, activityWindow, data, loadedActivityWindow, refreshing],
  )

  return {
    data,
    loading,
    refreshing,
    activityRefreshing,
    error,
    loadSource,
    hubEndpointOk,
    liveEmpty: Boolean(data) && (data?.poolSize ?? 0) === 0,
    lastUpdated,
    displayedSnapshotAt,
    dataAsOf,
    lastSuccessfulPollAt: lastUpdated,
    pollSequence,
    pollAttempt,
    cachedAt,
    retryBlocked,
    hubReadPending: enabled && (hubReadRunning || settledKey !== loadKey) &&
      (!data || loadSource === 'stats-fallback' || loadSource === 'cache'),
    hubReadRunning: enabled && hubReadRunning,
    hubReadLate: enabled && hubReadLate,
    refresh,
  }
}
