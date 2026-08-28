import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import Docs from '../src/routes/public/Docs'
import NotFound from '../src/routes/public/NotFound'
import Privacy from '../src/routes/public/Privacy'
import Support from '../src/routes/public/Support'

function renderRoute(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('public release routes', () => {
  it('provides a real extension install target from the homepage CTA', () => {
    renderRoute(<Docs />)
    const heading = screen.getByRole('heading', { name: /install the streampulse extension/i })
    expect(heading.id).toBe('extension-title')
    expect(heading.closest('section')?.id).toBe('extension')
    expect(screen.getByRole('link', { name: /streampulse support/i }).getAttribute('href')).toBe('/support')
  })

  it('publishes a dedicated privacy policy with a contact path', () => {
    renderRoute(<Privacy />)
    expect(screen.getByRole('heading', { name: /^privacy policy$/i })).toBeTruthy()
    expect(screen.getByTestId('privacy-contact').querySelector('a[href="mailto:privacy@streampulse.stream"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: /support page/i }).getAttribute('href')).toBe('/support')
    const body = screen.getByTestId('privacy-policy').textContent ?? ''
    expect(body).toMatch(/beta access key is sent only to the hosted enrollment endpoint/i)
    expect(body).toMatch(/device token stored locally/i)
    expect(body).toMatch(/not sold, used for advertising, or used for unrelated profiling/i)
    expect(body).toMatch(/does not download or evaluate remotely hosted JavaScript or WebAssembly/i)
    expect(body).toMatch(/planned optional extension crash diagnostics are/i)
    expect(body).toMatch(/off by default/i)
    expect(body).toMatch(/Share crash diagnostics/i)
    expect(body).toMatch(/Hosted diagnostics upload is not active/i)
    expect(body).toMatch(/Website error monitoring \(portal only\)/i)
    expect(body).not.toMatch(/support@streampulse\.stream/i)
    expect(body).not.toMatch(/security@streampulse\.stream/i)
  })

  it('publishes actionable extension and analytics support guidance', () => {
    renderRoute(<Support />)
    expect(screen.getByRole('heading', { name: /support & troubleshooting/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /service status/i }).getAttribute('href')).toBe('/status')
    expect(screen.getByRole('link', { name: /extension setup guide/i }).getAttribute('href')).toBe('/docs#extension')
    expect(
      screen.getByTestId('support-page').querySelector('a[href="mailto:privacy@streampulse.stream"]'),
    ).toBeTruthy()
    const body = screen.getByTestId('support-page').textContent ?? ''
    expect(body).toMatch(/privacy or legal/i)
    expect(body).toMatch(/not a routine product-support mailbox/i)
    expect(body).toMatch(/unavailable/i)
    expect(screen.queryByTestId('support-form')).toBeNull()
    expect(body).not.toMatch(/Turnstile/i)
    expect(body).not.toMatch(/support@streampulse\.stream/i)
    expect(body).not.toMatch(/security@streampulse\.stream/i)
  })

  it('renders a useful 404 instead of silently redirecting', () => {
    renderRoute(<NotFound />)
    const page = screen.getByTestId('not-found')
    expect(within(page).getByRole('heading', { name: /page not found/i })).toBeTruthy()
    expect(within(page).getByRole('link', { name: /open analytics/i }).getAttribute('href')).toBe('/analytics')
  })
})
