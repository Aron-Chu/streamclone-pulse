import { SUPPORTER_TENURES, supporterTenureForMonths, type SupporterTenure, type SupporterWave } from './supporterPaint.ts'

/**
 * Seen in chat: Supporter crests in Twitch chat, for other StreamPulse users.
 *
 * The server publishes one signed list of the Supporters who chose to be seen
 * (Twitch user ID, login, crest level, paint, wave). Every extension downloads
 * the whole list, with no channel, account or credential attached, and adds
 * crests to chat on its own computer. Twitch chat itself never changes and
 * nothing is sent to Twitch.
 *
 * Wire format v1 (spec: streampulse-sdlc artifacts/chat-badges-2026-10-10/SPEC.md §5.5):
 *
 *   SPB1 <kid> <sig>\n
 *   {"v":1,"env":"live","seq":…,"iat":…,"exp":…,"n":2,"u":[["12345678","somelogin",3,2,0],…]}
 *
 * `sig` is base64url (unpadded) Ed25519 over `"streampulse-badges-v1\0" ‖ docBytes`,
 * where docBytes is everything after the first newline, byte for byte. There is
 * no JSON canonicalization, so the server and this client cannot disagree.
 */

/** The consent copy the "In chat" card shows; a material change bumps it (pinned by tests). */
export const CHAT_BADGE_CONSENT_VERSION = 1
export const CHAT_BADGE_LIST_PATH = '/v1/billing/badges'
export const CHAT_BADGE_SIGNING_DOMAIN = 'streampulse-badges-v1\u0000'
export const CHAT_BADGE_MAX_BODY_BYTES = 4 * 1024 * 1024
export const CHAT_BADGE_MAX_ENTRIES = 120_000
export const CHAT_BADGE_MAX_LIFETIME_S = 7 * 86_400
export const CHAT_BADGE_CLOCK_SKEW_S = 600

/** Viewer settings (storage.sync, readable by the chat chunk). */
export const CHAT_CRESTS_KEY = 'chatSupporterCrestsEnabled'
export const CHAT_PAINT_MOTION_KEY = 'chatSupporterPaintMotion'
export const DEFAULT_CHAT_CRESTS = true
export const DEFAULT_CHAT_PAINT_MOTION = false

export type ChatBadgeEnvironment = 'live' | 'sandbox'
/** `[twitchUserId, login, tier 0–4, paint 0–3, wave 0–3]`: nothing else is published. */
export type ChatBadgeEntry = [string, string, number, number, number]
export interface ChatBadgeDoc {
  v: 1
  env: ChatBadgeEnvironment
  seq: number
  iat: number
  exp: number
  n: number
  u: ChatBadgeEntry[]
}

/** Tier code → crest stage; the same thresholds as the server's TenureForPeriods. */
export const CHAT_BADGE_TIERS: readonly SupporterTenure[] = SUPPORTER_TENURES.map(option => option.id)
/** Paint code → finish; 0 means no finish is equipped (crest only). */
export const CHAT_BADGE_PAINTS = [null, 'glass', 'etched', 'halo'] as const
export const CHAT_BADGE_WAVES: readonly SupporterWave[] = ['smooth', 'ripple', 'chrome', 'aurora']

export function tenureCode(supportPeriods: number): number {
  return CHAT_BADGE_TIERS.indexOf(supporterTenureForMonths(supportPeriods))
}

export function waveCode(wave: SupporterWave): number {
  return Math.max(0, CHAT_BADGE_WAVES.indexOf(wave))
}

export type ChatBadgeRejection =
  | 'too_large' | 'header' | 'unknown_kid' | 'signature' | 'json' | 'version' | 'environment'
  | 'seq' | 'time' | 'count' | 'entry' | 'no_ed25519'

export const TWITCH_USER_ID = /^[1-9][0-9]{0,19}$/
export const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/
const HEADER = /^SPB1 ([a-z0-9-]{1,32}) ([A-Za-z0-9_-]{86})$/
const KID = /^spb-(live|sandbox)-[0-9]{1,4}$/

/** A pinned verification key: the kid names its environment. */
export interface ChatBadgeKey { kid: string; key: string }

