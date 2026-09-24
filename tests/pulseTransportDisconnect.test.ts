import { describe, expect, it } from 'vitest'
import {
  backgroundErrorCode,
  backgroundErrorMessage,
  EXTENSION_RECONNECT_MESSAGE,
} from '../src/shared/backgroundResponse.ts'
import { resolveOverlayErrorState } from '../src/shared/pulseError.ts'

/**
 * A worker that never answers must not look like empty data.
 *
 * `sendBackgroundMessage` resolves with `{ ok: false, error: … }` rather than
 * throwing when a tab's extension context has been invalidated — which happens
 * to every open Twitch tab whenever the extension reloads. The content entry
 * used to drop that envelope on the floor, so the panel sat on "Loading Pulse"
 * indefinitely with nothing saying a refresh would fix it.
 */
const INVALIDATED = { ok: false, error: 'extension_context_invalidated' }

describe('pulse transport disconnect', () => {
  it('recognises an invalidated context as a failure, not as absent data', () => {
    expect(backgroundErrorCode(INVALIDATED)).toBe('extension_context_invalidated')
    expect(backgroundErrorMessage(INVALIDATED, 'fallback')).toBe(EXTENSION_RECONNECT_MESSAGE)
    expect(backgroundErrorMessage({ ok: false, error: 'Receiving end does not exist' }, 'fallback'))
      .toBe(EXTENSION_RECONNECT_MESSAGE)
  })

  it('treats a response with no envelope as a failure rather than success', () => {
    // The shape `entry.ts` guards against: anything that is not a PULSE_UPDATE.
    expect(backgroundErrorCode(undefined)).toBe('unexpected_response')
    expect(backgroundErrorCode(null)).toBe('unexpected_response')
    expect(backgroundErrorMessage(undefined, EXTENSION_RECONNECT_MESSAGE)).toBe(EXTENSION_RECONNECT_MESSAGE)
  })

  it('still reports success envelopes as having no error', () => {
    expect(backgroundErrorCode({ type: 'PULSE_UPDATE', login: 'a', payload: null })).toBeNull()
    expect(backgroundErrorMessage({ ok: true }, 'fallback')).toBeNull()
  })

  it('surfaces a transport error without discarding the chart already on screen', () => {
    // updateOverlayPayload(null, message) leaves currentPayload untouched and
    // only moves the error lane, so a transient failure cannot blank the panel.
    expect(resolveOverlayErrorState(undefined, null, EXTENSION_RECONNECT_MESSAGE)).toBe(EXTENSION_RECONNECT_MESSAGE)
    // A later good payload clears it again.
    expect(resolveOverlayErrorState(EXTENSION_RECONNECT_MESSAGE, { streamId: 's1' }, undefined)).toBeUndefined()
  })

  it('keeps the reconnect message free of surface-specific wording', () => {
    // The overlay panel renders this string too, so it cannot say "settings".
    expect(EXTENSION_RECONNECT_MESSAGE).not.toMatch(/settings/i)
    expect(EXTENSION_RECONNECT_MESSAGE).toMatch(/reload this page/i)
  })
})
