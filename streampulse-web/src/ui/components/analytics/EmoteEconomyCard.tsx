import { Smile } from 'lucide-react'
import type { HubEmote, HubEmoteIntel, HubProviderShare } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact, emoteBadges, providerLabel } from './hubFormat'

interface EmoteEconomyCardProps {
  intel: HubEmoteIntel
  topEmotes: HubEmote[]
  loading?: boolean
}

const PROVIDER_COLORS = [
  'hsl(var(--sc-chart-2))',
  'hsl(var(--sc-chart-1))',
  'hsl(var(--sc-chart-3))',
  'hsl(var(--sc-chart-4))',
  'hsl(var(--sc-secondary))',
]

function providerSharesFromTopEmotes(emotes: HubEmote[]): HubProviderShare[] {
  const counts = new Map<string, number>()
  let total = 0
  for (const emote of emotes) {
    const count = Math.max(0, emote.count ?? 0)
    if (count === 0) continue
    const provider = providerLabel(emote.provider)
    counts.set(provider, (counts.get(provider) ?? 0) + count)
    total += count
  }
  if (total === 0) return []
  return [...counts.entries()]
    .map(([provider, count]) => ({ provider, count, sharePct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider))
}

function providerRing(shares: HubProviderShare[]): string {
  if (shares.length === 0) {
    return 'conic-gradient(hsl(var(--sc-secondary)) 0 100%)'
  }
  let cursor = 0
  const segments = shares.slice(0, PROVIDER_COLORS.length).map((share, index) => {
    const start = cursor
    cursor = Math.min(100, cursor + Math.max(0, share.sharePct))
    return `${PROVIDER_COLORS[index]} ${start}% ${cursor}%`
  })
  if (cursor < 100) segments.push(`hsl(var(--sc-secondary)) ${cursor}% 100%`)
  return `conic-gradient(${segments.join(', ')})`
}

export function EmoteEconomyCard({ intel, topEmotes, loading = false }: EmoteEconomyCardProps) {
  const shares = intel.providerShares ?? []
  const providerShares = shares.length > 0 ? shares : providerSharesFromTopEmotes(topEmotes)
  const leadingProvider = providerShares[0]
  const ring = providerRing(providerShares)
  const maxShare = topEmotes.reduce((acc, emote) => Math.max(acc, emote.sharePct), 0) || 1

  return (
    <section className="dash-card" aria-labelledby="dash-ee-h" id="dash-emote-economy">
      <div className="dash-card-header row">
        <div>
          <div className="dash-card-title" id="dash-ee-h">
            Emote economy
          </div>
          <div className="dash-card-desc">Provider mix · trailing window</div>
        </div>
        <span className="dash-badge dash-badge--outline">live</span>
      </div>
      <div className="dash-card-content">
        {loading && topEmotes.length === 0 ? (
          <Skeleton height={200} radius="var(--sc-radius)" />
        ) : (
          <>
            <div className="dash-donut">
              <div className="ring" style={{ background: ring }} aria-hidden="true">
                <span className="lbl">
                  <b>{Math.round(leadingProvider?.sharePct ?? intel.seventvSharePct)}%</b>
                  <small>{leadingProvider?.provider ?? '7TV'}</small>
                </span>
              </div>
              <div className="leg">
                {(providerShares.length > 0 ? providerShares : [{ provider: '7TV', count: 0, sharePct: intel.seventvSharePct }]).slice(0, 4).map((share, index) => (
                  <span key={share.provider}>
                    <span className="sw" style={{ background: PROVIDER_COLORS[index] ?? 'hsl(var(--sc-secondary))' }} />
                    {share.provider} · {Math.round(share.sharePct)}%
                  </span>
                ))}
                <span style={{ color: 'hsl(var(--sc-muted-foreground))', fontSize: '0.72rem' }}>
                  {compact(intel.emotesPerMin)} emotes/min global
                </span>
              </div>
            </div>
            <div className="dash-econ-split">
              <div>
                <div className="dash-card-desc" style={{ marginBottom: '0.2rem' }}>
                  Most sent
                </div>
                {topEmotes.length === 0 ? (
                  <div className="dash-empty" style={{ padding: '0.8rem 0' }}>
                    <Smile aria-hidden="true" />
                    <span>No emotes yet.</span>
                  </div>
                ) : (
                  topEmotes.slice(0, 4).map((emote, index) => (
                    <div className="dash-trend" key={`${emote.name}-${index}`}>
                      <span className="em" aria-hidden="true">
                        {emote.imageUrl ? <img src={emote.imageUrl} alt="" loading="lazy" style={{ width: '1.2rem', height: '1.2rem' }} /> : emote.name.slice(0, 2)}
                      </span>
                      <strong>{emote.name}</strong>
                      <span className="dash-emtags">
                        {emoteBadges(emote).map((badge) => (
                          <span key={badge}>{badge}</span>
                        ))}
                      </span>
                      <span className="arrow dash-rise">{emote.sharePct.toFixed(1)}%</span>
                    </div>
                  ))
                )}
              </div>
              <div>
                <div className="dash-card-desc" style={{ marginBottom: '0.2rem' }}>
                  By share
                </div>
                {topEmotes.slice(0, 4).map((emote, index) => (
                  <div className="dash-emrow" key={`bar-${emote.name}-${index}`}>
                    <span className="dash-emmain">
                      <span className="nm">{emote.name}</span>
                      <span className="dash-emtags">
                        {emoteBadges(emote).map((badge) => (
                          <span key={badge}>{badge}</span>
                        ))}
                      </span>
                    </span>
                    <span className="bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(6, Math.round((emote.sharePct / maxShare) * 100))}%` }} />
                    </span>
                    <span className="ct" style={{ color: 'hsl(var(--sc-muted-foreground))' }}>
                      {emote.sharePct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
