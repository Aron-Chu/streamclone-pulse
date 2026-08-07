import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AnalyticsTopNav, type AnalyticsTopNavItem } from '../src/ui/components/analytics/AnalyticsTopNav'

const navItems: AnalyticsTopNavItem[] = [
  { label: 'Home', to: '/analytics', end: true },
  { label: 'Streams', to: '/analytics/streams' },
]

describe('AnalyticsTopNav', () => {
  it('renders accessible navigation, active state, status, and skip link', () => {
    render(
      <MemoryRouter initialEntries={['/analytics/streams']}>
        <AnalyticsTopNav
          items={navItems}
          status={{ label: 'Data status', value: 'Ready', tone: 'ready', detail: 'Analytics backend is reachable' }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('StreamPulse home').getAttribute('href')).toBe('/')
    expect(screen.getByRole('navigation', { name: 'Analytics navigation' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Skip to analytics content' }).getAttribute('href')).toBe('#analytics-main')
    expect(screen.getByRole('link', { name: 'Streams' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByLabelText('Data status: Ready - Analytics backend is reachable')).toBeTruthy()
  })

  it('supports non-ready status tones without changing navigation semantics', () => {
    render(
      <MemoryRouter>
        <AnalyticsTopNav
          items={navItems}
          status={{ label: 'Data status', value: 'Offline', tone: 'offline', detail: 'Analytics backend is unreachable' }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: 'Analytics navigation' })).toBeTruthy()
    expect(screen.getByLabelText('Data status: Offline - Analytics backend is unreachable')).toBeTruthy()
  })

  it('omits empty navigation without losing the brand link', () => {
    render(
      <MemoryRouter>
        <AnalyticsTopNav items={[]} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('navigation', { name: 'Analytics navigation' })).toBeNull()
    expect(screen.getByLabelText('StreamPulse home')).toBeTruthy()
  })
})