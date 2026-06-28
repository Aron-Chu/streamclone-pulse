/**
 * Real 7TV emotes used for the decorative landing background + tickers.
 *
 * IDs were resolved from the live 7TV global emote set
 * (https://7tv.io/v3/emote-sets/global). Images are served from the public 7TV
 * CDN; the portal CSP allows `img-src https:` so these load in production.
 *
 * These are decorative only (the rain is aria-hidden); if the CDN is blocked or
 * an image fails, the EmoteRain falls back to the emote name as styled text.
 */
export interface SeventvEmote {
  name: string
  id: string
}

export const SEVENTV_EMOTES: SeventvEmote[] = [
  { name: 'peepoHappy', id: '01GAZ199Z8000FEWHS6AT5QZV0' },
  { name: 'peepoSad', id: '01GAZ4SBX80007YCE2RXBT44B2' },
  { name: 'FeelsDankMan', id: '01GB9W8JN80004CKF2H1TWA99H' },
  { name: 'forsenPls', id: '01GB8EQNJ8000497KFBZWNSDFZ' },
  { name: 'WAYTOODANK', id: '01G98W833R0000BRQD106P0ZNT' },
  { name: 'gachiBASS', id: '01GB4P2HX0000BJ5HR8F6XV9Q0' },
  { name: 'PepePls', id: '01GAFTZ9K80003DHH026MC7JW0' },
  { name: 'ppL', id: '01GGD5PJA8000FH13S498E9D8X' },
  { name: 'Clap', id: '01GAM8EFQ00004MXFXAJYKA859' },
  { name: 'PartyParrot', id: '01FKSDK14G0008TM5NY9QEG0QV' },
  { name: 'AlienDance', id: '01GB2ZJFBG000DTBJYANG8XYFP' },
  { name: 'BillyApprove', id: '01GB2S7H7000018VJGJ4A9BMFS' },
  { name: 'ApuApustaja', id: '01GGCQPCGR000C7MT8JZGP6E89' },
  { name: 'RainTime', id: '01FCY771D800007PQ2DF3GDTN6' },
  { name: 'PETPET', id: '01FE3XY508000AA32JP519W2EW' },
  { name: 'reckH', id: '01F014S6KG0007E4VV006YKSM3' },
  { name: 'peepoPls', id: '01HM524VE80004SKSHMCZWXH1T' },
  { name: 'Gayge', id: '01G4GQC5H0000D3DGNAYJJP8EB' },
]

/** 7TV CDN image URL for an emote id (size: 1x | 2x | 3x | 4x). */
export function seventvImageUrl(id: string, size: '1x' | '2x' | '3x' | '4x' = '2x'): string {
  return `https://cdn.7tv.app/emote/${id}/${size}.webp`
}
