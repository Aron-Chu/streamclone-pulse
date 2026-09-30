import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsPreferences } from '../src/ui/components/AnalyticsPreferences'
import Privacy from '../src/routes/public/Privacy'

const analytics = vi.hoisted(() => ({
  preference: 'unset' as 'allowed' | 'declined' | 'unset',
  blocked: false,
  configured: true,
  subscribers: new Set<() => void>(),
  setPreference: vi.fn(),
}))

vi.mock('../src/lib/productAnalytics', () => ({
  getAnalyticsPreference: () => analytics.preference,
  setAnalyticsPreference: (preference: 'allowed' | 'declined') => {
    analytics.setPreference(preference)
    analytics.preference = preference
    analytics.subscribers.forEach(subscriber => subscriber())
  },
  subscribeAnalyticsPreference: (subscriber: () => void) => {
    analytics.subscribers.add(subscriber)
    return () => { analytics.subscribers.delete(subscriber) }
  },
  analyticsBlockedByBrowser: () => analytics.blocked,
  analyticsConfigured: () => analytics.configured,
}))

beforeEach(() => {
  cleanup()
  analytics.preference = 'unset'
  analytics.blocked = false
  analytics.configured = true
  analytics.subscribers.clear()
  analytics.setPreference.mockClear()
})

describe('voluntary public website analytics preferences', () => {
  it('starts off with an unforced, closed disclosure and collects no consent on render', () => {
    render(<AnalyticsPreferences />)
    const disclosure = screen.getByText('Analytics preferences').closest('details')!
    expect(disclosure.open).toBe(false)
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('Anonymous website analytics are off.')
    expect(analytics.setPreference).not.toHaveBeenCalled()
  })

  it('lets a visitor explicitly opt in, then withdraw without navigating away', () => {
    render(<AnalyticsPreferences />)
    fireEvent.click(screen.getByText('Analytics preferences'))
    fireEvent.click(screen.getByRole('button', { name: 'Allow anonymous analytics' }))
    expect(analytics.setPreference).toHaveBeenCalledWith('allowed')
    expect(screen.getByRole('status').textContent).toContain('analytics are on')
    expect(screen.getByRole('button', { name: 'Allow anonymous analytics' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Turn analytics off' }))
    expect(analytics.setPreference).toHaveBeenLastCalledWith('declined')
    expect(screen.getByRole('status').textContent).toBe('Anonymous website analytics are off.')
  })

  it('honors a browser privacy signal even when an old saved choice allowed analytics', () => {
    analytics.preference = 'allowed'
    analytics.blocked = true
    render(<AnalyticsPreferences />)
    fireEvent.click(screen.getByText('Analytics preferences'))
    const allow = screen.getByRole('button', { name: 'Allow anonymous analytics' })
    expect(allow.hasAttribute('disabled')).toBe(true)
    fireEvent.click(allow)
    expect(analytics.setPreference).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('your browser asks websites not to track')
    fireEvent.click(screen.getByRole('button', { name: 'Keep analytics off' }))
    expect(analytics.setPreference).toHaveBeenCalledWith('declined')
  })

  it('explains that analytics are unavailable and cannot be enabled in an unconfigured build', () => {
    analytics.configured = false
    render(<AnalyticsPreferences />)
    fireEvent.click(screen.getByText('Analytics preferences'))
    const allow = screen.getByRole('button', { name: 'Allow anonymous analytics' })
    expect(allow.hasAttribute('disabled')).toBe(true)
    fireEvent.click(allow)
    expect(analytics.setPreference).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('currently unavailable and off')
  })

  it('reflects preference changes elsewhere and releases its subscription on unmount', () => {
    const { unmount } = render(<AnalyticsPreferences />)
    fireEvent.click(screen.getByText('Analytics preferences'))
    act(() => {
      analytics.preference = 'allowed'
      analytics.subscribers.forEach(subscriber => subscriber())
    })
    expect(screen.getByRole('status').textContent).toContain('analytics are on')
    unmount()
    expect(analytics.subscribers.size).toBe(0)
  })

  it('closes on Escape and returns keyboard focus to the disclosure control', () => {
    render(<AnalyticsPreferences />)
    const summary = screen.getByText('Analytics preferences')
    fireEvent.click(summary)
    const off = screen.getByRole('button', { name: 'Keep analytics off' })
    off.focus()
    fireEvent.keyDown(off, { key: 'Escape' })
    expect(summary.closest('details')!.open).toBe(false)
    expect(document.activeElement).toBe(summary)
    expect(analytics.setPreference).not.toHaveBeenCalled()
  })
})

describe('website analytics privacy disclosure', () => {
  it('discloses voluntary US processing, event limits, withdrawal limits and separate extension plans', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const policy = screen.getByTestId('privacy-policy').textContent ?? ''
    expect(policy).toContain('Last updated: September 29, 2026')
    expect(policy).toContain('Optional website analytics')
    expect(policy).toContain('off by default')
    expect(policy).toContain('United States region')
    expect(policy).toContain('your IP address is visible during transmission')
    expect(policy).toContain('not to retain the IP address or collect GeoIP')
    expect(policy).toContain('cannot recall events already transmitted')
    expect(policy).toContain('does not promise a fixed retention period')
    expect(policy).toContain('Account pages, dashboard activity and individual channel or stream pages are excluded')
    expect(policy).toContain('Product-analytics ingest is not active. The extension does not embed a Sentry or PostHog SDK')
    expect(policy).not.toContain('nothing optional to consent to')
    expect(screen.getByText('Analytics preferences', { selector: 'summary' })).toBeTruthy()
  })
})
