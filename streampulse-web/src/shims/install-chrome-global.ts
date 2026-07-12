/** Minimal chrome API stub for extension UI bundles on the marketing site. */

type ChromeStub = {
  storage: {
    sync: { get: () => Promise<Record<string, unknown>>; set: () => Promise<void> }
    local: { get: () => Promise<Record<string, unknown>>; set: () => Promise<void> }
    onChanged: { addListener: () => void; removeListener: () => void }
  }
  runtime: {
    sendMessage: () => Promise<{ ok: boolean }>
    openOptionsPage: () => void
    onMessage: {
      addListener: (handler: (message: unknown) => void) => void
      removeListener: (handler: (message: unknown) => void) => void
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var chrome: ChromeStub | undefined
}

if (typeof globalThis.chrome === 'undefined') {
  const listeners = new Map<string, Set<(message: unknown) => void>>()

  globalThis.chrome = {
    storage: {
      sync: {
        get: async () => ({}),
        set: async () => undefined,
      },
      local: {
        get: async () => ({}),
        set: async () => undefined,
      },
      onChanged: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
    },
    runtime: {
      sendMessage: async () => ({ ok: true }),
      openOptionsPage: () => undefined,
      onMessage: {
        addListener: (handler: (message: unknown) => void) => {
          const set = listeners.get('message') ?? new Set()
          set.add(handler)
          listeners.set('message', set)
        },
        removeListener: (handler: (message: unknown) => void) => {
          listeners.get('message')?.delete(handler)
        },
      },
    },
  }
}

export {}
