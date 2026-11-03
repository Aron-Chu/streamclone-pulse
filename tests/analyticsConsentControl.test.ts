import { describe, expect, it } from 'vitest'
import { isSenderAuthorizedForMessage } from '../src/background/pulseBroadcastTargets.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'

describe('analytics consent worker boundary', () => {
  it('accepts only the exact consent-control shape', () => {
    const grantTicket = '00000000-0000-4000-8000-000000000001'
    expect(parseBackgroundRequest({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT' }))
      .toEqual({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT' })
    expect(parseBackgroundRequest({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT', extra: true })).toBeNull()
    expect(parseBackgroundRequest({ type: 'SET_ANALYTICS_CONSENT', granted: false }))
      .toEqual({ type: 'SET_ANALYTICS_CONSENT', granted: false })
    expect(parseBackgroundRequest({ type: 'SET_ANALYTICS_CONSENT', granted: true }))
      .toEqual({ type: 'SET_ANALYTICS_CONSENT', granted: true })
    expect(parseBackgroundRequest({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket }))
      .toEqual({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket })
    for (const message of [
      { type: 'SET_ANALYTICS_CONSENT' },
      { type: 'SET_ANALYTICS_CONSENT', granted: 'true' },
      { type: 'SET_ANALYTICS_CONSENT', granted: false, extra: true },
      { type: 'SET_ANALYTICS_CONSENT', granted: false, grantTicket },
      { type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket: 'not-a-ticket' },
    ]) expect(parseBackgroundRequest(message)).toBeNull()
  })

  it('limits consent changes to extension-owned pages', () => {
    const id = 'test-extension'
    expect(isSenderAuthorizedForMessage('SET_ANALYTICS_CONSENT', undefined,
      { id, url: `chrome-extension://${id}/options/index.html` }, id)).toBe(true)
    expect(isSenderAuthorizedForMessage('SET_ANALYTICS_CONSENT', undefined,
      { id, frameId: 0, tab: { url: 'https://www.twitch.tv/testchannel' } }, id)).toBe(false)
    expect(isSenderAuthorizedForMessage('SET_ANALYTICS_CONSENT', undefined,
      { id: 'other-extension', url: `chrome-extension://${id}/options/index.html` }, id)).toBe(false)
    expect(isSenderAuthorizedForMessage('PREPARE_ANALYTICS_CONSENT_GRANT', undefined,
      { id, url: `chrome-extension://${id}/options/index.html` }, id)).toBe(true)
    expect(isSenderAuthorizedForMessage('PREPARE_ANALYTICS_CONSENT_GRANT', undefined,
      { id, frameId: 0, tab: { url: 'https://www.twitch.tv/testchannel' } }, id)).toBe(false)
  })
})
