import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/generated/recap-page-metadata.json', () => ({ default: {
  '/analytics/fixturechan/123': { title: 'Fixture reaction recap — StreamPulse', description: 'Reviewed synthetic metadata for the isolated metadata test.',
    canonicalPath: '/analytics/fixturechan/123', robots: 'index,follow' },
} }))

import { resolvePageMetadata } from '../src/lib/pageMetadata'

describe('reviewed recap metadata after client boot', () => {
  it('retains build-approved metadata only for the exact reviewed page', () => {
    expect(resolvePageMetadata('/analytics/fixturechan/123/')).toEqual({
      title: 'Fixture reaction recap — StreamPulse', description: 'Reviewed synthetic metadata for the isolated metadata test.',
      canonicalPath: '/analytics/fixturechan/123', robots: 'index,follow',
    })
    expect(resolvePageMetadata('/analytics/fixturechan/124').robots).toBe('noindex,nofollow')
    expect(resolvePageMetadata('/analytics/otherchannel/123').robots).toBe('noindex,nofollow')
    expect(resolvePageMetadata('/s/fixturechan/123')).toMatchObject({ canonicalPath: '/analytics/fixturechan/123', robots: 'index,follow' })
    expect(resolvePageMetadata('/analytics/fixturechan/s/123')).toMatchObject({ canonicalPath: '/analytics/fixturechan/123', robots: 'index,follow' })
    expect(resolvePageMetadata('/analytics').robots).toBe('index,follow')
  })

  it('does not index a Figma preview even for an approved canonical page', () => {
    expect(resolvePageMetadata('/analytics/fixturechan/123', '?figma=1').robots).toBe('noindex,nofollow')
  })
})
