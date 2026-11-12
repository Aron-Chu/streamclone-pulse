import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AnalyticsTopNav, type AnalyticsTopNavItem } from '../src/ui/components/analytics/AnalyticsTopNav'

const navItems: AnalyticsTopNavItem[] = [
  { label: 'Home', to: '/analytics', end: true },
  { label: 'Streams', to: '/analytics/streams' },
]

describe('AnalyticsTopNav', () => {
  it('renders accessible navigation, active state, and skip link', () => {
    render(
      <MemoryRouter initialEntries={['/analytics/streams']}>
        <AnalyticsTopNav items={navItems} />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('StreamPulse analytics home').getAttribute('href')).toBe('/analytics')
    expect(screen.getByRole('navigation', { name: 'Analytics navigation' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Skip to analytics content' }).getAttribute('href')).toBe('#analytics-main')
    expect(screen.getByRole('link', { name: 'Streams' }).getAttribute('aria-current')).toBe('page')
  })

  it('keeps service status in the menu rather than a header pill', () => {
    render(
      <MemoryRouter>
        <AnalyticsTopNav items={navItems} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Support and account' }))
    expect(screen.getByRole('link', { name: 'Service status' }).getAttribute('href')).toBe('/status')
  })

  it('omits empty navigation without losing the brand link', () => {
    render(
      <MemoryRouter>
        <AnalyticsTopNav items={[]} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('navigation', { name: 'Analytics navigation' })).toBeNull()
    expect(screen.getByLabelText('StreamPulse analytics home')).toBeTruthy()
  })

  it('opens, dismisses on outside click, and restores focus on Escape', () => {
    render(
      <MemoryRouter>
        <AnalyticsTopNav items={navItems} />
      </MemoryRouter>,
    )

    const trigger = screen.getByRole('button', { name: 'Support and account' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByRole('link', { name: 'Extension guide' }).parentElement
    expect(panel?.getAttribute('data-state')).toBe('open')

    fireEvent.keyDown(screen.getByRole('link', { name: 'Support' }), { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})
