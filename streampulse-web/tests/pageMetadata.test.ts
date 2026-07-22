import { describe, expect, it } from 'vitest'
import { resolvePageMetadata } from '../src/lib/pageMetadata'

describe('public page metadata', () => {
  it('publishes indexable metadata for public release routes', () => {
    for (const path of ['/', '/analytics', '/docs', '/status', '/privacy', '/support']) {
      const metadata = resolvePageMetadata(path)
      expect(metadata.robots, path).toBe('index,follow')
      expect(metadata.title, path).toContain('StreamPulse')
      expect(metadata.description.length, path).toBeGreaterThan(30)
    }
  })

  it('canonicalizes analytics aliases without treating them as channel names', () => {
    for (const path of ['/analytics/hub', '/analytics/emotes', '/analytics/streams', '/atlas']) {
      expect(resolvePageMetadata(path)).toMatchObject({
        title: 'StreamPulse Analytics',
        canonicalPath: '/analytics',
        robots: 'index,follow',
      })
    }
  })

  it('canonicalizes the legacy session route', () => {
    expect(resolvePageMetadata('/analytics/xqc/s/319455895646')).toMatchObject({
      title: 'xqc Analytics — StreamPulse',
      canonicalPath: '/analytics/xqc/319455895646',
      robots: 'index,follow',
    })
  })

  it('keeps Figma previews and unknown routes out of search results', () => {
    expect(resolvePageMetadata('/analytics/xqc', '?figma=1').robots).toBe('noindex,nofollow')
    expect(resolvePageMetadata('/does-not-exist').robots).toBe('noindex,nofollow')
  })

  it('canonicalizes legacy nested documentation URLs', () => {
    expect(resolvePageMetadata('/docs/getting-started/')).toMatchObject({
      canonicalPath: '/docs',
      robots: 'index,follow',
    })
  })
})
