/**
 * Decorative landing emotes — 7TV-dominant culture set plus a few Twitch globals.
 *
 * 7TV IDs were resolved from the live 7TV global emote set
 * (https://7tv.io/v3/emote-sets/global). Twitch IDs use the public Twitch CDN.
 * Images are decorative only (aria-hidden); failed loads fall back to text.
 */
export type LandingEmoteProvider = 'sevenTv' | 'twitch'

export interface LandingEmote {
  name: string
  id: string
  provider: LandingEmoteProvider
}

/** 7TV-heavy set used for rain, chat backdrop, and ticker fallbacks. */
export const LANDING_EMOTES: LandingEmote[] = [
  // Speed-culture wide emotes (verified via 7TV v4 search)
  { name: 'degloved', id: '01KCAC3BFZSWKZR16ER0810D08', provider: 'sevenTv' },
  { name: 'widespeedlaugh', id: '01HR89NJZ0000FC75JXX9NJ9M1', provider: 'sevenTv' },
  { name: 'widereacting', id: '01HMM8VG3R0007GXBD883VP2YY', provider: 'sevenTv' },
  { name: 'peepoHappy', id: '01GAZ199Z8000FEWHS6AT5QZV0', provider: 'sevenTv' },
  { name: 'peepoSad', id: '01GAZ4SBX80007YCE2RXBT44B2', provider: 'sevenTv' },
  { name: 'FeelsDankMan', id: '01GB9W8JN80004CKF2H1TWA99H', provider: 'sevenTv' },
  { name: 'forsenPls', id: '01GB8EQNJ8000497KFBZWNSDFZ', provider: 'sevenTv' },
  { name: 'WAYTOODANK', id: '01G98W833R0000BRQD106P0ZNT', provider: 'sevenTv' },
  { name: 'gachiBASS', id: '01GB4P2HX0000BJ5HR8F6XV9Q0', provider: 'sevenTv' },
  { name: 'PepePls', id: '01GAFTZ9K80003DHH026MC7JW0', provider: 'sevenTv' },
  { name: 'Clap', id: '01GAM8EFQ00004MXFXAJYKA859', provider: 'sevenTv' },
  { name: 'AlienDance', id: '01GB2ZJFBG000DTBJYANG8XYFP', provider: 'sevenTv' },
  { name: 'peepoPls', id: '01HM524VE80004SKSHMCZWXH1T', provider: 'sevenTv' },
  { name: 'PETPET', id: '01FE3XY508000AA32JP519W2EW', provider: 'sevenTv' },
  { name: 'PartyParrot', id: '01FKSDK14G0008TM5NY9QEG0QV', provider: 'sevenTv' },
  { name: 'ppL', id: '01GGD5PJA8000FH13S498E9D8X', provider: 'sevenTv' },
  { name: 'BillyApprove', id: '01GB2S7H7000018VJGJ4A9BMFS', provider: 'sevenTv' },
  // Twitch globals — used sparingly where they still show up in chat
  { name: 'Kappa', id: '304894101', provider: 'twitch' },
  { name: 'LUL', id: '425618', provider: 'twitch' },
  { name: 'PogChamp', id: '305954156', provider: 'twitch' },
  { name: 'OMEGALUL', id: '583989', provider: 'twitch' },
  { name: 'KEKW', id: '305954168', provider: 'twitch' },
]

/** @deprecated Use LANDING_EMOTES */
export const SEVENTV_EMOTES = LANDING_EMOTES.filter((e) => e.provider === 'sevenTv')

/** @deprecated Use LANDING_EMOTES */
export const TWITCH_LANDING_EMOTES = LANDING_EMOTES

const EMOTE_BY_NAME = new Map<string, LandingEmote>(
  LANDING_EMOTES.map((emote) => [emote.name.toLowerCase(), emote]),
)

export function findLandingEmote(name: string): LandingEmote | undefined {
  return EMOTE_BY_NAME.get(name.trim().toLowerCase())
}

export function seventvImageUrl(id: string, size: '1x' | '2x' | '3x' | '4x' = '2x'): string {
  const scale = size === '1x' ? '1' : size === '2x' ? '2' : size === '3x' ? '3' : '4'
  return `https://cdn.7tv.app/emote/${id}/${scale}x.webp`
}

export function twitchEmoteImageUrl(id: string, scale: '1.0' | '2.0' | '3.0' = '2.0'): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/${scale}`
}

/** Resolve a CDN image for a landing emote record. */
export function landingEmoteImageUrl(
  emote: LandingEmote,
  size: '1x' | '2x' | '3x' = '2x',
): string {
  if (emote.provider === 'twitch') {
    const scale = size === '1x' ? '1.0' : size === '2x' ? '2.0' : '3.0'
    return twitchEmoteImageUrl(emote.id, scale)
  }
  return seventvImageUrl(emote.id, size === '3x' ? '3x' : size === '1x' ? '1x' : '2x')
}

/** Lookup by emote name; undefined when unmapped. */
export function landingEmoteImageByName(name: string, size: '1x' | '2x' = '2x'): string | undefined {
  const emote = findLandingEmote(name)
  return emote ? landingEmoteImageUrl(emote, size) : undefined
}
