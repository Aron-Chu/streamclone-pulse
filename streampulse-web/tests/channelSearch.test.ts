import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  lookupChannelSuggestion,
  mergeHubSuggestions,
  searchChannelSuggestions,
} from '../src/lib/channelSearch'

const mockApiClient = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}))

describe('channelSearch', () => {
  beforeEach(() => {
    mockApiClient.mockReset()
  })

  it('maps metadata search streams to suggestions', async () => {
    mockApiClient.mockResolvedValueOnce({
      data: {
        streams: [
          {
            login: 'xqc',
            displayName: 'xQc',
            isLive: false,
            profileImageUrl: 'https://avatar/xqc.png',
          },
          {
            login: 'liveone',
            displayName: 'LiveOne',
            isLive: true,
            viewers: 1200,
            category: 'Just Chatting',
          },
        ],
      },
    })

    const rows = await searchChannelSuggestions('xq', 8)
    expect(mockApiClient).toHaveBeenCalledWith('/v1/search?q=xq&limit=8')
    expect(rows).toEqual([
      {
        login: 'xqc',
        displayName: 'xQc',
        profileImageUrl: 'https://avatar/xqc.png',
        live: false,
      },
      {
        login: 'liveone',
        displayName: 'LiveOne',
        viewers: 1200,
        category: 'Just Chatting',
        live: true,
      },
    ])
  })

  it('looks up an offline channel by exact login', async () => {
    mockApiClient.mockResolvedValueOnce({
      data: {
        login: 'xqc',
        displayName: 'xQc',
        profileImage: 'https://avatar/xqc.png',
        isLive: false,
      },
    })

    const row = await lookupChannelSuggestion('xQc')
    expect(mockApiClient).toHaveBeenCalledWith('/v1/channels/xqc')
    expect(row).toEqual({
      login: 'xqc',
      displayName: 'xQc',
      profileImageUrl: 'https://avatar/xqc.png',
      live: false,
    })
  })

  it('merges local and remote suggestions without duplicates', () => {
    const merged = mergeHubSuggestions(
      [{ login: 'xqc', displayName: 'xQc', live: false }],
      [{ login: 'xqc', displayName: 'xQc duplicate' }, { login: 'caseoh_', displayName: 'caseoh_' }],
      4,
    )
    expect(merged).toHaveLength(2)
    expect(merged[0].login).toBe('xqc')
    expect(merged[1].login).toBe('caseoh_')
  })

  it('enriches local suggestions with remote profile images for offline channels', () => {
    const merged = mergeHubSuggestions(
      [{ login: 'xqc', displayName: 'xQc', live: false }],
      [{ login: 'xqc', profileImageUrl: 'https://avatar/xqc.png', live: false }],
      4,
    )
    expect(merged).toEqual([
      {
        login: 'xqc',
        displayName: 'xQc',
        profileImageUrl: 'https://avatar/xqc.png',
        live: false,
      },
    ])
  })
})
