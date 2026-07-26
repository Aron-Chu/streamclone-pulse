import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ESTIMATED_SHARE_TITLE } from '../src/lib/emoteShare'
import { SharePctDisplay } from '../src/ui/components/analytics/SharePctDisplay'

describe('SharePctDisplay', () => {
  it('renders backend share without estimated marker', () => {
    const { container } = render(<SharePctDisplay sharePct={22} shareEstimated={false} />)
    expect(container.textContent).toContain('22%')
    expect(container.querySelector('.figma-burst-list__share-est')).toBeNull()
  })

  it('marks client-computed share as estimated', () => {
    const { container } = render(<SharePctDisplay sharePct={8.5} shareEstimated />)
    const abbr = container.querySelector('.figma-burst-list__share-est')
    expect(abbr?.getAttribute('title')).toBe(ESTIMATED_SHARE_TITLE)
    expect(container.textContent).toContain('8.5%')
    expect(container.textContent).toContain('est.')
  })

  it('renders nothing for zero share', () => {
    const { container } = render(<SharePctDisplay sharePct={0} shareEstimated />)
    expect(container.textContent).toBe('')
  })
})
