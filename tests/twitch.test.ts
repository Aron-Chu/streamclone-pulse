import { describe, expect, it } from 'vitest'
import { parseChannelLogin } from '../src/content/twitch.ts'

describe('parseChannelLogin', () => {
  it('parses channel paths', () => {
    expect(parseChannelLogin('/xqc')).toBe('xqc')
    expect(parseChannelLogin('/xqc/')).toBe('xqc')
  })

  it('ignores reserved routes', () => {
    expect(parseChannelLogin('/directory')).toBeNull()
  })
})
