// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PulseSectionCard } from '../src/ui/PulseSectionCard.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PulseSectionCard', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('keeps heading metadata contained and exposes the inline layout state', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <PulseSectionCard title="Past streams" meta={<button type="button">View all</button>}>
          <p>Recent streams</p>
        </PulseSectionCard>,
      )
    })

    const card = container.querySelector<HTMLElement>('.pulse-section-card')
    const heading = container.querySelector<HTMLElement>('[data-pulse-section-heading]')
    const meta = container.querySelector<HTMLElement>('[data-pulse-section-meta]')

    expect(card).not.toBeNull()
    expect(heading?.dataset.pulseSectionHeading).toBe('inline')
    expect(meta?.dataset.pulseSectionMeta).toBe('true')
    expect(meta?.textContent).toContain('View all')
  })

  it('makes stacked metadata a full-width heading row', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <PulseSectionCard title="Top moments" stackMeta meta={<span>Sort by score</span>}>
          <p>Moments</p>
        </PulseSectionCard>,
      )
    })

    const heading = container.querySelector<HTMLElement>('[data-pulse-section-heading]')
    const meta = container.querySelector<HTMLElement>('[data-pulse-section-meta]')

    expect(heading?.dataset.pulseSectionHeading).toBe('stacked')
    expect(meta?.textContent).toContain('Sort by score')
    expect(meta?.style.flex).toBe('1 1 100%')
    expect(meta?.style.justifyContent).toBe('flex-start')
  })
})
