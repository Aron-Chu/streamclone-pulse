import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AnalyticsFigmaShell } from '../src/ui/components/analytics/AnalyticsFigmaShell'

function renderShell() {
  render(
    <MemoryRouter initialEntries={['/analytics']}>
      <AnalyticsFigmaShell>
        <div>hub body</div>
      </AnalyticsFigmaShell>
    </MemoryRouter>,
  )
}

describe('AnalyticsFigmaShell navigation', () => {
  it('lists the site destinations under their shared names, and keeps a way home', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Hub', '/analytics'],
      ['Moments', '/analytics/moments'],
      ['Help', '/help'],
    ])
    // The site's name goes home (one header on every page, 11-24), as the shared footer's does.
    expect(screen.getByRole('link', { name: 'StreamPulse' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'StreamPulse home' }).getAttribute('href')).toBe('/')
  })

  it('uses the shared site footer and no longer offers the retired Pulse Explorer', () => {
    renderShell()
    expect(document.querySelectorAll('footer.app-footer')).toHaveLength(1)
    expect(document.querySelector('.figma-analytics__site-footer')).toBeNull()
    expect(screen.queryByRole('link', { name: /Pulse Explorer/ })).toBeNull()
    expect(document.querySelector('a[href^="/analytics/explore"]')).toBeNull()
  })
})
