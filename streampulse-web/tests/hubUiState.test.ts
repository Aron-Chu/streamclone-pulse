import { describe, expect, it } from 'vitest'
import { isHubNetworkDegraded, resolveHubUiState } from '../src/lib/hubUiState'
import { normalizePublicHub } from '../src/lib/publicHub'

describe('resolveHubUiState', () => {
  it('is loading when no data yet', () => {
    expect(
      resolveHubUiState({
        loading: true,
        data: null,
        error: null,
        hubEndpointOk: false,
        loadSource: null,
      }),
    ).toBe('loading')
  })

  it('is error when fetch failed with no snapshot', () => {
    expect(
      resolveHubUiState({
        loading: false,
        data: null,
        error: 'Public hub unavailable',
        hubEndpointOk: false,
        loadSource: null,
      }),
    ).toBe('error')
  })

  it('is ready when hub has a live pool', () => {
    const data = normalizePublicHub({ poolSize: 88, liveChannels: [] })
    expect(
      resolveHubUiState({
        loading: false,
        data,
        error: null,
        hubEndpointOk: true,
        loadSource: 'full',
      }),
    ).toBe('ready')
  })

  it('is empty when hub ok but pool is zero', () => {
    const data = normalizePublicHub({ poolSize: 0, liveChannels: [] })
    expect(
      resolveHubUiState({
        loading: false,
        data,
        error: null,
        hubEndpointOk: true,
        loadSource: 'full',
      }),
    ).toBe('empty')
  })

  it('is ready for stats-fallback shell', () => {
    const data = normalizePublicHub({ poolSize: 0, liveChannels: [] })
    expect(
      resolveHubUiState({
        loading: false,
        data,
        error: null,
        hubEndpointOk: false,
        loadSource: 'stats-fallback',
      }),
    ).toBe('ready')
  })
})

describe('isHubNetworkDegraded', () => {
  it('does not treat initial hubEndpointOk=false as unavailable', () => {
    expect(isHubNetworkDegraded(null, false)).toBe(false)
    expect(isHubNetworkDegraded('cache', false)).toBe(false)
  })

  it('treats stats-fallback as degraded', () => {
    expect(isHubNetworkDegraded('stats-fallback', false)).toBe(true)
  })

  it('treats confirmed full load without hub endpoint as degraded', () => {
    expect(isHubNetworkDegraded('full', false)).toBe(true)
    expect(isHubNetworkDegraded('full', true)).toBe(false)
  })
})
