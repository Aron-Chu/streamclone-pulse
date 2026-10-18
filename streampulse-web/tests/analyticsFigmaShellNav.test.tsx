import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AnalyticsFigmaShell } from '../src/ui/components/analytics/AnalyticsFigmaShell'

describe('AnalyticsFigmaShell navigation', () => {
  it('exposes an explicit Home link back to the marketing front page', () => {
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <AnalyticsFigmaShell>
          <div>hub body</div>
        </AnalyticsFigmaShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
    expect(screen.getByLabelText('StreamPulse analytics home').getAttribute('href')).toBe('/analytics')
    expect(screen.getByRole('link', { name: 'Analytics' }).getAttribute('href')).toBe('/analytics')
  })

  it('links All moments and no longer offers the retired Pulse Explorer', () => {
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <AnalyticsFigmaShell>
          <div>hub body</div>
        </AnalyticsFigmaShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'All moments' }).getAttribute('href')).toBe('/analytics/moments')
    expect(screen.queryByRole('link', { name: /Pulse Explorer/ })).toBeNull()
    expect(document.querySelector('a[href^="/analytics/explore"]')).toBeNull()
  })
})
