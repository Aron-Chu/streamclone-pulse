import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { setupStreamcloneAnalyticsApi, portalBookmarksSupported } from '../src/lib/streamcloneAnalytics'
import { getConfiguredAnalyticsApi } from '@streamclone/analytics-console'

describe('portal bookmarks (public console)', () => {
  beforeEach(() => {
    localStorage.clear()
    setupStreamcloneAnalyticsApi()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('reports bookmarks unsupported without beta key', () => {
    expect(portalBookmarksSupported()).toBe(false)
  })

  it('getPulseBookmarks returns explicit unsupported state on public console', async () => {
    const result = await getConfiguredAnalyticsApi().getPulseBookmarks()
    expect(result).toMatchObject({
      items: [],
      supported: false,
      reason: 'private_beta',
    })
  })

  it('createPulseBookmark rejects public mode with read-only message', async () => {
    await expect(getConfiguredAnalyticsApi().createPulseBookmark({})).rejects.toThrow(/read-only/i)
  })
})
