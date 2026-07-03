import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { findLandingEmote, landingEmoteImageUrl } from './landingEmotes'

interface ChatLine {
  user: string
  color: string
  text: string
  /** Emote name resolved against the landing emote map. */
  emote?: string
}

/** Realistic Twitch username colors — muted vs neon. */
const NAME_COLORS = [
  '#FF4500',
  '#1E90FF',
  '#9147FF',
  '#008000',
  '#B22222',
  '#FF69B4',
  '#5C16C5',
  '#DAA520',
  '#20B2AA',
  '#CD5C5C',
  '#4682B4',
  '#9ACD32',
] as const

const LEFT_LINES: ChatLine[] = [
  { user: 'speed7tv', color: NAME_COLORS[0], text: 'nahhh that clip', emote: 'widespeedlaugh' },
  { user: 'xqcL_', color: NAME_COLORS[1], text: 'W', emote: 'degloved' },
  { user: 'marcus_tt', color: NAME_COLORS[2], text: 'bro what was that' },
  { user: 'peepoVIP', color: NAME_COLORS[3], text: '', emote: 'widereacting' },
  { user: 'clip_it_pls', color: NAME_COLORS[4], text: 'someone clip that' },
  { user: '7tvAndy', color: NAME_COLORS[5], text: '7tv carrying chat fr', emote: 'WAYTOODANK' },
  { user: 'lurker_mode', color: NAME_COLORS[6], text: 'just got here' },
  { user: 'night_owl_x', color: NAME_COLORS[7], text: 'LMAO', emote: 'gachiBASS' },
  { user: 'sub_w_gift', color: NAME_COLORS[8], text: 'ty for the sub' },
  { user: 'toastEnjoyer', color: NAME_COLORS[9], text: 'mods??' },
  { user: 'kai_fan42', color: NAME_COLORS[10], text: 'chat is moving' },
  { user: 'noCap_fr', color: NAME_COLORS[11], text: '00:42 was insane', emote: 'Clap' },
]

const RIGHT_LINES: ChatLine[] = [
  { user: 'emilystreams', color: NAME_COLORS[1], text: 'that was insane', emote: 'widespeedlaugh' },
  { user: 'vod_gang', color: NAME_COLORS[2], text: 'watching VOD after' },
  { user: 'react_goblin', color: NAME_COLORS[3], text: '', emote: 'degloved' },
  { user: 'bigSpender99', color: NAME_COLORS[4], text: 'W stream' },
  { user: 'casual_viewer', color: NAME_COLORS[5], text: 'what happened lol', emote: 'widereacting' },
  { user: 'analytics_nerd', color: NAME_COLORS[6], text: 'opening pulse tab' },
  { user: 'gifted_sub_x', color: NAME_COLORS[7], text: 'lets goooo', emote: 'peepoHappy' },
  { user: 'ranked_grind', color: NAME_COLORS[8], text: 'one more' },
  { user: 'chat_spam_lol', color: NAME_COLORS[9], text: '', emote: 'forsenPls' },
  { user: 'honest_take', color: NAME_COLORS[10], text: 'nahhh', emote: 'FeelsDankMan' },
  { user: 'moment_hunter', color: NAME_COLORS[11], text: 'jump to the spike' },
  { user: 'twitch_native', color: NAME_COLORS[0], text: 'Kappa', emote: 'Kappa' },
]

function buildColumnLines(seed: ChatLine[], repeat = 3): ChatLine[] {
  const out: ChatLine[] = []
  for (let i = 0; i < repeat; i += 1) {
    for (const line of seed) {
      out.push(line)
    }
  }
  return out
}

function lineKey(line: ChatLine, index: number, side: 'left' | 'right'): string {
  return `${side}-${line.user}-${index}`
}

interface ChatColumnProps {
  side: 'left' | 'right'
  lines: ChatLine[]
  style: CSSProperties
}

function ChatColumn({ side, lines, style }: ChatColumnProps) {
  return (
    <div className={`sl-chatbg__col sl-chatbg__col--${side}`}>
      <div className="sl-chatbg__inner" style={style}>
        <div className="sl-chatbg__track">
          {lines.map((line, index) => (
            <ChatLineRow key={lineKey(line, index, side)} line={line} />
          ))}
        </div>
        <div className="sl-chatbg__track" aria-hidden="true">
          {lines.map((line, index) => (
            <ChatLineRow key={`dup-${lineKey(line, index, side)}`} line={line} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Decorative ambient Twitch chat columns for the landing hero backdrop.
 * Purely presentational (aria-hidden); disabled under prefers-reduced-motion
 * and hidden on narrow viewports via landing.css.
 */
export function TwitchChatBackdrop() {
  const leftLines = useMemo(() => buildColumnLines(LEFT_LINES), [])
  const rightLines = useMemo(() => buildColumnLines(RIGHT_LINES), [])

  const leftStyle = useMemo<CSSProperties>(
    () => ({
      animationDuration: '38s',
      animationDelay: '-12s',
    }),
    [],
  )
  const rightStyle = useMemo<CSSProperties>(
    () => ({
      animationDuration: '44s',
      animationDelay: '-6s',
    }),
    [],
  )

  return (
    <div className="sl-chatbg" aria-hidden="true">
      <ChatColumn side="left" lines={leftLines} style={leftStyle} />
      <ChatColumn side="right" lines={rightLines} style={rightStyle} />
    </div>
  )
}

function ChatLineRow({ line }: { line: ChatLine }) {
  const emote = line.emote ? findLandingEmote(line.emote) : undefined

  return (
    <p className="sl-chatbg__line">
      <span className="sl-chatbg__user" style={{ color: line.color }}>
        {line.user}:
      </span>{' '}
      {line.text ? <span className="sl-chatbg__msg">{line.text}</span> : null}
      {emote ? (
        <img
          className="sl-chatbg__emote"
          src={landingEmoteImageUrl(emote, '1x')}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : null}
    </p>
  )
}
