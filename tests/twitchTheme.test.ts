import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectTwitchColorScheme,
  observeTwitchColorScheme,
  resolvePulseColorScheme,
  type TwitchColorScheme,
} from '../src/content/twitchTheme.ts'

type StubRoot = {
  className: string
  classList: { contains: (token: string) => boolean }
  getAttribute: (name: string) => string | null
}

function createStubRoot(initial: string): StubRoot {
  const root: StubRoot = {
    className: initial,
    classList: {
      contains(token: string) {
        return root.className.split(/\s+/).filter(Boolean).includes(token)
      },
    },
    getAttribute(name: string) {
      return name === 'class' ? root.className : null
    },
  }
  return root
}

describe('detectTwitchColorScheme', () => {
  it('detects light and dark root classes', () => {
    expect(detectTwitchColorScheme(createStubRoot('tw-root--theme-light') as unknown as Element)).toBe('light')
    expect(detectTwitchColorScheme(createStubRoot('tw-root--theme-dark') as unknown as Element)).toBe('dark')
  })

  it('falls back to dark when unknown', () => {
    expect(detectTwitchColorScheme(createStubRoot('') as unknown as Element)).toBe('dark')
    expect(detectTwitchColorScheme(createStubRoot('some-other-class') as unknown as Element)).toBe('dark')
  })

  it('resolves light/dark conflicts to dark', () => {
    expect(
      detectTwitchColorScheme(
        createStubRoot('tw-root--theme-light tw-root--theme-dark') as unknown as Element,
      ),
    ).toBe('dark')
  })
})

describe('resolvePulseColorScheme', () => {
  it('honors explicit light/dark over Twitch', () => {
    expect(resolvePulseColorScheme('light', 'dark')).toBe('light')
    expect(resolvePulseColorScheme('dark', 'light')).toBe('dark')
  })

  it('follows Twitch when preference is auto', () => {
    expect(resolvePulseColorScheme('auto', 'light')).toBe('light')
    expect(resolvePulseColorScheme('auto', 'dark')).toBe('dark')
  })
})

describe('observeTwitchColorScheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits only when the resolved scheme changes and cleans up', () => {
    const root = createStubRoot('tw-root--theme-dark')
    const observed: TwitchColorScheme[] = []
    const listeners: Array<() => void> = []
    const disconnect = vi.fn()
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(cb: () => void) {
          listeners.push(cb)
        }
        observe() {}
        disconnect = disconnect
      },
    )

    const stop = observeTwitchColorScheme(scheme => {
      observed.push(scheme)
    }, root as unknown as Element)
    expect(observed).toEqual(['dark'])

    root.className = 'tw-root--theme-dark extra'
    listeners[0]?.()
    expect(observed).toEqual(['dark'])

    root.className = 'tw-root--theme-light'
    listeners[0]?.()
    expect(observed).toEqual(['dark', 'light'])

    stop()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
