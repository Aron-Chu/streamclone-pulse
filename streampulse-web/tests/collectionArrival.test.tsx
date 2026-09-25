import { useRef } from 'react'
import { render, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCollectionArrival } from '../src/ui/motion/useCollectionArrival'

function List({ ids }: { ids: string[] }) {
  const root = useRef<HTMLDivElement>(null)
  useCollectionArrival(root, JSON.stringify(ids))
  return <div ref={root}>{ids.map(id => <div key={id} data-arrival-key={id}>{id}</div>)}</div>
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('animates each arrival once, never replays polls or filter returns', () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }))
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  const view = render(<List ids={['one', 'two']} />)
  expect(animate).toHaveBeenCalledTimes(2)
  view.rerender(<List ids={['one', 'two']} />)
  view.rerender(<List ids={['two']} />)
  view.rerender(<List ids={['one', 'two', 'three']} />)
  expect(animate).toHaveBeenCalledTimes(3)
  expect(animate.mock.calls[0]).toBeTruthy()
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
})
it('renders reduced-motion arrivals without animation', () => {
  const animate = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(<List ids={['one']} />)
  expect(animate).not.toHaveBeenCalled()
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
})
