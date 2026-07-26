import type { ReactNode } from 'react'
import { LineChart, MessageSquare, Smile, Video } from 'lucide-react'
import type { HubCorpus } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact } from './hubFormat'

interface CorpusSummaryCardsProps {
  corpus: HubCorpus
  loading?: boolean
}

interface Card {
  key: string
  label: string
  value: number
  sub: string
  accent: string
  tone: string
  icon: ReactNode
}

export function CorpusSummaryCards({ corpus, loading = false }: CorpusSummaryCardsProps) {
  if (loading) {
    return (
      <div className="dash-sumgrid" aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} height={120} radius="calc(var(--sc-radius) + 0.25rem)" />
        ))}
      </div>
    )
  }

  const cards: Card[] = [
    {
      key: 'streams',
      label: 'Streams tracked',
      value: corpus.streamsTracked,
      sub: 'public sessions indexed',
      accent: 'hsl(var(--sc-chart-1))',
      tone: 'hsl(var(--sc-chart-1) / 0.15)',
      icon: <LineChart aria-hidden="true" />,
    },
    {
      key: 'chat',
      label: 'Chat processed',
      value: corpus.chatMessagesProcessed,
      sub: 'messages in corpus',
      accent: 'hsl(var(--sc-chart-2))',
      tone: 'hsl(var(--sc-chart-2) / 0.15)',
      icon: <MessageSquare aria-hidden="true" />,
    },
    {
      key: 'emotes',
      label: 'Emotes indexed',
      value: corpus.emotesIndexed,
      sub: 'tracked emote events',
      accent: 'hsl(var(--sc-chart-3))',
      tone: 'hsl(var(--sc-chart-3) / 0.15)',
      icon: <Smile aria-hidden="true" />,
    },
    {
      key: 'vods',
      label: 'VODs analyzed',
      value: corpus.vodsAnalyzed,
      sub: 'coverage windows verified',
      accent: 'hsl(var(--sc-chart-4))',
      tone: 'hsl(var(--sc-chart-4) / 0.15)',
      icon: <Video aria-hidden="true" />,
    },
  ]

  return (
    <div className="dash-sumgrid">
      {cards.map((card) => (
        <div className="dash-card dash-sum" key={card.key} style={{ ['--accentc' as string]: card.accent }}>
          <div className="hd">
            <span className="lab">{card.label}</span>
            <span className="ic" style={{ background: card.tone, color: card.accent }}>
              {card.icon}
            </span>
          </div>
          <div className="big sc-tnum">{card.value > 0 ? `${compact(card.value)}+` : '0'}</div>
          <div className="sub">{card.sub}</div>
        </div>
      ))}
    </div>
  )
}
