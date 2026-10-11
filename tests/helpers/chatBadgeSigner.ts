import { createPrivateKey, createPublicKey, sign } from 'node:crypto'

/**
 * Signs Seen in chat lists in tests with throwaway keys. The fixed seed is 32
 * bytes of 0x07, the same public test seed the backend's golden vector uses;
 * it is pinned only by development builds (scripts/chat-badge-keys.mjs) and
 * never by a store build. No production key is created or read here.
 */
export const TEST_SEED = Buffer.alloc(32, 7)
export const TEST_KID = 'spb-sandbox-7'
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const DOMAIN = Buffer.from('streampulse-badges-v1\u0000', 'utf8')

function privateKey(seed: Buffer) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

export function publicKeyFor(seed: Buffer = TEST_SEED): string {
  const spki = createPublicKey(privateKey(seed)).export({ format: 'der', type: 'spki' })
  return Buffer.from(spki.subarray(spki.length - 32)).toString('base64url')
}

export type Entry = [string, string, number, number, number]

export function makeDoc(entries: Entry[], options: { env?: string; seq?: number; iat?: number; exp?: number } = {}): string {
  const iat = options.iat ?? Math.floor(Date.now() / 1000)
  const doc = { v: 1, env: options.env ?? 'sandbox', seq: options.seq ?? iat, iat, exp: options.exp ?? iat + 36 * 3600, n: entries.length, u: entries }
  return JSON.stringify(doc)
}

/** `SPB1 <kid> <sig>\n<doc>`, signing the exact doc bytes after the domain prefix. */
export function signList(docText: string, options: { seed?: Buffer; kid?: string } = {}): string {
  const docBytes = Buffer.from(docText, 'utf8')
  const signature = sign(null, Buffer.concat([DOMAIN, docBytes]), privateKey(options.seed ?? TEST_SEED))
  return `SPB1 ${options.kid ?? TEST_KID} ${signature.toString('base64url')}\n${docText}`
}

/** A synthetic list of `count` entries; `hits` of them carry the given logins. */
export function syntheticEntries(count: number, prefix = 'u'): Entry[] {
  const out: Entry[] = []
  for (let i = 0; i < count; i++) out.push([String(100_000_000 + i), `${prefix}${i.toString(36)}`.slice(0, 25), i % 5, i % 4, (i >> 2) % 4])
  return out
}
