import { describe, expect, it } from 'vitest'
import {
  overlaySessionKey,
  placeholderLoginForContext,
  shouldActivateOverlay,
} from '../src/content/contentActivation.ts'

describe('contentActivation', () => {
  it('activates vod routes without login', () => {
    expect(
      shouldActivateOverlay({ kind: 'vod', login: null, vodId: '2806037629' }),
    ).toBe(true)
    expect(overlaySessionKey({ kind: 'vod', login: null, vodId: '2806037629' })).toBe(
      'vod:2806037629',
    )
    expect(
      placeholderLoginForContext({ kind: 'vod', login: null, vodId: '2806037629' }),
    ).toBe('__vod__:2806037629')
  })

  it('activates channel routes with login', () => {
    expect(
      shouldActivateOverlay({ kind: 'channel', login: 'xqc', vodId: null }),
    ).toBe(true)
    expect(overlaySessionKey({ kind: 'channel', login: 'xqc', vodId: null })).toBe('xqc')
  })

  it('does not activate unsupported routes', () => {
    expect(
      shouldActivateOverlay({ kind: 'non-channel', login: null, vodId: null }),
    ).toBe(false)
  })
})
