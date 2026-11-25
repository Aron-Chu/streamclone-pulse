import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/sentry', () => ({ reportPortalError: () => {} }))
import { isModuleLoadError, PortalErrorBoundary } from '../src/ui/PortalErrorBoundary'

describe('portal page-load recovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: http://127.0.0.1:5173/src/page.tsx',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
    'error loading dynamically imported module',
    // A tab open across a deploy: the old page's CSS is gone (Pages answers 404 text/html).
    'Unable to preload CSS for /assets/AnalyticsMomentsPage-DSHyL4nX.css',
  ])('recognizes a module-load failure: %s', message => {
    expect(isModuleLoadError(new TypeError(message))).toBe(true)
    expect(PortalErrorBoundary.getDerivedStateFromError(new Error(message))).toEqual({ hasError: true, moduleLoadFailed: true })
  })
  it('does not mislabel component bugs as asset failures', () => {
    expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isModuleLoadError(null)).toBe(false)
  })
})

describe('crash panel', () => {
  it('links to Status with a plain link, since the router may be what crashed', () => {
    const panel = new PortalErrorBoundary({ children: null })
    panel.state = { hasError: true, moduleLoadFailed: false }
    render(<>{panel.render()}</>)
    const link = screen.getByRole('link', { name: 'Status' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/status')
    // Underlined like other links in running text: colour alone is not a cue (WCAG 1.4.1).
    expect(link.classList.contains('public-inline-link')).toBe(true)
    expect(link.closest('p')?.textContent).toBe('Reload the page. If it keeps happening, check Status.')
  })

  it('sizes the panel with a shared class, not an inline style', () => {
    const panel = new PortalErrorBoundary({ children: null })
    panel.state = { hasError: true, moduleLoadFailed: false }
    const { container } = render(<>{panel.render()}</>)
    const box = container.querySelector('.panel')!
    expect(box.getAttribute('style')).toBeNull()
    expect(box.classList.contains('panel--centered')).toBe(true)
  })
})
