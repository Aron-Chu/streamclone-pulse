import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, NavigationType, Outlet, Route, Router, Routes, useNavigate, type NavigateFunction, type Navigator } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../src/routes/index'
import { RequireAuth } from '../src/routes/guards'
import { RouteScrollManager, useHashScrollHold } from '../src/ui/RouteScrollManager'
import { hashTargetId } from '../src/lib/routeScroll'

let frames: FrameRequestCallback[] = []
let navigate: NavigateFunction
let scrollIntoView: ReturnType<typeof vi.fn>
let scrollTo: ReturnType<typeof vi.fn>

function runFrames(count = 1) {
  for (let i = 0; i < count; i += 1) {
    const due = frames
    frames = []
    for (const callback of due) callback(performance.now())
  }
}

async function settleMicrotasks() {
  await act(async () => { await Promise.resolve() })
}

let clock = 0

/** Frames `every` ms apart for `ms` of wall-clock time: a 120 Hz screen draws one every 8.3 ms. */
function runFramesFor(ms: number, every = 1000 / 120) {
  clock = Math.max(clock, performance.now())
  for (let elapsed = 0; elapsed < ms; elapsed += every) {
    clock += every
    const due = frames
    frames = []
    for (const callback of due) callback(clock)
  }
}

/** Resolve on the next popstate, after the router's and the manager's own listeners. */
function nextPopState(during?: () => void) {
  return new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => { during?.(); resolve() }, { once: true })
  })
}

/**
 * Back or Forward through jsdom's real session history, which pops after a task
 * as a browser does. `during` runs as the browser restores its offset, before
 * the router commits the entry.
 */
async function traverse(delta: number, during?: () => void) {
  await act(async () => {
    const popped = nextPopState(during)
    window.history.go(delta)
    await popped
  })
  await settleMicrotasks()
}

/**
 * A native in-page link: the browser adds a history entry with no state, pops
 * to it, and scrolls to the fragment (`during`) before the router commits it.
 */
async function followNative(href: string, during?: () => void) {
  const link = document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!
  await act(async () => {
    const popped = nextPopState(during)
    link.click()
    await popped
  })
  await settleMicrotasks()
}

function NavigateProbe() {
  navigate = useNavigate()
  return null
}

function scrolledElements(): Element[] {
  return scrollIntoView.mock.contexts as Element[]
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavigateProbe />
      <RouteScrollManager />
      <AppRoutes />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  scrollTo = vi.fn()
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo)
  // jsdom has no layout, so scrollIntoView is not implemented.
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
  // Public pages here are static; make any accidental request fail loudly instead of leaving the machine.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in routeScroll tests'))))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (Element.prototype as Partial<Element>).scrollIntoView
  setScrollY(0)
  window.history.replaceState(null, '', '/')
})

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value })
}

/** jsdom has no layout: place one element in the viewport and give the page room to scroll. */
function layoutTarget(id: string) {
  const layout = { top: 0 }
  const rect = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.id === id ? ({ top: layout.top } as DOMRect) : rect.call(this)
  })
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(10_000)
  return layout
}

