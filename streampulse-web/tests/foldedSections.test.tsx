import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FoldedSections } from '../src/ui/components/FoldedSections'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const folds = (container: HTMLElement) => [...container.querySelectorAll<HTMLDetailsElement>('details[data-fold]')]
const headingOf = (fold: HTMLElement) => fold.querySelector('summary > h2')?.textContent

function page() {
  return (
    <article>
      <p>Lead before any heading.</p>
      <FoldedSections>
        <h2>One</h2>
        <p>First paragraph.</p>
        <ul><li>A list item.</li></ul>
        <h2 id="two" className="loud">Two</h2>
        <p>Second paragraph.</p>
        {false}
        {null}
        <>
          <p>From a fragment.</p>
          <p>Also from it.</p>
        </>
        <section data-testid="own-section">
          <h2 id="three">Three</h2>
          <p>Inside a section.</p>
        </section>
        <p>After the section.</p>
        <h2>Four</h2>
      </FoldedSections>
    </article>
  )
}

describe('FoldedSections', () => {
  it('folds each h2 with what follows it, and leaves what comes before the first alone', () => {
    const { container } = render(page())
    const all = folds(container)
    expect(all.map((fold) => headingOf(fold))).toEqual(['One', 'Two', 'Three', 'Four'])
    expect(container.querySelector('article > p')?.textContent).toBe('Lead before any heading.')
    expect(all[0]!.querySelector('.public-fold__body')!.textContent).toBe('First paragraph.A list item.')
    expect(all[1]!.querySelector('.public-fold__body')!.textContent).toBe('Second paragraph.From a fragment.Also from it.')
    expect(all[3]!.querySelector('.public-fold__body')!.textContent).toBe('')
  })

  it('starts every section closed', () => {
    const { container } = render(page())
    expect(folds(container).every((fold) => !fold.open)).toBe(true)
  })

  it('keeps the heading element, with its id and class, inside the summary', () => {
    const { container } = render(page())
    const two = container.querySelector('h2#two') as HTMLElement
    expect(two.className).toBe('loud')
    expect(two.parentElement?.tagName).toBe('SUMMARY')
    expect(two.closest('details')).toBe(folds(container)[1])
  })

  it('takes a section that opens with an h2 as one fold, keeping the section and what follows it', () => {
    const { container } = render(page())
    const three = folds(container)[2]!
    expect(headingOf(three)).toBe('Three')
    const own = three.querySelector('[data-testid="own-section"]')!
    expect(own.textContent).toBe('Inside a section.')
    expect(own.querySelector('h2')).toBeNull()
    expect(three.querySelector('.public-fold__body')!.textContent).toBe('Inside a section.After the section.')
    expect(container.querySelector('h2#three')!.closest('summary')).not.toBeNull()
  })

  it('adds and removes no words', () => {
    const folded = render(page()).container.textContent
    cleanup()
    const flat = render(
      <article>
        <p>Lead before any heading.</p>
        <h2>One</h2><p>First paragraph.</p><ul><li>A list item.</li></ul>
        <h2 id="two" className="loud">Two</h2><p>Second paragraph.</p><p>From a fragment.</p><p>Also from it.</p>
        <section data-testid="own-section"><h2 id="three">Three</h2><p>Inside a section.</p></section>
        <p>After the section.</p>
        <h2>Four</h2>
      </article>,
    ).container.textContent
    expect(folded).toBe(flat)
  })

  it('folds nothing, and renders everything, when there is no h2', () => {
    const { container } = render(<FoldedSections><p>One.</p><p>Two.</p></FoldedSections>)
    expect(folds(container)).toHaveLength(0)
    expect(container.textContent).toBe('One.Two.')
  })

  it('opens every section for a print and puts each back as the reader had it', () => {
    const { container } = render(page())
    const all = folds(container)
    all[1]!.open = true
    fireEvent(window, new Event('beforeprint'))
    expect(all.every((fold) => fold.open)).toBe(true)
    fireEvent(window, new Event('afterprint'))
    expect(all.map((fold) => fold.open)).toEqual([false, true, false, false])
  })

  it('stops listening for prints when it unmounts', () => {
    const view = render(page())
    const all = folds(view.container)
    view.unmount()
    fireEvent(window, new Event('beforeprint'))
    expect(all.every((fold) => !fold.open)).toBe(true)
  })

  it('warns of no duplicate keys', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(page())
    expect(error).not.toHaveBeenCalled()
  })
})
