import { describe, expect, it } from 'vitest'
import { verifiedArchiveArtwork } from '../src/lib/archiveArtwork'

const art = { vodId: '123456', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/archive/thumb/thumb0-640x360.jpg' }
describe('verified archive artwork', () => {
  it('retains the binding to the exact archive', () => {
    expect(verifiedArchiveArtwork(art, '123456')).toEqual(art)
    expect(verifiedArchiveArtwork(art, '654321')).toBeUndefined()
  })
  it.each([
    'https://static-cdn.jtvnw.net/previews-ttv/live_user_dona.jpg',
    'https://evil.example/cf_vods/a/thumb/b.jpg',
    'https://user:password@static-cdn.jtvnw.net/cf_vods/a/thumb/b.jpg',
    'https://static-cdn.jtvnw.net/cf_vods/a/thumb/b.jpg?token=secret',
  ])('rejects untrusted or mutable artwork %s', url => {
    expect(verifiedArchiveArtwork({ ...art, url }, '123456')).toBeUndefined()
  })
})
