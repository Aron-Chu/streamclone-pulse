/**
 * OP1-RES-007 / OP1-RES-006: a page that throws keeps its own header and nav
 * (site, analytics or dashboard), following a nav link recovers, each crash
 * is reported once, and "Reload page" drops cached hub snapshots so the
 * reload refetches instead of re-hydrating the crash.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('../src/lib/sentry', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/sentry')>(),
  Sentry: {
    withScope: (report: (scope: { setTag: () => void }) => void) => report({ setTag: () => {} }),
    captureException: sentry.captureException,
  },
  sanitizePortalPath: (path: string) => path,
}))
vi.mock('../src/routes/public/Status', () => ({
  default: () => { throw new TypeError('e?.trim is not a function') },
}))
const landingFailure = vi.hoisted(() => ({ message: 'e.login.toLowerCase is not a function' }))
vi.mock('../src/routes/analytics/AnalyticsLandingPage', () => ({
  default: () => { throw new TypeError(landingFailure.message) },
}))
vi.mock('../src/routes/analytics/AnalyticsMomentsPage', async () => {
  const { createElement, useState } = await import('react')
  const { AnalyticsFigmaShell } = await import('../src/ui/components/analytics/AnalyticsFigmaShell')
  function Body() {
    const [broken, setBroken] = useState(false)
    if (broken) throw new TypeError('moment.label is an object')
    return createElement('button', { type: 'button', onClick: () => setBroken(true) }, 'Show moments')
  }
  return { default: () => createElement(AnalyticsFigmaShell, { hideSidebar: true, children: createElement(Body) }) }
})
vi.mock('../src/routes/public/Support', async () => {
  const { createElement, useState } = await import('react')
  const { PublicLayout } = await import('../src/ui/components/PublicLayout')
  function Body() {
    const [broken, setBroken] = useState(false)
    if (broken) throw new TypeError('incident.title is an object')
    return createElement('button', { type: 'button', onClick: () => setBroken(true) }, 'Show support')
  }
  return { default: () => createElement(PublicLayout, null, createElement(Body)) }
})
vi.mock('../src/routes/dashboard/Clips', () => ({
  default: () => { throw new TypeError('candidate.topEmotes.slice(...).map is not a function') },
}))

import { AppRoutes } from '../src/routes/index'
import { PortalErrorBoundary, reloadAfterPortalError } from '../src/ui/PortalErrorBoundary'

const HUB_KEY = 'sp:publicHub:v1:https://api.streampulse.stream:24h'
const PROJECTION_KEY = 'sp:publicHubProjection:v1:https://api.streampulse.stream:30m:moments'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

/** Only the site layout has these; nav labels are shared with other shells. */
function expectNoSiteLayout(container: HTMLElement) {
  expect(container.querySelector('#public-main')).toBeNull()
  expect(container.querySelector('.app-footer')).toBeNull()
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sentry.captureException.mockClear()
  landingFailure.message = 'e.login.toLowerCase is not a function'
})
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('route-level error boundary', () => {
  it('keeps the site header and nav around the error, and a nav link recovers', async () => {
    renderAt('/status')

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Main Navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: 'Docs' }))
    expect(await screen.findByRole('heading', { name: 'Get started with Pulse' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull()
  })

  it('keeps the analytics top navigation when an analytics page throws, and its links recover', async () => {
    const { container } = renderAt('/analytics')

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Analytics navigation' })).toBeTruthy()
    expectNoSiteLayout(container)

    fireEvent.click(screen.getByRole('link', { name: 'All moments' }))
    expect(await screen.findByRole('button', { name: 'Show moments' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull()
  })

  it('keeps the mounted analytics header when content inside it throws', async () => {
    const { container } = renderAt('/analytics/moments')
    const show = await screen.findByRole('button', { name: 'Show moments' })
    const header = container.querySelector('.analytics-topnav')
    fireEvent.click(show)

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(header).toBeTruthy()
    expect(container.querySelector('.analytics-topnav')).toBe(header)
    expect(container.querySelector('#analytics-main')?.textContent).toContain('Something went wrong')
  })

  it('recovers when a nav link changes only the query, as All moments does from History', async () => {
    renderAt('/analytics/moments?view=history')
    fireEvent.click(await screen.findByRole('button', { name: 'Show moments' }))
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: 'All moments' }))
    expect(await screen.findByRole('button', { name: 'Show moments' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull()
  })

  it('keeps the mounted site header when content inside it throws', async () => {
    const { container } = renderAt('/support')
    const show = await screen.findByRole('button', { name: 'Show support' })
    const header = container.querySelector('.app-nav')
    fireEvent.click(show)

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(header).toBeTruthy()
    expect(container.querySelector('.app-nav')).toBe(header)
    expect(container.querySelector('#public-main')?.textContent).toContain('Something went wrong')
  })

  it('keeps the dashboard header when a dashboard page throws, and its nav recovers', async () => {
    localStorage.setItem('sp.betaKey', 'test-beta-key')
    const { container } = renderAt('/dashboard/clips')

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'StreamPulse Dashboard' })).toBeTruthy()
    expectNoSiteLayout(container)
    const header = container.querySelector('.app-nav')

    fireEvent.click(screen.getByRole('link', { name: 'Home' }))
    expect(await screen.findByRole('heading', { name: 'StreamPulse workspace' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull()
    expect(container.querySelector('.app-nav')).toBe(header)
  })

  it('uses the site header when an analytics module fails to load', async () => {
    landingFailure.message = 'Failed to fetch dynamically imported module: /assets/AnalyticsLandingPage.js'
    renderAt('/analytics')

    expect(await screen.findByRole('heading', { name: 'This page could not load' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Main Navigation' })).toBeTruthy()
  })

  it('clears cached hub snapshots from the error panel before reloading', async () => {
    renderAt('/status')
    const reload = await screen.findByRole('button', { name: 'Reload page' })
    localStorage.setItem(HUB_KEY, '{"poisoned":true}')
    localStorage.setItem(PROJECTION_KEY, '{"poisoned":true}')
    localStorage.setItem('sp:savedMoments:v1', '[]')

    fireEvent.click(reload)
    expect(localStorage.getItem(HUB_KEY)).toBeNull()
    expect(localStorage.getItem(PROJECTION_KEY)).toBeNull()
    expect(localStorage.getItem('sp:savedMoments:v1')).toBe('[]')
  })

  it('reloads only after the hub cache is gone', () => {
    localStorage.setItem(HUB_KEY, '{"poisoned":true}')
    const reload = vi.fn(() => expect(localStorage.getItem(HUB_KEY)).toBeNull())
    reloadAfterPortalError(reload)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('error reporting', () => {
  it('reports a page reached by an in-app link once', async () => {
    renderAt('/docs')
    fireEvent.click(await screen.findByRole('link', { name: 'Status' }))

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('reports a crash inside a layout once, and the root boundary stays out of it', async () => {
    localStorage.setItem('sp.betaKey', 'test-beta-key')
    render(
      <PortalErrorBoundary>
        <MemoryRouter initialEntries={['/dashboard/clips']}>
          <AppRoutes />
        </MemoryRouter>
      </PortalErrorBoundary>,
    )

    expect(await screen.findByRole('link', { name: 'StreamPulse Dashboard' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: 'Something went wrong' })).toHaveLength(1)
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('does not report the same error object twice (a lazy page rethrows its cached failure)', () => {
    const failure = new TypeError('Failed to fetch dynamically imported module: /assets/Clips.js')
    const Broken = () => { throw failure }
    const view = render(<PortalErrorBoundary resetKey="/dashboard/clips"><Broken /></PortalErrorBoundary>)
    view.rerender(<PortalErrorBoundary resetKey="/dashboard"><Broken /></PortalErrorBoundary>)

    expect(screen.getByRole('heading', { name: 'This page could not load' })).toBeTruthy()
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
    expect(sentry.captureException).toHaveBeenCalledWith(failure)
  })
})

describe('bundle shape', () => {
  it('keeps the hub parser out of the error boundary that every layout loads', () => {
    // Through publicHubCache the boundary pulled the hub parser into a separate
    // chunk that every public page then loaded up front.
    const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
    expect(source('src/ui/PortalErrorBoundary.tsx')).not.toMatch(/from '\.\.\/lib\/publicHubCache'/)
    expect(source('src/lib/publicHubCacheReset.ts')).not.toMatch(/^\s*import\b/m)
  })
})
