import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Privacy from '../src/routes/public/Privacy'
import Terms from '../src/routes/public/Terms'

// Lets a test render the same page with the folding switched off, to compare its words.
const state = vi.hoisted(() => ({ flat: false }))
vi.mock('../src/ui/components/FoldedSections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/components/FoldedSections')>()
  return {
    ...actual,
    FoldedSections: (props: { children: ReactNode }) => (state.flat ? <>{props.children}</> : <actual.FoldedSections {...props} />),
  }
})

beforeEach(() => { state.flat = false })
afterEach(cleanup)

const PAGES = [
  { name: 'Privacy', Page: Privacy, root: 'privacy-policy' },
  { name: 'Terms', Page: Terms, root: 'terms-of-use' },
] as const

function renderPage(Page: typeof Privacy) {
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

describe.each(PAGES)('$name is folded into headed sections', ({ Page, root }) => {
  it('puts every heading after the summary block in a closed section, and keeps the summary open', () => {
    const { container } = renderPage(Page)
    const article = screen.getByTestId(root)
    const headings = [...article.querySelectorAll('h2')]
    const summary = headings.find((heading) => heading.textContent === 'Summary')!
    expect(summary.closest('details')).toBeNull()
    const folded = headings.filter((heading) => heading !== summary)
    expect(folded.length).toBeGreaterThan(8)
    for (const heading of folded) {
      expect(heading.parentElement?.tagName, heading.textContent ?? '').toBe('SUMMARY')
      expect(heading.closest('details')?.open, heading.textContent ?? '').toBe(false)
    }
    expect(container.querySelectorAll('details[data-fold]')).toHaveLength(folded.length)
    // The title, the date line and the summary block are never folded.
    expect(article.querySelector('h1')?.closest('details')).toBeNull()
  })

  it('keeps every word: the folded page reads exactly as the page without folds', () => {
    const folded = renderPage(Page).container.textContent
    cleanup()
    state.flat = true
    const flat = renderPage(Page).container.textContent
    expect(flat?.length).toBeGreaterThan(5_000)
    expect(folded).toBe(flat)
  })

  it('gives every section its heading first, as the summary, and its text in a body after it', () => {
    renderPage(Page)
    const all = [...document.querySelectorAll('details[data-fold]')]
    expect(all.length).toBeGreaterThan(8)
    for (const fold of all) {
      expect(fold.firstElementChild?.tagName).toBe('SUMMARY')
      expect(fold.querySelector(':scope > .public-fold__body')).not.toBeNull()
    }
  })
})

describe('anchors still point at their sections', () => {
  it('Privacy: #feedback-form is the heading of the Feedback form section, which holds its paragraphs', () => {
    renderPage(Privacy)
    const heading = document.getElementById('feedback-form')!
    expect(heading.tagName).toBe('H2')
    const fold = heading.closest('details')!
    expect(fold.hasAttribute('data-fold')).toBe(true)
    expect(fold.querySelector('[data-testid="privacy-feedback"] [data-testid="privacy-feedback-sent"]')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Feedback form' }).id).toBe('feedback-form')
  })

  it('Terms: #supporter is the heading of the Pulse Supporter section, which holds the offer terms', () => {
    renderPage(Terms)
    const heading = document.getElementById('supporter')!
    expect(heading.textContent).toBe('Pulse Supporter')
    const fold = heading.closest('details')!
    expect(fold.open).toBe(false)
    expect(fold.querySelector('[data-testid="terms-supporter-benefits"]')).not.toBeNull()
    expect(fold.querySelector('[data-testid="terms-billing-email"]')).not.toBeNull()
  })
})
