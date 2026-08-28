import { Activity, MessageSquare, Sparkles } from 'lucide-react'
import type { NewsroomNetworkBrief } from '../../../lib/newsroom'

export interface NetworkBriefProps {
  brief: NewsroomNetworkBrief
}

function changeLabel(value: number | undefined): string {
  if (value == null) return 'Unavailable'
  if (Math.abs(value) < 0.5) return 'About even'
  return `${value > 0 ? '+' : ''}${Math.round(value)}%`
}

export function NetworkBrief({ brief }: NetworkBriefProps) {
  return (
    <section className="newsroom-network-brief" aria-labelledby="newsroom-network-title">
      <header>
        <Activity aria-hidden="true" />
        <div>
          <h2 id="newsroom-network-title">Network brief</h2>
          <p>Latest closed 30 minutes versus the prior 30, using the same measured channels.</p>
        </div>
      </header>
      <dl>
        <div><dt><MessageSquare aria-hidden="true" />Chat</dt><dd>{changeLabel(brief.chatChangePct)}</dd></div>
        <div><dt><Sparkles aria-hidden="true" />Emotes</dt><dd>{changeLabel(brief.emoteChangePct)}</dd></div>
        <div><dt>Comparable channels</dt><dd>{brief.comparableChannels}</dd></div>
        <div><dt>Temporal coverage</dt><dd>{Math.round(brief.coveragePct)}%</dd></div>
      </dl>
      <p className="newsroom-network-brief__window">
        Current <time dateTime={brief.currentStart}>{new Date(brief.currentStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>–<time dateTime={brief.currentEnd}>{new Date(brief.currentEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
        {' · '}Earlier <time dateTime={brief.baselineStart}>{new Date(brief.baselineStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>–<time dateTime={brief.baselineEnd}>{new Date(brief.baselineEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
      </p>
    </section>
  )
}
