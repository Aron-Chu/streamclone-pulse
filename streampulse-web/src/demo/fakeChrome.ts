/**
 * The extension's outside world for the /extension demo.
 *
 * The panel on the page is the shipped extension code (src/ui/Overlay.tsx with
 * the real src/shared/storage.ts and src/content/bridge.ts). Those modules read
 * the `chrome` global, so the demo installs this fake before the panel loads.
 * It always replaces the global: Chromium defines `chrome` on every page, so a
 * "install when missing" stub would never go in there.
 *
 * Messages go to a responder that answers like the background worker does
 * (demoResponder.ts). Storage lives in memory and fires `onChanged` the way
 * chrome.storage does, so settings the visitor changes take effect in the panel.
 */

export type DemoResponder = (message: unknown) => unknown | Promise<unknown>

type Listener<A extends unknown[]> = (...args: A) => unknown

interface StorageChange {
  oldValue?: unknown
  newValue?: unknown
}

type StorageAreaName = 'sync' | 'local' | 'session'
type StorageKeys = string | string[] | Record<string, unknown> | null | undefined

class ListenerSet<A extends unknown[]> {
  private readonly listeners = new Set<Listener<A>>()

  addListener = (listener: Listener<A>): void => {
    this.listeners.add(listener)
  }

  removeListener = (listener: Listener<A>): void => {
    this.listeners.delete(listener)
  }

  hasListener = (listener: Listener<A>): boolean => this.listeners.has(listener)

  hasListeners = (): boolean => this.listeners.size > 0

  emit(...args: A): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(...args)
      } catch (error) {
        // A listener's failure must not stop the others, as in chrome.*.
        console.error('[demo] listener failed', error)
      }
    }
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T
}

function createStorageArea(
  name: StorageAreaName,
  onChanged: ListenerSet<[Record<string, StorageChange>, StorageAreaName]>,
  initial: Record<string, unknown> = {},
) {
  const data = new Map<string, unknown>(Object.entries(clone(initial)))

  const read = (keys: StorageKeys): Record<string, unknown> => {
    if (keys == null) return Object.fromEntries([...data].map(([key, value]) => [key, clone(value)]))
    if (typeof keys === 'string') return data.has(keys) ? { [keys]: clone(data.get(keys)) } : {}
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.filter(key => data.has(key)).map(key => [key, clone(data.get(key))]))
    }
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [key, data.has(key) ? clone(data.get(key)) : fallback]),
    )
  }

  const write = (items: Record<string, unknown>): void => {
    const changes: Record<string, StorageChange> = {}
    for (const [key, value] of Object.entries(items)) {
      if (value === undefined) continue
      const next = clone(value)
      changes[key] = { oldValue: data.get(key), newValue: next }
      data.set(key, next)
    }
    if (Object.keys(changes).length) onChanged.emit(changes, name)
  }

  const removeKeys = (keys: string | string[]): void => {
    const changes: Record<string, StorageChange> = {}
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (!data.has(key)) continue
      changes[key] = { oldValue: data.get(key) }
      data.delete(key)
    }
    if (Object.keys(changes).length) onChanged.emit(changes, name)
  }

  /** chrome.storage accepts a trailing callback as well as returning a Promise. */
  function settle<T>(value: T, callback?: (value: T) => void): Promise<T> {
    const promise = Promise.resolve(value)
    if (typeof callback === 'function') void promise.then(callback)
    return promise
  }

  return {
    get(keys?: StorageKeys | ((items: Record<string, unknown>) => void), callback?: (items: Record<string, unknown>) => void) {
      if (typeof keys === 'function') return settle(read(null), keys)
      return settle(read(keys), callback)
    },
    set(items: Record<string, unknown>, callback?: () => void) {
      write(items)
      return settle(undefined, callback)
    },
    remove(keys: string | string[], callback?: () => void) {
      removeKeys(keys)
      return settle(undefined, callback)
    },
    clear(callback?: () => void) {
      removeKeys([...data.keys()])
      return settle(undefined, callback)
    },
    getBytesInUse(keys?: StorageKeys, callback?: (bytes: number) => void) {
      const bytes = new TextEncoder().encode(JSON.stringify(read(keys ?? null))).length
      return settle(bytes, callback)
    },
    /** Test and debugging aid: a copy of everything stored in this area. */
    snapshot: (): Record<string, unknown> => read(null),
  }
}

export interface FakeChromeOptions {
  responder: DemoResponder
  /** The extension version the demo reports (the panel shows it in settings). */
  version: string
  /** Seed values, e.g. the visitor's settings for this demo. */
  sync?: Record<string, unknown>
  local?: Record<string, unknown>
}

export type FakeChrome = ReturnType<typeof createFakeChrome>

export function createFakeChrome(options: FakeChromeOptions) {
  const storageChanged = new ListenerSet<[Record<string, StorageChange>, StorageAreaName]>()
  const runtimeMessage = new ListenerSet<[unknown, { id: string }, (response?: unknown) => void]>()

  const runtime = {
    id: 'streampulse-site-demo',
    lastError: undefined as { message: string } | undefined,
    onMessage: runtimeMessage,
    onConnect: new ListenerSet<[unknown]>(),
    onInstalled: new ListenerSet<[unknown]>(),
    getManifest: () => ({ manifest_version: 3, name: 'StreamPulse', version: options.version }),
    // Nothing on the site is an extension resource; an empty URL loads nothing.
    getURL: (_path: string) => '',
    openOptionsPage: (callback?: () => void) => {
      callback?.()
      return Promise.resolve()
    },
    /**
     * Promise form (`sendMessage(msg)`) and callback form
     * (`sendMessage(msg, callback)` with `lastError`), like Chromium.
     */
    sendMessage(message: unknown, optionsOrCallback?: unknown, maybeCallback?: unknown): Promise<unknown> {
      const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as
        | ((response: unknown) => void)
        | undefined
      const answer = Promise.resolve().then(() => options.responder(message))
      if (typeof callback === 'function') {
        void answer.then(
          response => callback(response),
          error => {
            runtime.lastError = { message: error instanceof Error ? error.message : String(error) }
            try {
              callback(undefined)
            } finally {
              runtime.lastError = undefined
            }
          },
        )
        return Promise.resolve(undefined)
      }
      return answer
    },
  }

  return {
    runtime,
    storage: {
      sync: createStorageArea('sync', storageChanged, options.sync),
      local: createStorageArea('local', storageChanged, options.local),
      session: createStorageArea('session', storageChanged),
      onChanged: storageChanged,
    },
    permissions: {
      contains: (_request: unknown, callback?: (granted: boolean) => void) => {
        callback?.(false)
        return Promise.resolve(false)
      },
      request: (_request: unknown, callback?: (granted: boolean) => void) => {
        callback?.(false)
        return Promise.resolve(false)
      },
    },
    extension: { inIncognitoContext: false },
    /** Push a worker-style broadcast to the panel's `runtime.onMessage` listeners. */
    dispatchRuntimeMessage(message: unknown): void {
      runtimeMessage.emit(message, { id: runtime.id }, () => undefined)
    },
  }
}

/** Replace `globalThis.chrome` with the fake, whatever is there now. Chrome's own `chrome` can be written but not redefined. */
export function installFakeChrome(fake: FakeChrome): FakeChrome {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
  if (own && !own.configurable) {
    ;(globalThis as { chrome?: unknown }).chrome = fake
    return fake
  }
  Object.defineProperty(globalThis, 'chrome', {
    value: fake,
    configurable: true,
    writable: true,
  })
  return fake
}