export function chatBadgeKeyEnvironment(kid: string): ChatBadgeEnvironment | null {
  const match = KID.exec(kid)
  return match ? match[1] as ChatBadgeEnvironment : null
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return null
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  try {
    const binary = atob(padded)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

const smallInt = (value: unknown, max: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max

export function isChatBadgeEntry(value: unknown): value is ChatBadgeEntry {
  return Array.isArray(value) && value.length === 5
    && typeof value[0] === 'string' && TWITCH_USER_ID.test(value[0])
    && typeof value[1] === 'string' && TWITCH_LOGIN.test(value[1])
    && smallInt(value[2], 4) && smallInt(value[3], 3) && smallInt(value[4], 3)
}

/**
 * Checks a parsed document. A signed document must be well-formed, so any bad
 * entry rejects the whole list instead of being skipped.
 */
export function validateChatBadgeDoc(value: unknown, expect: { env: ChatBadgeEnvironment; minSeq: number; nowS: number }): ChatBadgeDoc | ChatBadgeRejection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'json'
  const doc = value as Record<string, unknown>
  if (doc.v !== 1) return 'version'
  if (doc.env !== expect.env) return 'environment'
  if (!Number.isSafeInteger(doc.seq) || (doc.seq as number) < 0 || (doc.seq as number) < expect.minSeq) return 'seq'
  const iat = doc.iat
  const exp = doc.exp
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return 'time'
  if ((iat as number) > expect.nowS + CHAT_BADGE_CLOCK_SKEW_S || (exp as number) <= expect.nowS || (exp as number) - (iat as number) > CHAT_BADGE_MAX_LIFETIME_S || (exp as number) <= (iat as number)) return 'time'
  const u = doc.u
  if (!Array.isArray(u) || u.length > CHAT_BADGE_MAX_ENTRIES || doc.n !== u.length) return 'count'
  const ids = new Set<string>()
  for (const entry of u) {
    if (!isChatBadgeEntry(entry) || ids.has(entry[0])) return 'entry'
    ids.add(entry[0])
  }
  return { v: 1, env: expect.env, seq: doc.seq as number, iat: iat as number, exp: exp as number, n: u.length, u: u as ChatBadgeEntry[] }
}

export type ChatBadgeVerification =
  | { ok: true; doc: ChatBadgeDoc; kid: string; text: string }
  | { ok: false; reason: ChatBadgeRejection }

const encoder = new TextEncoder()

/**
 * Verifies a downloaded list against the keys pinned in this build. `minSeq`
 * refuses a rollback to an older list. Ed25519 in WebCrypto needs Chrome 137+
 * or Firefox 129+; without it the feature stays off (`no_ed25519`).
 */
export async function verifyChatBadgeList(body: Uint8Array | string, options: {
  keys: readonly ChatBadgeKey[]
  environments: readonly ChatBadgeEnvironment[]
  minSeq: (env: ChatBadgeEnvironment) => number
  nowS: number
  subtle: SubtleCrypto | undefined
}): Promise<ChatBadgeVerification> {
  const bytes = typeof body === 'string' ? encoder.encode(body) : body
  if (bytes.length > CHAT_BADGE_MAX_BODY_BYTES) return { ok: false, reason: 'too_large' }
  const newline = bytes.indexOf(0x0a)
  if (newline < 0 || newline > 160) return { ok: false, reason: 'header' }
  let header: string
  let text: string
  try {
    header = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, newline))
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, reason: 'header' }
  }
  const match = HEADER.exec(header)
  if (!match) return { ok: false, reason: 'header' }
  const [, kid, sig] = match
  const env = chatBadgeKeyEnvironment(kid)
  const pinned = options.keys.find(key => key.kid === kid)
  if (!env || !pinned || !options.environments.includes(env)) return { ok: false, reason: 'unknown_kid' }
  if (!options.subtle) return { ok: false, reason: 'no_ed25519' }
  const publicKey = base64UrlDecode(pinned.key)
  const signature = base64UrlDecode(sig)
  if (!publicKey || publicKey.length !== 32 || !signature || signature.length !== 64) return { ok: false, reason: 'signature' }
  const docBytes = bytes.subarray(newline + 1)
  const domain = encoder.encode(CHAT_BADGE_SIGNING_DOMAIN)
  const signed = new Uint8Array(domain.length + docBytes.length)
  signed.set(domain)
  signed.set(docBytes, domain.length)
  let key: CryptoKey
  try {
    key = await options.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify'])
  } catch {
    return { ok: false, reason: 'no_ed25519' }
  }
  let valid = false
  try {
    valid = await options.subtle.verify({ name: 'Ed25519' }, key, signature, signed)
  } catch {
    return { ok: false, reason: 'no_ed25519' }
  }
  if (!valid) return { ok: false, reason: 'signature' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(text.indexOf('\n') + 1))
  } catch {
    return { ok: false, reason: 'json' }
  }
  const doc = validateChatBadgeDoc(parsed, { env, minSeq: options.minSeq(env), nowS: options.nowS })
  if (typeof doc === 'string') return { ok: false, reason: doc }
  return { ok: true, doc, kid, text }
}

/** The chat chunk's view of the list: what the worker sends a decorating tab. */
export type ChatBadgesReply =
  | { type: 'CHAT_BADGES'; ver: string; exp: number; u: ChatBadgeEntry[] }
  | { type: 'CHAT_BADGES'; unchanged: true }
  | { type: 'CHAT_BADGES'; off: true }

/** Your own "Seen in chat" state, as the server's Supporter snapshot reports it. */
export type ChatBadgeOwnState = 'off' | 'on' | 'waiting' | 'paused'
export interface ChatBadgeSnapshot {
  available: boolean
  state: ChatBadgeOwnState
  login?: string
  wave?: SupporterWave
  consentVersion?: number
}

/** Parses the snapshot's `chatBadge` field; anything malformed is absent. */
export function parseChatBadgeSnapshot(value: unknown): ChatBadgeSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.available !== 'boolean') return undefined
  const state = raw.state === 'on' || raw.state === 'waiting' || raw.state === 'paused' ? raw.state : 'off'
  const out: ChatBadgeSnapshot = { available: raw.available, state }
  if (typeof raw.login === 'string' && TWITCH_LOGIN.test(raw.login)) out.login = raw.login
  if (typeof raw.wave === 'string' && (CHAT_BADGE_WAVES as readonly string[]).includes(raw.wave)) out.wave = raw.wave as SupporterWave
  if (Number.isSafeInteger(raw.consentVersion) && (raw.consentVersion as number) > 0) out.consentVersion = raw.consentVersion as number
  return out
}

/** Worker reply to the options page's "In chat" card. */
export type ChatBadgeActionError =
  | 'identity_mismatch' | 'supporter_required' | 'consent_outdated' | 'consent_required' | 'pilot_only' | 'twitch_in_use'
  | 'cancelled' | 'busy' | 'unavailable' | 'sign_in_required' | 'try_later' | 'network' | 'error'
export interface ChatBadgeStatus {
  /** A valid list has been received at least once on this browser: the viewer settings are shown. */
  listReceived: boolean
}
