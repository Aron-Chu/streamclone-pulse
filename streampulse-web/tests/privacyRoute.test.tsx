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
    expect(screen.getByText(/sp\.hub\.recentLogins/i)).toBeTruthy()
    expect(screen.getByText(/sp:publicHub:v1/i)).toBeTruthy()
    expect(screen.getByText(/sp\.betaKey/i)).toBeTruthy()
    expect(screen.getByText(/sp\.backendUrlOverride/i)).toBeTruthy()
  })

  it('explains Twitch page-context use without claiming cookie extraction', async () => {
    renderPath('/privacy')
    const body = (await screen.findByTestId('privacy-policy')).textContent ?? ''
    expect(body).toMatch(/does not request or transmit Twitch cookies/i)
    expect(body).toMatch(/active Twitch browser session/i)
    expect(body).toMatch(/does not receive your Twitch cookies/i)
    expect(body).toMatch(/beta access key is sent only to the hosted enrollment endpoint/i)
    expect(body).toMatch(/discarded after that request/i)
    expect(body).toMatch(/device token stored locally/i)
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
    const contact = await screen.findByTestId('privacy-contact')
    expect(contact.querySelector('a[href="mailto:privacy@streampulse.stream"]')).toBeTruthy()
    expect(contact.textContent).toMatch(/privacy@streampulse\.stream/i)
    expect(screen.getByRole('link', { name: /support page/i }).getAttribute('href')).toBe('/support')
  })

  it('exposes Privacy and Support links from the public layout', async () => {
    renderPath('/privacy')
    expect((await screen.findByRole('link', { name: /^privacy$/i })).getAttribute('href')).toBe('/privacy')
    expect(screen.getByRole('link', { name: /^support$/i }).getAttribute('href')).toBe('/support')
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
