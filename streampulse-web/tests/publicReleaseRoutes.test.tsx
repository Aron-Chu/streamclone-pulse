import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import Help from '../src/routes/public/Help'
import NotFound from '../src/routes/public/NotFound'
import Privacy from '../src/routes/public/Privacy'
import { supportDiagnostics } from '../src/lib/supportDiagnostics'

function renderRoute(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('public release routes', () => {
  it('documents real portal routes, version meaning and the sections old links open', () => {
    renderRoute(<Help />)
    expect(screen.getByText('GET https://api.streampulse.stream/v1/portal/analytics/streams/:streamId')).toBeTruthy()
    expect(screen.getByText(/version in a store listing is the extension/)).toBeTruthy()
    // The sections /docs, /support, /feedback and their old anchors open (src/routes/index.tsx).
    for (const id of ['install', 'hub', 'coverage', 'api', 'fix', 'billing-email', 'ask', 'contact', 'security', 'feedback']) expect(document.getElementById(id), id).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/public API.*coming soon/i)
  })

  it('lists the page sections in reading order, matching the table of contents', () => {
    renderRoute(<Help />)
    const toc = Array.from(document.querySelectorAll('.public-toc a')).map((link) => link.getAttribute('href'))
    const sections = Array.from(screen.getByTestId('help-page').querySelectorAll('article > section[id]')).map((section) => `#${section.id}`)
    expect(sections).toEqual(toc)
    expect(toc).toEqual(['#install', '#fix', '#ask'])
  })

  it('offers a public issue path and keeps diagnostics strictly allowlisted', () => {
    // A build without a Turnstile key: the form on /help offers the labelled public path.
    renderRoute(<Help />)
    expect(screen.getByRole('link', { name: 'Open a public issue on GitHub (opens in a new tab)' }).getAttribute('href')).toBe('https://github.com/Aron-Chu/streamclone-pulse/issues')
    const diagnostic = supportDiagnostics({ userAgent: 'Chrome/125 token=private email=private', online: true, width: 390, height: 844 })
    expect(diagnostic).toContain('Chrome/125')
    expect(diagnostic).not.toContain('private')
    expect(diagnostic).not.toContain('token=')
  })
  it('provides a real extension install target from the homepage CTA', () => {
    renderRoute(<Help />)
    const heading = screen.getByRole('heading', { level: 2, name: 'Install' })
    expect(heading.id).toBe('install-title')
    expect(heading.closest('section')?.id).toBe('install')
    expect(screen.getByRole('link', { name: 'service status' }).getAttribute('href')).toBe('/status')
  })

  it('publishes a dedicated privacy policy with a contact path', () => {
    renderRoute(<Privacy />)
    expect(screen.getByRole('heading', { name: /^privacy policy$/i })).toBeTruthy()
    expect(screen.getByTestId('privacy-contact').querySelector('a[href="mailto:privacy@streampulse.stream"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: /help page/i }).getAttribute('href')).toBe('/help')
    const body = screen.getByTestId('privacy-policy').textContent ?? ''
    expect(body).toMatch(/beta access key is sent only to the hosted enrollment endpoint/i)
    expect(body).toMatch(/device token stored locally/i)
    expect(body).toMatch(/not sold, used for advertising, or used for unrelated profiling/i)
    expect(body).toMatch(/does not download or evaluate remotely hosted JavaScript or WebAssembly/i)
    expect(body).toMatch(/planned optional extension crash diagnostics are/i)
    expect(body).toMatch(/off by default/i)
    expect(body).toMatch(/Share crash diagnostics/i)
    expect(body).toMatch(/Hosted diagnostics upload is not active/i)
    expect(body).toMatch(/Sentry \(website error monitoring\)/i)
    expect(body).not.toMatch(/support@streampulse\.stream/i)
    expect(body).not.toMatch(/security@streampulse\.stream/i)
  })

  it('lists the extension My Moments database with what it holds and that it stays on the device', () => {
    renderRoute(<Privacy />)
    // The heading is the summary of its folded section; the list is in that section's body.
    const storage = screen.getByRole('heading', { name: /what is stored in the browser/i }).closest('details')?.querySelector('ul')
    const entry = [...(storage?.querySelectorAll('li') ?? [])].find(item => item.textContent?.includes('pulse-my-moments-v1'))
    const text = entry?.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(text).toMatch(/Extension IndexedDB/)
    expect(text).toMatch(/history \(off by default/i)
    expect(text).toMatch(/notes you add to saved moments/i)
    expect(text).toMatch(/bookmarks you save while no account is linked/i)
    expect(text).toMatch(/None of it is uploaded to StreamPulse or synced/i)
    expect(text).toMatch(/incognito windows neither read it nor add to it/i)
    expect(text).toMatch(/uninstalling the extension deletes it/i)
    expect(text).toMatch(/Bookmarks saved while an account is linked are stored by StreamPulse with that account/i)
  })

  it('publishes actionable extension and analytics help', () => {
    renderRoute(<Help />)
    const page = screen.getByTestId('help-page')
    expect(screen.getByRole('heading', { level: 2, name: 'Fix problems' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'service status' }).getAttribute('href')).toBe('/status')
    expect(page.querySelector('a[href="mailto:privacy@streampulse.stream"]')).toBeTruthy()
    const body = page.textContent ?? ''
    expect(body).toMatch(/for privacy, legal, billing and refund questions/i)
    // This build has no Turnstile key, so the private form is not open yet:
    // Ask us points at the public places the form's card lists.
    expect(screen.getByTestId('help-ask-intro').textContent).toBe('Ask in public on Discord or GitHub. The links are below.')
    expect(screen.getByTestId('support-form-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('support-form')).toBeNull()
    // The mailbox is not called "not support" any more.
    expect(body).not.toMatch(/not a routine product-support mailbox/i)
    expect(body).not.toMatch(/Turnstile/i)
    expect(body).not.toMatch(/support@streampulse\.stream/i)
    expect(body).not.toMatch(/security@streampulse\.stream/i)
  })

  it('renders a useful 404 instead of silently redirecting', () => {
    renderRoute(<NotFound />)
    const page = screen.getByTestId('not-found')
    expect(within(page).getByRole('heading', { name: /page not found/i })).toBeTruthy()
    expect(within(page).getByRole('link', { name: /open the hub/i }).getAttribute('href')).toBe('/analytics')
  })
})
