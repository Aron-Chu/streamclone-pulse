import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AnalyticsFigmaShell } from '../src/ui/components/analytics/AnalyticsFigmaShell'
import { CHROME_WEB_STORE_LISTING_URL } from '../src/lib/publicSiteConfig'

function renderShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AnalyticsFigmaShell>
        <div>hub body</div>
      </AnalyticsFigmaShell>
    </MemoryRouter>,
  )
}

function barLinks() {
  const nav = screen.getByRole('navigation', { name: 'Analytics navigation' })
  return [...nav.querySelectorAll(':scope > a')]
}

describe('AnalyticsFigmaShell navigation', () => {
  it('reads Hub, Moments, Extension, Docs, with the hub at the front page', () => {
    renderShell('/')

    expect(barLinks().map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Hub', '/'],
      ['Moments', '/analytics/moments'],
      ['Extension', '/extension'],
      ['Docs', '/docs'],
    ])
    expect(screen.getByRole('link', { name: 'Hub' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByLabelText('StreamPulse analytics home').getAttribute('href')).toBe('/')
  })

  it('keeps Hub current at /analytics, which serves the same hub', () => {
    const { unmount } = renderShell('/analytics')
    expect(screen.getByRole('link', { name: 'Hub' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Moments' }).getAttribute('aria-current')).toBeNull()
    unmount()

    renderShell('/analytics/moments')
    expect(screen.getByRole('link', { name: 'Hub' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'Moments' }).getAttribute('aria-current')).toBe('page')
  })

  it('has one Add to Chrome button, and keeps feedback and Discord in the menu and footer', () => {
    renderShell('/')

    const installs = screen.getAllByRole('link', { name: 'Add to Chrome' })
    expect(installs).toHaveLength(1)
    expect(installs[0]!.getAttribute('href')).toBe(CHROME_WEB_STORE_LISTING_URL)
    expect(barLinks().some((a) => /feedback|discord/i.test(a.textContent ?? ''))).toBe(false)
    // The closed menu is hidden from the accessibility tree, so count it with the footer.
    expect(screen.getAllByRole('link', { name: 'Send feedback', hidden: true })).toHaveLength(2)
  })

  it('no longer offers the retired Pulse Explorer', () => {
    renderShell('/analytics')
    expect(screen.queryByRole('link', { name: /Pulse Explorer/ })).toBeNull()
    expect(document.querySelector('a[href^="/analytics/explore"]')).toBeNull()
  })
})
