import { describe, expect, it } from 'vitest'
import { recapAnalyticsCategory } from '../src/lib/recapAnalyticsCategory'

const approved = [
  { path: '/analytics/fixturechan', category: 'channel_summary' },
  { path: '/analytics/fixturechan/12345', category: 'stream_recap' },
]

describe('approved recap measurement categories', () => {
  it('classifies only exact approved paths, including their trailing slash aliases', () => {
    expect(recapAnalyticsCategory('/analytics/fixturechan', approved)).toBe('channel_summary')
    expect(recapAnalyticsCategory('/analytics/fixturechan/12345/', approved)).toBe('stream_recap')
    for (const path of ['/analytics', '/analytics/other', '/analytics/fixturechan/67890', '/analytics/fixturechan/private', '/s/fixturechan', '/account/settings']) {
      expect(recapAnalyticsCategory(path, approved)).toBeNull()
    }
  })

  it('fails closed for malformed or inappropriate generated rows', () => {
    const rows = [null, {}, { path: '/account/settings', category: 'channel_summary' },
      { path: '/analytics/fixturechan/12345', category: 'channel_summary' },
      { path: '/analytics/fixturechan', category: 'stream_recap' },
      { path: '/analytics/%2faccount', category: 'channel_summary' },
      { path: '/analytics/fixturechan', category: 'unknown' }]
    for (const path of ['/account/settings', '/analytics/fixturechan/12345', '/analytics/fixturechan', '/analytics/%2faccount']) {
      expect(recapAnalyticsCategory(path, rows)).toBeNull()
    }
    expect(recapAnalyticsCategory('/analytics/fixturechan', [])).toBeNull()
  })
})