describe('route change scroll (OP1-FUN-008)', () => {
  it('opens a footer link destination at the top instead of the previous page offset', async () => {
    renderApp('/docs')
    await settleMicrotasks()
    expect(scrollTo).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('link', { name: 'Privacy Policy' }))
    expect(await screen.findByRole('heading', { name: /^privacy policy$/i })).toBeTruthy()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('lands a pushed /docs#extension link on its section, not the old offset', async () => {
    renderApp('/support')
    await settleMicrotasks()

    fireEvent.click(screen.getByRole('link', { name: /extension setup guide/i }))
    await settleMicrotasks()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    expect(scrolledElements()).toEqual([document.getElementById('extension')])
    // A different page is a fresh landing, like a document load: no animation.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  })

  it('opens the closed Developer reference for a /docs/api redirect to #api', async () => {
    renderApp('/docs/api')
    await settleMicrotasks()
    const target = document.getElementById('api')
    expect(target).toBeTruthy()
    expect(target?.closest('details')?.open).toBe(true)
    expect(scrolledElements()).toContain(target)
  })

  it('leaves Back and Forward to the browser scroll restoration', async () => {
    renderApp('/docs')
    await settleMicrotasks()
    act(() => { navigate('/privacy') })
    await settleMicrotasks()
    scrollTo.mockClear()

    act(() => { navigate(-1) })
    await settleMicrotasks()
    runFrames(5)
    expect(await screen.findByTestId('docs-page')).toBeTruthy()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('keeps the reader in place when only the query string changes', async () => {
    render(
      <MemoryRouter initialEntries={['/list#rows']}>
        <NavigateProbe />
        <RouteScrollManager />
        <Routes><Route path="/list" element={<main><section id="rows">List</section></main>} /></Routes>
      </MemoryRouter>,
    )
    await settleMicrotasks()
    runFrames(120)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // e.g. a hub range change on /analytics#section-tracked must not re-land on the section.
    act(() => { navigate('/list?q=xqc#rows') })
    act(() => { navigate('/list?q=xqc&window=7d#rows', { replace: true }) })
    await settleMicrotasks()
    runFrames(5)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('opens the bare page at the top from a link on one of its #sections', async () => {
    renderApp('/docs#coverage')
    await settleMicrotasks()
    expect(scrollTo).not.toHaveBeenCalled()

    // e.g. the header Docs link while reading /docs#api.
    act(() => { navigate('/docs') })
    await settleMicrotasks()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)

    // A page that rewrites its own URL without the hash keeps the reader's place.
    scrollTo.mockClear()
    act(() => { navigate('/docs#coverage') })
    act(() => { navigate('/docs', { replace: true }) })
    await settleMicrotasks()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('keeps the reader\'s place when a link drops a #t= deep link from the same page', async () => {
    renderApp('/docs#t=120')
    await settleMicrotasks()
    scrollTo.mockClear()

    // e.g. the sidebar link to the session already open at a selected minute.
    act(() => { navigate('/docs') })
    await settleMicrotasks()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('leaves a native #fragment link to the browser, without a second landing', async () => {
    const navigator = { createHref: () => '', go: () => {}, push: () => {}, replace: () => {} } as unknown as Navigator
    // React Router keys the first entry and every native fragment entry 'default'.
    const at = (hash: string) => (
      <Router location={{ pathname: '/docs', search: '', hash, state: null, key: 'default' }} navigationType={NavigationType.Pop} navigator={navigator}>
        <RouteScrollManager />
        <main><section id="first">First</section><section id="second">Second</section></main>
      </Router>
    )
    const view = render(at('#first'))
    await settleMicrotasks()
    runFrames(120)
    expect(scrolledElements()).toEqual([document.getElementById('first')])

    // The browser has already scrolled to #second when the router sees the POP.
    view.rerender(at('#second'))
    await settleMicrotasks()
    runFrames(120)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('animates an in-page hash change unless the reader prefers reduced motion', async () => {
    renderApp('/docs')
    await settleMicrotasks()
    act(() => { navigate('/docs#coverage') })
    await settleMicrotasks()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', behavior: 'smooth' })

    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('reduce'), media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }))
    act(() => { navigate('/docs#help') })
    await settleMicrotasks()
    expect(scrolledElements()[scrolledElements().length - 1]).toBe(document.getElementById('help'))
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', behavior: 'auto' })
  })

  it('is mounted once for the whole portal router', () => {
    const main = readFileSync(resolve(import.meta.dirname, '../src/main.tsx'), 'utf8')
    expect(main.match(/<RouteScrollManager \/>/g)).toHaveLength(1)
    expect(main.indexOf('<RouteScrollManager />')).toBeGreaterThan(main.indexOf('<BrowserRouter>'))
    expect(main.indexOf('<RouteScrollManager />')).toBeLessThan(main.indexOf('</BrowserRouter>'))
  })
})

function HeldSections({ pending }: { pending: boolean }) {
  useHashScrollHold(pending)
  // Like the hub, the section exists as a skeleton before its data arrives.
  return <main><section id="section-tracked">{pending ? 'Loading' : 'Channels'}</section></main>
}

function LateTarget() {
  const [ready, setReady] = useState(false)
  return (
    <main>
      <button type="button" onClick={() => setReady(true)}>Load</button>
      {ready ? <section id="analytics-main">Explorer</section> : null}
    </main>
  )
}

describe('cold-load fragment landing (OP1-FUN-001)', () => {
  it('waits for the page to release its hold before landing on #section-tracked', async () => {
    const tree = (pending: boolean) => (
      <StrictMode>
        <MemoryRouter initialEntries={['/analytics#section-tracked']}>
          <RouteScrollManager />
          <Routes><Route path="/analytics" element={<HeldSections pending={pending} />} /></Routes>
        </MemoryRouter>
      </StrictMode>
    )
    const view = render(tree(true))
    await settleMicrotasks()
    runFrames(30)
    expect(scrollIntoView).not.toHaveBeenCalled()

    view.rerender(tree(false))
    runFrames(1)
    expect(scrolledElements()).toEqual([document.getElementById('section-tracked')])
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    // A cold load never jumps to the top first: the browser owns the initial offset.
    expect(scrollTo).not.toHaveBeenCalled()

    runFrames(120)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(0)
  })

  it('lands on a target that renders after the lazy route, then re-aligns if content above it shifts', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/explore#analytics-main']}>
        <RouteScrollManager />
        <Routes><Route path="/analytics/explore" element={<LateTarget />} /></Routes>
      </MemoryRouter>,
    )
    await settleMicrotasks()
    runFrames(10)
    expect(scrollIntoView).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    runFrames(1)
    const target = document.getElementById('analytics-main')!
    expect(scrolledElements()).toEqual([target])

    // A late row above the target pushes it 300 px down before the page settles.
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 300 } as DOMRect)
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(5000)
    runFrames(1)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('abandons a pending landing once the reader starts scrolling', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/explore#analytics-main']}>
        <RouteScrollManager />
        <Routes><Route path="/analytics/explore" element={<LateTarget />} /></Routes>
      </MemoryRouter>,
    )
    await settleMicrotasks()
    runFrames(2)
    fireEvent.wheel(window)
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    runFrames(5)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('treats only element ids as scroll targets', () => {
    expect(hashTargetId('#section-tracked')).toBe('section-tracked')
    expect(hashTargetId('#v0.2.1')).toBe('v0.2.1')
    expect(hashTargetId('')).toBeNull()
    expect(hashTargetId('#')).toBeNull()
    // Session deep links and malformed encodings are not anchors, and must not throw.
    expect(hashTargetId('#t=2400')).toBeNull()
    expect(hashTargetId('#%')).toBeNull()
    expect(hashTargetId('#100%')).toBeNull()
  })
})

describe('Back to a #section the reader left (OP1-FUN-001)', () => {
  function hubTree(pending: boolean) {
    return (
      <StrictMode>
        <BrowserRouter>
          <NavigateProbe />
          <RouteScrollManager />
          <Routes>
            <Route path="/analytics" element={<HeldSections pending={pending} />} />
            <Route path="/analytics/:login" element={<p>Channel</p>} />
          </Routes>
        </BrowserRouter>
      </StrictMode>
    )
  }

  async function leaveSectionAt(top: number, layout: { top: number }) {
    // The reader leaves #section-tracked `top` px below the viewport top, then opens a channel.
    layout.top = top
    fireEvent.scroll(window)
    act(() => { navigate('/analytics/xqc') })
    await settleMicrotasks()
    scrollTo.mockClear()
    scrollIntoView.mockClear()
  }

  beforeEach(() => {
    // A cold /analytics#section-tracked: React Router stamps this first entry in history.state.
    window.history.replaceState(null, '', '/analytics#section-tracked')
  })

  it('returns the section to where the reader left it once the reloading page has rendered it', async () => {
    const layout = layoutTarget('section-tracked')
    const view = render(hubTree(false))
    await settleMicrotasks()
    runFrames(120)
    await leaveSectionAt(80, layout)

    // Back renders the loading skeleton: the browser's restored offset is clamped above the section.
    view.rerender(hubTree(true))
    await traverse(-1)
    setScrollY(2045)
    layout.top = 1688
    fireEvent.scroll(window)
    runFrames(30)
    expect(scrollTo).not.toHaveBeenCalled()

    view.rerender(hubTree(false))
    runFrames(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 2045 + 1688 - 80)
    expect(scrollIntoView).not.toHaveBeenCalled()

    // In place, it stays put for the rest of the settle window.
    setScrollY(3653)
    layout.top = 80
    runFrames(120)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(0)
  })

  it('does not move a section the browser already restored to its place', async () => {
    const layout = layoutTarget('section-tracked')
    const view = render(hubTree(false))
    await settleMicrotasks()
    runFrames(120)
    await leaveSectionAt(-240, layout)

    view.rerender(hubTree(false))
    await traverse(-1)
    runFrames(120)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not take the offset the browser restores mid-traversal as the place the reader left', async () => {
    const layout = layoutTarget('section-tracked')
    render(hubTree(false))
    await settleMicrotasks()
    runFrames(120)
    await leaveSectionAt(80, layout)
    await traverse(-1)
    runFrames(120)

    // Forward to the channel: the browser scrolls the hub to the channel's offset before the router commits.
    await traverse(1, () => {
      layout.top = 900
      fireEvent.scroll(window)
    })
    scrollTo.mockClear()

    // Back to the hub: the section returns to 80 px, not to the 900 px seen mid-traversal.
    await traverse(-1, () => {
      setScrollY(500)
      layout.top = 1688
    })
    expect(scrollTo).toHaveBeenCalledWith(0, 500 + 1688 - 80)
  })

  it('does not reopen a <details> the reader closed when Back restores their place', async () => {
    window.history.replaceState(null, '', '/docs#api')
    const layout = layoutTarget('api')
    render(
      <BrowserRouter>
        <NavigateProbe />
        <RouteScrollManager />
        <AppRoutes />
      </BrowserRouter>,
    )
    await settleMicrotasks()
    runFrames(120)
    const details = () => document.getElementById('api')!.closest('details')!
    expect(details().open).toBe(true)

    // The reader closes the Developer reference, scrolls on, and opens Support from the footer.
    act(() => { details().open = false })
    layout.top = -400
    fireEvent.scroll(window)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Footer' })).getByRole('link', { name: 'Support' }))
    expect(await screen.findByRole('heading', { level: 1, name: /support/i })).toBeTruthy()
    scrollTo.mockClear()
    scrollIntoView.mockClear()

    await traverse(-1)
    runFrames(120)
    expect(await screen.findByTestId('docs-page')).toBeTruthy()
    expect(details().open).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

function NativeSections() {
  return (
    <main>
      <nav aria-label="Analytics sections">
        <a href="#section-tracked">Tracked</a>
        <a href="#section-live-rail">Live rail</a>
      </nav>
      <section id="section-tracked">Tracked</section>
      <section id="section-live-rail">Live rail</section>
    </main>
  )
}

describe('a native #link followed again is a new landing, not Back (OP1-FUN-008)', () => {
  function nativeTree() {
    return (
      <StrictMode>
        <BrowserRouter>
          <NavigateProbe />
          <RouteScrollManager />
          <Routes>
            <Route path="/analytics" element={<NativeSections />} />
            <Route path="/analytics/:login" element={<p>Channel</p>} />
          </Routes>
        </BrowserRouter>
      </StrictMode>
    )
  }

  /** #section-tracked sits 6111 px down the page: the window at `y` shows it at 6111 - y. */
  function scrollWindow(layout: { top: number }, y: number) {
    setScrollY(y)
    layout.top = 6111 - y
    fireEvent.scroll(window)
  }

  it('leaves #a, then #b, then #a again to the browser on a page opened without a hash', async () => {
    window.history.replaceState(null, '', '/analytics')
    const layout = layoutTarget('section-tracked')
    render(nativeTree())
    await settleMicrotasks()

    // The browser lands #section-tracked under its margin; the reader scrolls back up to the section links.
    await followNative('#section-tracked', () => scrollWindow(layout, 6031))
    scrollWindow(layout, 0)
    await followNative('#section-live-rail', () => scrollWindow(layout, 800))
    scrollWindow(layout, 0)

    // The second tap lands #section-tracked at its margin again; nothing pulls it back to the top.
    await followNative('#section-tracked', () => scrollWindow(layout, 6031))
    runFrames(120)
    expect(window.location.hash).toBe('#section-tracked')
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('lands a cold #section, then leaves native #other and #section to the browser (N4)', async () => {
    window.history.replaceState(null, '', '/analytics#section-tracked')
    const layout = layoutTarget('section-tracked')
    render(nativeTree())
    await settleMicrotasks()
    runFrames(120)
    expect(scrolledElements()).toEqual([document.getElementById('section-tracked')])
    scrollWindow(layout, 6031)

    // The reader scrolls back to the top, follows another section link, then the first one again.
    scrollWindow(layout, 0)
    await followNative('#section-live-rail', () => scrollWindow(layout, 800))
    scrollWindow(layout, 0)
    await followNative('#section-tracked', () => scrollWindow(layout, 6031))
    runFrames(120)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // Without the Navigation API, Back to a native entry is the browser's alone.
    act(() => { navigate('/analytics/xqc') })
    await settleMicrotasks()
    scrollTo.mockClear()
    await traverse(-1, () => scrollWindow(layout, 500))
    runFrames(120)
    expect(window.location.hash).toBe('#section-tracked')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('tells entries apart by their Navigation API id, so Back to a native entry returns to its place', async () => {
    let entry = 'first-load'
    vi.stubGlobal('navigation', { get currentEntry() { return { id: entry } } })
    const navigator = { createHref: () => '', go: () => {}, push: () => {}, replace: () => {} } as unknown as Navigator
    // React Router keys every native fragment entry 'default'.
    const at = (hash: string, id: string) => {
      entry = id
      return (
        <Router location={{ pathname: '/analytics', search: '', hash, state: null, key: 'default' }} navigationType={NavigationType.Pop} navigator={navigator}>
          <RouteScrollManager />
          <NativeSections />
        </Router>
      )
    }
    const layout = layoutTarget('section-tracked')
    // The browser pops to the entry and scrolls before the router commits it.
    const pop = (y: number) => {
      window.dispatchEvent(new PopStateEvent('popstate'))
      scrollWindow(layout, y)
    }
    const view = render(at('', 'first-load'))
    await settleMicrotasks()
    // Entry n1: the browser lands #section-tracked, and the reader reads on into it.
    pop(6031)
    view.rerender(at('#section-tracked', 'n1'))
    await settleMicrotasks()
    scrollWindow(layout, 6500)
    pop(800)
    view.rerender(at('#section-live-rail', 'n2'))
    await settleMicrotasks()

    // A new tap on the same link is a new entry: the browser has landed it, nothing moves it.
    pop(6031)
    view.rerender(at('#section-tracked', 'n3'))
    await settleMicrotasks()
    runFrames(120)
    expect(scrollTo).not.toHaveBeenCalled()

    // Back through #section-live-rail to n1, where the browser's raw offset misses: the place the reader left it.
    pop(800)
    view.rerender(at('#section-live-rail', 'n2'))
    await settleMicrotasks()
    pop(6200)
    view.rerender(at('#section-tracked', 'n1'))
    await settleMicrotasks()
    expect(scrollTo).toHaveBeenCalledWith(0, 6500)
  })
})

describe('waiting for a held #section landing', () => {
  function heldTree(pending: boolean) {
    return (
      <MemoryRouter initialEntries={['/analytics#section-tracked']}>
        <RouteScrollManager />
        <Routes><Route path="/analytics" element={<HeldSections pending={pending} />} /></Routes>
      </MemoryRouter>
    )
  }

  it('keeps waiting through a slow 30 s first read on a 120 Hz screen', async () => {
    const view = render(heldTree(true))
    await settleMicrotasks()
    // 3600 frames: far more than a fixed frame budget allows.
    runFramesFor(30_000)
    expect(scrollIntoView).not.toHaveBeenCalled()

    view.rerender(heldTree(false))
    runFramesFor(20)
    expect(scrolledElements()).toEqual([document.getElementById('section-tracked')])
  })

  it('gives up about 35 s into a hold that is never released', async () => {
    const view = render(heldTree(true))
    await settleMicrotasks()
    runFramesFor(34_000, 1000 / 60)
    expect(frames).toHaveLength(1)
    runFramesFor(1_500, 1000 / 60)
    expect(frames).toHaveLength(0)

    view.rerender(heldTree(false))
    runFramesFor(100)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('gives up about 15 s after a target that never renders when no page holds it', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/explore#analytics-main']}>
        <RouteScrollManager />
        <Routes><Route path="/analytics/explore" element={<LateTarget />} /></Routes>
      </MemoryRouter>,
    )
    await settleMicrotasks()
    runFramesFor(14_000)
    expect(frames).toHaveLength(1)
    runFramesFor(1_500)
    expect(frames).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    runFramesFor(100)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not count the time a background tab draws no frames', async () => {
    const view = render(heldTree(true))
    await settleMicrotasks()
    runFramesFor(100)
    // The link opened in a background tab; the reader shows it a minute later.
    runFramesFor(60_000, 60_000)
    view.rerender(heldTree(false))
    runFramesFor(20)
    expect(scrolledElements()).toEqual([document.getElementById('section-tracked')])
  })

  it('still stops a held landing on reader input', async () => {
    const view = render(heldTree(true))
    await settleMicrotasks()
    runFramesFor(2_000)
    fireEvent.wheel(window)
    view.rerender(heldTree(false))
    runFramesFor(100)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

function SessionRedirect() {
  const go = useNavigate()
  // Like the channel console when a live route resolves to its session.
  return <button type="button" onClick={() => go('/analytics/xqc/stream-1', { replace: true })}>Resolve</button>
}

describe('replaced pages (path-changing REPLACE)', () => {
  it("keeps the reader's place when a page replaces its own path", async () => {
    render(
      <MemoryRouter initialEntries={['/support', '/analytics/xqc']} initialIndex={1}>
        <RouteScrollManager />
        <Routes>
          <Route path="/analytics/:login" element={<SessionRedirect />} />
          <Route path="/analytics/:login/:streamId" element={<p>Session</p>} />
        </Routes>
      </MemoryRouter>,
    )
    await settleMicrotasks()
    setScrollY(1200)
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(await screen.findByText('Session')).toBeTruthy()
    await settleMicrotasks()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('lands a replaced page on the #target it names', async () => {
    renderApp('/support')
    await settleMicrotasks()
    act(() => { navigate('/docs#coverage', { replace: true }) })
    await settleMicrotasks()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrolledElements()).toEqual([document.getElementById('coverage')])
  })

  it('opens the hub at the top when Back reaches a gated page without its key', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard', '/support']} initialIndex={1}>
        <NavigateProbe />
        <RouteScrollManager />
        <Routes>
          <Route path="/support" element={<p>Support</p>} />
          <Route path="/analytics" element={<p>Hub</p>} />
          <Route element={<RequireAuth />}><Route path="/dashboard" element={<Outlet />} /></Route>
        </Routes>
      </MemoryRouter>,
    )
    await settleMicrotasks()
    // The browser restores the dashboard's offset, then the gate redirects.
    setScrollY(1500)
    act(() => { navigate(-1) })
    expect(await screen.findByText('Hub')).toBeTruthy()
    await settleMicrotasks()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('sends the sign-out redirect to the top of the hub', () => {
    const main = readFileSync(resolve(import.meta.dirname, '../src/main.tsx'), 'utf8')
    expect(main).toContain("navigate('/analytics', { replace: true, state: routeScrollState('top') })")
  })
})
