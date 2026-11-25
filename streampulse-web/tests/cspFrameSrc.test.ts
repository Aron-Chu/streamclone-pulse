/**
 * Which sites this site may show in a frame (frame-src), in both places the rule lives: the Pages header and the
 * index.html meta. The front page's chat band (11-22) added Twitch's chat, https://www.twitch.tv; nothing else may
 * slip in with it, and nearby Twitch hosts stay refused.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(__dirname, '..')

function frameSrc(policy: string): string[] {
  const directive = policy.split(';').map(part => part.trim()).find(part => part.startsWith('frame-src '))
  expect(directive, 'frame-src directive').toBeTruthy()
  return directive!.split(/\s+/).slice(1).sort()
}

function headerPolicy(): string {
  const headers = readFileSync(resolve(webRoot, 'public/_headers'), 'utf8')
  const line = headers.split(/\r?\n/).find(l => /^\s+Content-Security-Policy:/.test(l))
  expect(line, 'enforced Content-Security-Policy in _headers').toBeTruthy()
  return line!.replace(/^\s+Content-Security-Policy:\s*/, '')
}

function metaPolicy(): string {
  const html = readFileSync(resolve(webRoot, 'index.html'), 'utf8')
  const meta = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0] ?? ''
  const content = meta.match(/content="([^"]+)"/i)?.[1]
  expect(content, 'Content-Security-Policy meta in index.html').toBeTruthy()
  return content!
}

const REFUSED = ['https://twitch.tv', 'https://*.twitch.tv', 'https://m.twitch.tv', 'https:', '*', "'self'", 'http://www.twitch.tv']

describe('frame-src', () => {
  it('in _headers: Turnstile, Twitch player, clips and chat, nothing else', () => {
    const hosts = frameSrc(headerPolicy())
    expect(hosts).toEqual(['https://challenges.cloudflare.com', 'https://clips.twitch.tv', 'https://player.twitch.tv', 'https://www.twitch.tv'])
    for (const refused of REFUSED) expect(hosts).not.toContain(refused)
  })

  it('in the index.html meta: Turnstile, Twitch player and chat, nothing else', () => {
    // clips.twitch.tv is missing here (it predates the chat band); the meta never widens past _headers
    const hosts = frameSrc(metaPolicy())
    expect(hosts).toEqual(['https://challenges.cloudflare.com', 'https://player.twitch.tv', 'https://www.twitch.tv'])
    for (const refused of REFUSED) expect(hosts).not.toContain(refused)
    for (const host of hosts) expect(frameSrc(headerPolicy())).toContain(host)
  })
})
