import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sameEmoteKey } from '../src/emoteKey.ts'

describe('sameEmoteKey', () => {
  it('matches a rollup key to its summary key across ids', () => {
    assert.equal(sameEmoteKey('seventv:LOL:LOL', 'seventv:9ceb7717:LOL'), true)
    assert.equal(sameEmoteKey('7tv:Clap:Clap', 'seventv:62a3bf57:clap'), true)
  })

  it('keeps same-named emotes from different providers apart', () => {
    assert.equal(sameEmoteKey('seventv:Clap:Clap', 'bttv:55b6f480:Clap'), false)
    assert.equal(sameEmoteKey('bttv:Clap:Clap', 'seventv:62a3bf57:Clap'), false)
  })

  it('falls back to the name when a key has no provider', () => {
    assert.equal(sameEmoteKey('Clap', 'bttv:55b6f480:Clap'), true)
    assert.equal(sameEmoteKey('seventv:62a3bf57:Clap', 'Clap'), true)
    assert.equal(sameEmoteKey('Clap', 'LUL'), false)
    assert.equal(sameEmoteKey('seventv:x: ', 'bttv:y: '), false)
  })
})
