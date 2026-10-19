import type { CSSProperties } from 'react'
import type { ExtensionEmote } from '../shared/messages.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'

const MAX_RECAP_EMOTES = 4

function formatEmoteCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Math.max(0, value))
}

export interface RecapTopEmotesRowProps {
  backendUrl: string
  emotes: ExtensionEmote[]
  compact?: boolean
}

export function RecapTopEmotesRow({ backendUrl, emotes, compact = false }: RecapTopEmotesRowProps) {
  const visible = emotes.filter(emote => emote.count > 0).slice(0, MAX_RECAP_EMOTES)
  if (visible.length === 0) return null

  return (
    <div className={compact ? 'pulse-rte-compact' : 'pulse-rte'}>
      <div className="pulse-rte-header">
        <span className="pulse-rte-title">Top emotes this stream</span>
        <span className="pulse-rte-hint">Plot emotes on the chart above.</span>
      </div>
      <div className={compact ? 'pulse-rte-grid-compact' : 'pulse-rte-grid'}>
        {visible.map((emote, index) => (
          <div
            key={emote.id ?? `${emote.name}-${index}`}
            className="pulse-rte-cell"
            title={emote.name}
          >
            <span className="pulse-rte-rank">{index + 1}</span>
            <PulseEmoteImg
              backendUrl={backendUrl}
              emote={emote}
              width={compact ? 24 : 28}
              height={compact ? 24 : 28}
              style={cellImgStyle}
            />
            <span className="pulse-rte-name">{emote.name}</span>
            <span className="pulse-rte-count">{formatEmoteCount(emote.count)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Passed on to PulseEmoteImg, which takes a style prop. */
const cellImgStyle: CSSProperties = { display: 'block', flexShrink: 0, objectFit: 'contain' }
