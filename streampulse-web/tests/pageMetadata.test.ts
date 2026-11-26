import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePageMetadata } from '../src/lib/pageMetadata'

describe('public page metadata', () => {
  it('excludes recovery and payment-return routes from indexing', () => {
    expect(resolvePageMetadata('/account/restore')).toMatchObject({ title: 'Restore Supporter — StreamPulse', robots: 'noindex,nofollow' })
    expect(resolvePageMetadata('/supporter/thanks', '?attempt=private')).toMatchObject({ canonicalPath: '/supporter/thanks', robots: 'noindex,nofollow' })
  })
  it('publishes indexable metadata for public release routes', () => {
    for (const path of ['/', '/analytics', '/help', '/status', '/privacy', '/supporter', '/terms', '/refunds']) {
      const metadata = resolvePageMetadata(path)
      expect(metadata.robots, path).toBe('index,follow')
      expect(metadata.title, path).toContain('StreamPulse')
      expect(metadata.title, path).not.toContain('Page not found')
      expect(metadata.description.length, path).toBeGreaterThan(30)
    }
  })

  it('titles /terms as the general Terms of Use (site, extension and Supporter)', () => {
    const metadata = resolvePageMetadata('/terms')
    expect(metadata.title).toBe('Terms of Use — StreamPulse')
    expect(metadata.description).toMatch(/website/)
    expect(metadata.description).toMatch(/extension/)
    expect(metadata.description).toMatch(/Supporter/)
  })

  it('canonicalizes analytics aliases without treating them as channel names', () => {
    for (const path of ['/analytics/hub', '/analytics/emotes', '/analytics/streams', '/atlas']) {
      expect(resolvePageMetadata(path)).toMatchObject({
        title: 'Live Twitch Chat Stats & Top Emotes — StreamPulse',
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

  it('points legacy documentation URLs at Help, which they open', () => {
    expect(resolvePageMetadata('/docs/getting-started/')).toMatchObject({
      canonicalPath: '/help',
      robots: 'noindex,nofollow',
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

  it('names Moments for the retired Explorer paths it redirects', () => {
    for (const path of ['/analytics/explore', '/analytics/explore/pulse-xqc-session-1']) {
      expect(resolvePageMetadata(path)).toMatchObject({
        title: 'Moments — StreamPulse', canonicalPath: '/analytics/moments', robots: 'noindex,nofollow',
      })
    }
  })
})

describe('account page metadata', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('titles a switched-off or unknown account address as not found', () => {
    vi.stubEnv('VITE_ACCOUNT_MOMENTS', '')
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    for (const path of ['/account/moments', '/account/twitch/callback', '/account/nope', '/account/billing/nope']) {
      expect(resolvePageMetadata(path), path).toMatchObject({ title: 'Page not found — StreamPulse', canonicalPath: path, robots: 'noindex,nofollow' })
    }
  })

  it('keeps the account titles for pages this build has', () => {
    vi.stubEnv('VITE_ACCOUNT_MOMENTS', '')
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    expect(resolvePageMetadata('/account/settings').title).toBe('Account & devices — StreamPulse')
    expect(resolvePageMetadata('/account/sign-in/').title).toBe('Sign in — StreamPulse')
    for (const path of ['/account/billing', '/account/billing/', '/account/billing/return', '/account/billing/return/']) expect(resolvePageMetadata(path).title, path).toBe('Your account — StreamPulse')
  })

  it('ignores case, as the router does', () => {
    vi.stubEnv('VITE_ACCOUNT_MOMENTS', '')
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    expect(resolvePageMetadata('/account/Settings').title).toBe('Account & devices — StreamPulse')
    expect(resolvePageMetadata('/account/Billing/').title).toBe('Your account — StreamPulse')
    expect(resolvePageMetadata('/account/Restore').title).toBe('Restore Supporter — StreamPulse')
    expect(resolvePageMetadata('/account/Moments').title).toBe('Page not found — StreamPulse')
    expect(resolvePageMetadata('/Account/settings').title).toBe('Account & devices — StreamPulse')
    expect(resolvePageMetadata('/ACCOUNT/Restore').title).toBe('Restore Supporter — StreamPulse')
    vi.stubEnv('VITE_ACCOUNT_MOMENTS', '1')
    expect(resolvePageMetadata('/Account').title).toBe('Your account — StreamPulse')
  })

  it('titles My Moments and the Twitch return as the account once their switches are on', () => {
    vi.stubEnv('VITE_ACCOUNT_MOMENTS', '1')
    vi.stubEnv('VITE_TWITCH_SIGNIN', '1')
    for (const path of ['/account', '/account/', '/account/moments', '/account/moments/', '/account/twitch/callback', '/account/twitch/callback/']) {
      expect(resolvePageMetadata(path), path).toMatchObject({ title: 'Your account — StreamPulse', robots: 'noindex,nofollow' })
    }
  })
})

describe('clip page metadata', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('titles a clip address as not found while clips are off', () => {
    vi.stubEnv('VITE_PUBLIC_NATIVE_CLIPS', '')
    for (const path of ['/analytics/clips/BraveClipSlug-abc_1', '/analytics/clips']) {
      expect(resolvePageMetadata(path), path).toMatchObject({ title: 'Page not found — StreamPulse', robots: 'noindex,nofollow' })
    }
  })

  it('titles a clip page only when clips are on', () => {
    vi.stubEnv('VITE_PUBLIC_NATIVE_CLIPS', 'on')
    expect(resolvePageMetadata('/analytics/clips/BraveClipSlug-abc_1')).toMatchObject({ title: 'Clip — StreamPulse', robots: 'noindex,nofollow' })
  })
})
