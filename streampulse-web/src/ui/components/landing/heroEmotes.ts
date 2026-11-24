import { twitchEmoteImageUrl } from './landingEmotes'

/**
 * The stored set the front page's emote rain and chat columns draw from: 39 popular emotes, 32 of them 7TV
 * (Aron's round-3 board, 11-22: "a storage of like 20-40 emotes randomized", 7TV heavy). A shuffled deck
 * deals them so many different emotes show at once and each comes up before any repeats.
 *
 * Texture only: no count or claim is attached to an emote here.
 */
export interface HeroEmote {
  name: string
  id: string
  provider: '7tv' | 'twitch'
  /** Animated emotes load the animated file; stills load the smaller still. */
  animated: boolean
  /** Width over height, so a wide emote keeps its shape. */
  aspect: number
}

const S7 = (name: string, id: string, animated: boolean, aspect = 1): HeroEmote => ({ name, id, provider: '7tv', animated, aspect })
const TW = (name: string, id: string): HeroEmote => ({ name, id, provider: 'twitch', animated: false, aspect: 1 })

export const HERO_EMOTES: readonly HeroEmote[] = [
  S7('wideSpeedLaugh', '01HR89NJZ0000FC75JXX9NJ9M1', true, 96 / 31),
  S7('wideReacting', '01HMM8VG3R0007GXBD883VP2YY', true, 96 / 29),
  S7('KEKW', '01F61B1440000991F7SWQNMVX7', false),
  S7('ICANT', '01FA0PBXM8000AD7Y8T9ZMTFZ5', false),
  S7('OMEGALUL', '01F00Z3A9G0007E4VV006YKSK9', false),
  S7('Clap', '01GAM8EFQ00004MXFXAJYKA859', true, 22 / 32),
  S7('xdd', '01FF3R5C30000FF5VVCKV49G6J', false, 57 / 32),
  S7('catJAM', '01F6MQ33FG000FFJ97ZB8MWV52', true),
  S7('Aware', '01FFWH9WV80000JT8GHDKHJNZC', true, 35 / 32),
  S7('Sadge', '01EZPG1FN80001SNAW00ADK2DY', false, 42 / 32),
  S7('GIGACHAD', '01F6MZGCNG000255K4X1K7NTHR', true),
  S7('PepeLaugh', '01F6Q76NN80005589X3BDK9CN1', true),
  S7('WAYTOODANK', '01G98W833R0000BRQD106P0ZNT', true, 28 / 32),
  S7('Clueless', '01F6T8NM9R0007M5BTFWSP1YSJ', false, 36 / 32),
  S7('monkaS', '01F78CHJ2G0005TDSTZFBDGMK4', false),
  S7('Stare', '01FA0WRBM0000AD7Y8T9ZJEDXQ', false, 37 / 32),
  S7('EZ', '01F9FS6EEG0006XXD6DX0K9Y04', false),
  S7('LULW', '01F22WE74G000F9Q0G00A2DE8N', false, 28 / 32),
  S7('peepoHappy', '01GAZ199Z8000FEWHS6AT5QZV0', false),
  S7('forsenPls', '01GB8EQNJ8000497KFBZWNSDFZ', true, 43 / 32),
  S7('PepePls', '01GAFTZ9K80003DHH026MC7JW0', true, 24 / 32),
  S7('FeelsDankMan', '01GB9W8JN80004CKF2H1TWA99H', false, 28 / 32),
  S7('Okayge', '01F7GJ0N4R00074A83FVHRDMDB', false, 42 / 32),
  S7('Bedge', '01F6MXJD8R000F76KNAAV5HDGD', false),
  S7('HUH', '01FKKW7C1G0008TM5NY9QEFEDW', true),
  S7('COPIUM', '01F6ME7ADR0000WDA7ERT9H30R', true),
  S7('Chatting', '01FAK9C8MR0004HKF2ZK1YPQ5A', true),
  S7('modCheck', '01F6FTE8B80008E39HFFQJ7MWS', true),
  S7('Susge', '01F6S7PENR0008HT14D95H43BY', false, 42 / 32),
  S7('Deadge', '01F8YE5QNR00081476FRV8XDEZ', false),
  S7('YIPPEE', '01G9JW7WY80003SW3KYSMQE9YY', true, 30 / 32),
  S7('monkaW', '01F6NPHCN0000BEKN8ZXWQNSDC', false),
  TW('PogChamp', '305954156'),
  TW('LUL', '425618'),
  // Kappa is Twitch emote 25 (304894101 is a different emote).
  TW('Kappa', '25'),
  TW('Kreygasm', '41'),
  TW('NotLikeThis', '58765'),
  TW('4Head', '354'),
  TW('ResidentSleeper', '245'),
]

const BY_NAME = new Map(HERO_EMOTES.map((e) => [e.name, e]))

export function findHeroEmote(name: string | null | undefined): HeroEmote | undefined {
  return name ? BY_NAME.get(name) : undefined
}

/** The smallest file: 7TV 1x (animated AVIF, else the still WebP), Twitch 1.0. */
export function heroEmoteUrl(emote: HeroEmote): string {
  if (emote.provider === 'twitch') return twitchEmoteImageUrl(emote.id, '1.0')
  return `https://cdn.7tv.app/emote/${emote.id}/1x.${emote.animated ? 'avif' : 'webp'}`
}

/** Wide emotes are mostly photos of faces and catch the eye most, so the rain limits how many fall at once. */
export const isWideEmote = (emote: HeroEmote): boolean => emote.aspect > 1.6

/**
 * A shuffle bag: deals every item once, in a random order, before any repeats. `skip` passes over items
 * the caller cannot use right now (a third wide emote, one whose picture failed to load).
 */
export function emoteDeck<T>(items: readonly T[], rand: () => number = Math.random): (skip?: (item: T) => boolean) => T | undefined {
  let deck: T[] = []
  return (skip) => {
    for (let tries = 0; tries < items.length * 2; tries++) {
      if (!deck.length) {
        deck = items.slice()
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1))
          ;[deck[i], deck[j]] = [deck[j], deck[i]]
        }
      }
      const item = deck.pop() as T
      if (!skip || !skip(item)) return item
    }
    return undefined
  }
}
