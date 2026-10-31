import { afterEach, vi } from 'vitest'
import { configure } from '@testing-library/dom'
import { resetChartWheelGuard } from '@streampulse/analytics-console/components/analytics/ChartNavigator'
import { resetChartScrollZoomMemory } from '@streampulse/analytics-console/components/analytics/chartScrollZoom'

configure({ asyncUtilTimeout: 5000 })

class IntersectionObserverStub {
  readonly root: Element | Document | null = null
  readonly rootMargin = ''
  readonly thresholds: ReadonlyArray<number> = []

  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver
}

class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {}

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  HTMLElement.prototype.scrollTo = () => {}
}

// Unit tests never reach a real API: a request to any host but this machine waits, unanswered,
// until its caller aborts it. A test that needs a reply stubs fetch itself.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const passThroughFetch = globalThis.fetch
if (typeof passThroughFetch === 'function') {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (LOCAL_HOSTS.has(new URL(href, 'http://localhost').hostname)) return passThroughFetch(input, init)
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason)
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }) as typeof fetch
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  // Chart Scroll zoom preference and scroll-through guard are page-wide.
  resetChartScrollZoomMemory()
  resetChartWheelGuard()
})
