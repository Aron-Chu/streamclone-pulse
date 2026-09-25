import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseEmoteKey } from '../src/emoteKey.ts'
import { resolveEmoteImageUrl } from '../src/emoteImageUrl.ts'

describe('emote image identity', () => {
  it('recognizes the portal 7tv provider alias without treating a name as an image ID', () => {
    const placeholder = parseEmoteKey('7tv:Clap:Clap')
    assert.deepEqual(placeholder, { provider: 'seventv', id: 'Clap', name: 'Clap' })
    assert.equal(resolveEmoteImageUrl({ provider: placeholder.provider, id: placeholder.id }), '')
    assert.equal(resolveEmoteImageUrl({ provider: 'unknown', id: 'Clap' }), '')
    assert.equal(resolveEmoteImageUrl({ provider: 'unknown', id: 'Clap', imageUrl: '/emotes/Clap/1x.webp' }), '')
  })

  it('preserves valid provider IDs, explicit URLs, and local UUIDs', () => {
    const id = '62a3bf572b964d6cc2766004'
    assert.equal(
      resolveEmoteImageUrl({ provider: '7tv', id }),
      `https://cdn.7tv.app/emote/${id}/4x.webp`,
    )
    assert.equal(
      resolveEmoteImageUrl({ provider: '7tv', id: 'Clap', imageUrl: `https://cdn.7tv.app/emote/${id}/1x.webp` }),
      `https://cdn.7tv.app/emote/${id}/1x.webp`,
    )
    assert.equal(
      resolveEmoteImageUrl({ provider: 'unknown', id: '550e8400-e29b-41d4-a716-446655440000' }),
      '/emotes/550e8400-e29b-41d4-a716-446655440000/1x.webp',
    )
  })
})
