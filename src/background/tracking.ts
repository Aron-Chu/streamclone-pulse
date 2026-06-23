import { DEFAULT_POLL_INTERVAL_MS } from '../shared/storage.ts'

type PollHandle = ReturnType<typeof setInterval>

interface TrackedLogin {
  login: string
  timer: PollHandle | null
  intervalMs: number
}

const tracked = new Map<string, TrackedLogin>()
let globalPollingEnabled = true
let pollCallback: ((login: string) => Promise<void>) | null = null

export function configurePolling(poll: (login: string) => Promise<void>): void {
  pollCallback = poll
}

export function setGlobalPollingEnabled(enabled: boolean): void {
  globalPollingEnabled = enabled
  if (!pollCallback) return
  for (const login of tracked.keys()) {
    if (enabled) {
      resumePolling(login, pollCallback)
    } else {
      pausePolling(login)
    }
  }
}

export function isTracked(login: string): boolean {
  return tracked.has(normalize(login))
}

export function trackLogin(login: string, intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  const key = normalize(login)
  if (tracked.has(key)) {
    return
  }
  tracked.set(key, { login: key, timer: null, intervalMs })
}

export function untrackLogin(login: string): void {
  const key = normalize(login)
  const entry = tracked.get(key)
  if (entry?.timer) {
    clearInterval(entry.timer)
  }
  tracked.delete(key)
}

export function listTrackedLogins(): string[] {
  return [...tracked.keys()]
}

export function pausePolling(login: string): void {
  const key = normalize(login)
  const entry = tracked.get(key)
  if (entry?.timer) {
    clearInterval(entry.timer)
    entry.timer = null
  }
}

export function resumePolling(
  login: string,
  poll: (login: string) => Promise<void>,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
): void {
  const key = normalize(login)
  const entry = tracked.get(key)
  if (!entry) return
  entry.intervalMs = intervalMs
  if (entry.timer) {
    clearInterval(entry.timer)
    entry.timer = null
  }
  if (!globalPollingEnabled) return
  void poll(key)
  entry.timer = setInterval(() => {
    void poll(key)
  }, entry.intervalMs)
}

export function startPolling(
  login: string,
  poll: (login: string) => Promise<void>,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
): void {
  const key = normalize(login)
  let entry = tracked.get(key)
  if (!entry) {
    entry = { login: key, timer: null, intervalMs }
    tracked.set(key, entry)
  }
  entry.intervalMs = intervalMs
  if (entry.timer) {
    clearInterval(entry.timer)
    entry.timer = null
  }
  if (!globalPollingEnabled) return
  void poll(key)
  entry.timer = setInterval(() => {
    void poll(key)
  }, entry.intervalMs)
}

export function pauseAllPolling(): void {
  globalPollingEnabled = false
  for (const login of tracked.keys()) {
    pausePolling(login)
  }
}

export function resumeAllPolling(
  poll: (login: string) => Promise<void>,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
): void {
  globalPollingEnabled = true
  pollCallback = poll
  for (const login of tracked.keys()) {
    resumePolling(login, poll, intervalMs)
  }
}

function normalize(login: string): string {
  return login.trim().toLowerCase()
}
