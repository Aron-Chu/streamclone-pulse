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
})
