import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/sentry', () => ({ Sentry: {}, sanitizePortalPath: (path: string) => path }))
import { isModuleLoadError, PortalErrorBoundary } from '../src/ui/PortalErrorBoundary'

describe('portal page-load recovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: http://127.0.0.1:5173/src/page.tsx',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
    'error loading dynamically imported module',
  ])('recognizes a module-load failure: %s', message => {
    expect(isModuleLoadError(new TypeError(message))).toBe(true)
    expect(PortalErrorBoundary.getDerivedStateFromError(new Error(message))).toEqual({ hasError: true, moduleLoadFailed: true })
  })
  it('does not mislabel component bugs as asset failures', () => {
    expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isModuleLoadError(null)).toBe(false)
  })
})
