import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SITE_NAV_ITEMS } from '../src/lib/siteNav'
import { SiteHeader, SiteHeaderStepBack, siteNavCurrent } from '../src/ui/components/SiteHeader'

function renderAt(path: string, props: { variant?: 'analytics' | 'public'; install?: ReactNode } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteHeader mainId="analytics-main" variant={props.variant ?? 'analytics'} install={props.install} />
    </MemoryRouter>,
  )
}

const current = (path: string) => SITE_NAV_ITEMS.map((item) => [item.label, siteNavCurrent(item, path) ?? null])

describe('SiteHeader (one bar on every page, 11-24)', () => {
  it('names the site, sends it home, skips to the page and lists Hub, Moments and Help', () => {
    renderAt('/analytics/moments')
    expect(screen.getByRole('link', { name: 'StreamPulse' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#analytics-main')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Hub', '/analytics'],
      ['Moments', '/analytics/moments'],
      ['Help', '/help'],
    ])
    expect(within(nav).getByRole('link', { name: 'Moments' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Hub' }).getAttribute('aria-current')).toBeNull()
    // No second name line, no wide-screen menu of links.
    expect(screen.queryByText('Analytics Hub')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Navigation menu' })).toBeNull()
  })

  it('keeps Hub lit on channel pages, and Moments on a moment, but not on the front page', () => {
    expect(current('/analytics')).toEqual([['Hub', 'page'], ['Moments', null], ['Help', null]])
    expect(current('/analytics/')).toEqual([['Hub', 'page'], ['Moments', null], ['Help', null]])
    expect(current('/analytics/channel/some-streamer')).toEqual([['Hub', 'true'], ['Moments', null], ['Help', null]])
    expect(current('/analytics/moments/abc')).toEqual([['Hub', null], ['Moments', 'true'], ['Help', null]])
    expect(current('/help')).toEqual([['Hub', null], ['Moments', null], ['Help', 'page']])
    expect(current('/')).toEqual([['Hub', null], ['Moments', null], ['Help', null]])
    expect(current('/analyticsx')).toEqual([['Hub', null], ['Moments', null], ['Help', null]])
  })

  it('carries a short Add to Chrome, tagged for the page it is on', () => {
    const view = renderAt('/analytics')
    const install = within(screen.getByRole('banner')).getByRole('link', { name: 'Add to Chrome' })
    expect(install.getAttribute('data-cta')).toBe('chrome-install-analytics')
    expect(install.closest('.site-header__actions')).toBeTruthy()
    view.unmount()
    renderAt('/help', { variant: 'public' })
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Add to Chrome' }).getAttribute('data-cta'))
      .toBe('chrome-install-public-nav')
  })

  it('lets a page put its own buttons in place of the install', () => {
    renderAt('/', { variant: 'public', install: <a href="#own">Own button</a> })
    const banner = screen.getByRole('banner')
    expect(within(banner).queryByRole('link', { name: 'Add to Chrome' })).toBeNull()
    expect(within(banner).getByRole('link', { name: 'Own button' }).closest('.site-header__actions')).toBeTruthy()
  })

  it('steps buttons back without moving them: hidden, and out of the tab order', () => {
    const { rerender } = render(<SiteHeaderStepBack hidden><a href="#a">Add to Chrome</a></SiteHeaderStepBack>)
    const step = document.querySelector<HTMLElement>('.site-header__step')!
    expect(step.hasAttribute('data-hidden')).toBe(true)
    expect(step.inert).toBe(true)
    rerender(<SiteHeaderStepBack hidden={false}><a href="#a">Add to Chrome</a></SiteHeaderStepBack>)
    expect(step.hasAttribute('data-hidden')).toBe(false)
    expect(step.inert).toBe(false)
  })

  it('opens the phone menu as a drawer with the pages, then the site information', () => {
    renderAt('/analytics/channel/some-streamer')
    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(menu)
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    const drawer = screen.getByRole('dialog', { name: 'StreamPulse' })
    expect(drawer.id).toBe(menu.getAttribute('aria-controls'))
    const pages = within(drawer).getByRole('navigation', { name: 'Pages' })
    expect(within(pages).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/analytics', '/analytics/moments', '/help'])
    expect(within(pages).getByRole('link', { name: 'Hub' }).getAttribute('aria-current')).toBe('true')
    const more = within(drawer).getByRole('navigation', { name: 'Site information' })
    expect(within(more).getAllByRole('link').map((a) => a.textContent)).toEqual(['Status', 'Changelog', 'Privacy', 'Terms'])
    // Focus goes into the drawer, on its first stop (Close, in its head).
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Close menu' }))
  })

  it('closes the drawer with Escape or Close, handing focus back to Menu, and with a page link', () => {
    renderAt('/analytics')
    const menu = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(menu)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(menu)

    fireEvent.click(menu)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(menu)

    fireEvent.click(menu)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Site information' })).getByRole('link', { name: 'Status' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps Tab inside the open drawer', () => {
    renderAt('/analytics')
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const drawer = screen.getByRole('dialog')
    const stops = [...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
    stops.at(-1)!.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(stops[0])
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(stops.at(-1))
  })
})
