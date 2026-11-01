import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../src/generated/recap-page-metadata.json', () => ({ default: {
  '/analytics/fixturechan/123': { title: 'Fixture recap', description: 'Synthetic reviewed summary metadata.', canonicalPath: '/analytics/fixturechan/123', robots: 'index,follow' },
} }))
import { ReviewedRecapSummary } from '../src/ui/ReviewedRecapSummary'

afterEach(() => { cleanup(); document.getElementById('reviewed-recap-summary')?.remove() })
function template(path = '/analytics/fixturechan/123') {
  const element = document.createElement('template')
  element.id = 'reviewed-recap-summary'; element.dataset.canonicalPath = path
  element.innerHTML = '<article><h1>Reviewed synthetic reaction summary</h1><a href="/docs#extension">Install guide</a></article>'
  document.body.appendChild(element)
}
describe('reviewed summary after app boot', () => {
  it('keeps the same summary and working install link on its exact approved page', () => {
    template()
    render(<MemoryRouter initialEntries={['/analytics/fixturechan/123']}><ReviewedRecapSummary /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Reviewed synthetic reaction summary' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Install guide' }).getAttribute('href')).toBe('/docs#extension')
  })
  it('does not show another page snapshot or an unchecked template', () => {
    template('/analytics/someoneelse/123')
    render(<MemoryRouter initialEntries={['/analytics/fixturechan/123']}><ReviewedRecapSummary /></MemoryRouter>)
    expect(screen.queryByRole('heading')).toBeNull()
  })
  it('does not show reviewed content on an unknown page', () => {
    template()
    render(<MemoryRouter initialEntries={['/analytics/fixturechan/999']}><ReviewedRecapSummary /></MemoryRouter>)
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
