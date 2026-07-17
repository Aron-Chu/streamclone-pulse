import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '../src/routes/index'

function LocationProbe() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

function renderPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('privacy route', () => {
  it('renders a real privacy policy on direct /privacy navigation', async () => {
    renderPath('/privacy')
    expect(await screen.findByTestId('privacy-policy')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeTruthy()
    expect(screen.getByTestId('pathname').textContent).toBe('/privacy')
    expect(screen.queryByRole('heading', { name: /operator console/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: /^docs$/i })).toBeNull()
    expect(screen.getByText(/chrome\.storage\.local/i)).toBeTruthy()
  })

  it('explains Twitch browser-session credentials without claiming cookie extraction', async () => {
    renderPath('/privacy')
    const session = await screen.findByTestId('privacy-twitch-session')
    expect(session.textContent).toMatch(/does not directly access or extract Twitch cookie values/i)
    expect(session.textContent).toMatch(/active Twitch browser session/i)
    expect(session.textContent).toMatch(/does not receive your Twitch cookies/i)
    expect(screen.queryByText(/does not read Twitch cookies/i)).toBeNull()
  })

  it('avoids internal release-blocker / counsel commentary', async () => {
    renderPath('/privacy')
    await screen.findByTestId('privacy-policy')
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/open release decision/i)
    expect(body).not.toMatch(/paid public signup/i)
    expect(body).not.toMatch(/counsel-required/i)
    expect(body).not.toMatch(/Chrome Web Store submission remains blocked/i)
  })

  it('exposes a real public support/contact link', async () => {
    renderPath('/privacy')
    const link = await screen.findByTestId('privacy-contact-link')
    expect(link.getAttribute('href')).toBe('https://github.com/Aron-Chu/streamclone-pulse/issues')
    expect(screen.getByTestId('privacy-contact').textContent).toMatch(/privacy or support/i)
  })

  it('exposes a Privacy link from the public layout used by /privacy', async () => {
    renderPath('/privacy')
    const link = await screen.findByRole('link', { name: /^privacy$/i })
    expect(link.getAttribute('href')).toBe('/privacy')
  })
})

describe('admin and unknown routes', () => {
  it('does not present /admin as an operator console', async () => {
    renderPath('/admin')
    expect(await screen.findByTestId('not-found')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /operator console/i })).toBeNull()
    expect(screen.getByTestId('pathname').textContent).toBe('/admin')
  })

  it('renders not-found for unknown paths without redirecting to /', async () => {
    renderPath('/this-route-does-not-exist')
    expect(await screen.findByTestId('not-found')).toBeTruthy()
    expect(screen.getByTestId('pathname').textContent).toBe('/this-route-does-not-exist')
  })
})
