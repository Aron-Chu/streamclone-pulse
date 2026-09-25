import { describe, expect, it } from 'vitest'
import { resolvePageMetadata } from '../src/lib/pageMetadata'

describe('public page metadata', () => {
  it('publishes indexable metadata for public release routes', () => {
    for (const path of ['/', '/analytics', '/docs', '/status', '/privacy', '/support', '/supporter', '/terms', '/refunds']) {
      const metadata = resolvePageMetadata(path)
      expect(metadata.robots, path).toBe('index,follow')
      expect(metadata.title, path).toContain('StreamPulse')
      expect(metadata.title, path).not.toContain('Page not found')
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
      robots: 'noindex,nofollow',
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
  it('reserves moment-update routes and does not index nonexistent docs', () => {
    expect(resolvePageMetadata('/analytics/newsroom').title).toBe('Moment updates — StreamPulse')
    expect(resolvePageMetadata('/analytics/newsroom/story-1').title).toBe('Moment update — StreamPulse')
    expect(resolvePageMetadata('/docs/nonexistent').robots).toBe('noindex,nofollow')
  })

  it('does not invent indexed channel pages from system paths or unchecked slugs', () => {
    for (const path of ['/analytics/settings', '/analytics/bad%20name', '/analytics/%ZZ']) {
      expect(resolvePageMetadata(path)).toMatchObject({ title: 'Page not found — StreamPulse', robots: 'noindex,nofollow' })
    }
    expect(resolvePageMetadata('/analytics/unknownbutvalidname').robots).toBe('noindex,nofollow')
  })

  it('keeps Pulse Explorer as its own page and canonical root', () => {
    expect(resolvePageMetadata('/analytics/explore')).toMatchObject({
      title: 'Pulse Explorer — StreamPulse', canonicalPath: '/analytics/explore', robots: 'noindex,nofollow',
    })
    expect(resolvePageMetadata('/analytics/explore/pulse-xqc-session-1')).toMatchObject({
      title: 'Pulse Explorer — StreamPulse', canonicalPath: '/analytics/explore', robots: 'noindex,nofollow',
    })
  })
})
