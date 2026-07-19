import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BrandMark, PEAK_MARK_PATH } from '../src/ui/components/BrandMark'
import { PublicLayout } from '../src/ui/components/PublicLayout'
import { AnalyticsTopNav } from '../src/ui/components/analytics/AnalyticsTopNav'

function renderInRouter(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('StreamPulse Peak branding', () => {
  it('renders the canonical Peak geometry', () => {
    const { container } = render(<BrandMark title="StreamPulse Peak mark" />)
    const mark = screen.getByRole('img', { name: /streamPulse Peak mark/i })
    expect(mark.getAttribute('data-brand-mark')).toBe('peak')
    expect(container.querySelector('path')?.getAttribute('d')).toBe(PEAK_MARK_PATH)
  })

  it('keeps the public SVG and favicon aligned with the React mark', () => {
    for (const asset of ['brand-peak.svg', 'favicon.svg']) {
      const svg = readFileSync(resolve(process.cwd(), 'public', asset), 'utf8')
      expect(svg).toContain(PEAK_MARK_PATH)
      expect(svg).toContain('aria-label="StreamPulse Peak mark"')
    }
  })

  it('uses Peak branding without changing the analytics-home destination', () => {
    const { container } = renderInRouter(
      <AnalyticsTopNav items={[{ label: 'Overview', to: '/analytics', end: true }]} />,
    )
    expect(container.querySelector('[data-brand-mark="peak"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: /streamPulse analytics home/i }).getAttribute('href')).toBe('/analytics')
  })

  it('uses Peak branding while preserving every public navigation link', () => {
    const { container } = renderInRouter(
      <PublicLayout>
        <p>Public content</p>
      </PublicLayout>,
    )
    expect(container.querySelector('[data-brand-mark="peak"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: /^privacy$/i }).getAttribute('href')).toBe('/privacy')
    expect(screen.getByRole('link', { name: /^analytics$/i }).getAttribute('href')).toBe('/analytics')
  })
})
