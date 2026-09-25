import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LibraryPeek } from '../src/ui/library/LibraryPeek.tsx'

describe('My Moments library peek', () => {
  it('uses the themed CTA while keeping the library action accessible', () => {
    const html = renderToStaticMarkup(
      <LibraryPeek
        recent={[]}
        historyEnabled
        onOpenLibrary={() => undefined}
      />,
    )

    expect(html).toContain('data-pulse-library-cta="true"')
    expect(html).toContain('aria-label="Open My Moments library"')
    expect(html).toContain('View library')
    expect(html).toContain('pulse-library-peek-cta-arrow')
  })
})
