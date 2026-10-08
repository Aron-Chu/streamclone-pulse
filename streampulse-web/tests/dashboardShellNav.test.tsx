import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import DashboardShell from '../src/routes/dashboard/DashboardShell'

function renderDashboard(path = '/dashboard/clips') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard" element={<DashboardShell />}>
          <Route index element={<p>Dashboard home</p>} />
          <Route path="clips" element={<p>Dashboard clips</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('dashboard header navigation at narrow widths (OP1-FUN-005)', () => {
  it('offers the same Menu disclosure as the public header for Home, Clips and Analytics', () => {
    renderDashboard()
    const trigger = screen.getByRole('button', { name: 'Menu' })
    expect(trigger.className).toBe('app-nav__menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    const navigation = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
    expect(navigation?.tagName).toBe('NAV')
    expect(navigation?.classList.contains('app-nav__links')).toBe(true)
    expect(navigation?.classList.contains('is-open')).toBe(false)
    const links = within(navigation!).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])
    expect(links).toEqual([['Home', '/dashboard'], ['Clips', '/dashboard/clips'], ['Analytics', '/analytics']])

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.textContent).toBe('Close menu')
    expect(navigation?.classList.contains('is-open')).toBe(true)
  })

  it('closes on Escape and returns focus to the trigger', () => {
    renderDashboard()
    const trigger = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(trigger)
    screen.getByRole('link', { name: 'Home' }).focus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('closes after a link is chosen and keeps focus on the visible trigger', () => {
    renderDashboard()
    const trigger = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(trigger)

    fireEvent.click(screen.getByRole('link', { name: 'Home' }))
    expect(screen.getByText('Dashboard home')).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById('dashboard-navigation')?.classList.contains('is-open')).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('relies on the shared <=960 px rule that hides closed links and shows the trigger', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../src/ui/global.css'), 'utf8')
    const narrow = css.slice(css.indexOf('@media (max-width: 960px)'))
    expect(narrow).toMatch(/\.app-nav__menu \{\s*display: inline-flex;/)
    expect(narrow).toMatch(/\.app-nav__links \{ display: none;/)
    expect(narrow).toMatch(/\.app-nav__links\.is-open \{ display: flex; \}/)
  })
})
