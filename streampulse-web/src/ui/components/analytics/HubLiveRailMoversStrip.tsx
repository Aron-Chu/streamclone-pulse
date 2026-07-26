import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import type { Flip } from 'gsap/Flip'
import type { HubMover } from '../../../lib/publicHub'
import { useAnalyticsMotion } from '../../motion/useAnalyticsMotion'
import { formatMoverVelocity } from './hubFormat'
import { MomentumBadge } from './MomentumBadge'
import { Avatar } from '../hub/primitives'

export interface HubLiveRailMoversStripProps {
  movers: HubMover[]
  loading?: boolean
}

const MIN_BAR_PCT = 8
const SKELETON_ROWS = 5

function barWidthPct(emotesPerMin: number, maxEmotesPerMin: number): number {
  if (maxEmotesPerMin <= 0) return MIN_BAR_PCT
  const ratio = emotesPerMin / maxEmotesPerMin
  return Math.max(MIN_BAR_PCT, Math.round(ratio * 100))
}

function rankDeltaLabel(prevRank: number | undefined, currentRank: number): string | null {
  if (prevRank == null || prevRank === currentRank) return null
  const delta = prevRank - currentRank
  if (delta > 0) return `▲${delta}`
  return `▼${Math.abs(delta)}`
}

export function HubLiveRailMoversStrip({ movers, loading }: HubLiveRailMoversStripProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const prevRankByLogin = useRef<Map<string, number>>(new Map())
  const flipStateRef = useRef<Flip.FlipState | null>(null)
  const { flipFrom, captureFlipState, animateBarWidth, motionEnabled } = useAnalyticsMotion()

  const maxEmotesPerMin = useMemo(
    () => Math.max(0, ...movers.map((m) => m.emotesPerMin ?? 0)),
    [movers],
  )

  const rankDeltas = useMemo(() => {
    const deltas = new Map<string, string | null>()
    movers.forEach((mover, index) => {
      const prev = prevRankByLogin.current.get(mover.login)
      deltas.set(mover.login, rankDeltaLabel(prev, index + 1))
    })
    return deltas
  }, [movers])

  useLayoutEffect(() => {
    const container = listRef.current
    if (!container) return

    if (motionEnabled && flipStateRef.current) {
      flipFrom(flipStateRef.current)
    }

    flipStateRef.current = motionEnabled ? captureFlipState(container) : null
  }, [captureFlipState, flipFrom, motionEnabled, movers])

  useEffect(() => {
    const nextRanks = new Map<string, number>()
    movers.forEach((mover, index) => nextRanks.set(mover.login, index + 1))
    prevRankByLogin.current = nextRanks
  }, [movers])

  useEffect(() => {
    if (!motionEnabled || movers.length === 0) return
    const container = listRef.current
    if (!container) return
    const fills = container.querySelectorAll<HTMLElement>('[data-bar-login]')
    fills.forEach((fill) => {
      const login = fill.getAttribute('data-bar-login')
      const mover = movers.find((m) => m.login === login)
      if (!mover) return
      animateBarWidth(fill, barWidthPct(mover.emotesPerMin ?? 0, maxEmotesPerMin))
    })
  }, [animateBarWidth, maxEmotesPerMin, motionEnabled, movers])

  if (loading && movers.length === 0) {
    return (
      <div className="hub-live-rail-movers" aria-busy="true" aria-label="Top emote movers">
        <span className="hub-live-rail-movers__label">
          <TrendingUp aria-hidden="true" />
          Top emote movers
        </span>
        <div className="hub-live-rail-movers__list">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div
              key={i}
              className="hub-live-rail-movers__row hub-live-rail-movers__row--skeleton"
              aria-hidden="true"
            >
              <span className="hub-live-rail-movers__rank">—</span>
              <span className="hub-live-rail-movers__avatar-skeleton" />
              <span className="hub-live-rail-movers__name-skeleton" />
              <span className="hub-live-rail-movers__bar-track">
                <span className="hub-live-rail-movers__bar-fill" style={{ width: '0%' }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (movers.length === 0) return null

  return (
    <div className="hub-live-rail-movers" aria-label="Top emote movers">
      <span className="hub-live-rail-movers__label">
        <TrendingUp aria-hidden="true" />
        Top emote movers
      </span>
      <div className="hub-live-rail-movers__list" ref={listRef}>
        {movers.map((mover, index) => {
          const velocity = formatMoverVelocity(mover)
          const name = mover.displayName?.trim() || mover.login
          const widthPct = barWidthPct(mover.emotesPerMin ?? 0, maxEmotesPerMin)
          const delta = rankDeltas.get(mover.login)
          return (
            <Link
              key={mover.login}
              to={`/analytics/${encodeURIComponent(mover.login)}`}
              className="hub-live-rail-movers__row"
              data-flip-key={mover.login}
              title={`${velocity.emoteLabel} emotes · ${velocity.chatLabel}`}
            >
              <span className="hub-live-rail-movers__rank">{index + 1}</span>
              <Avatar login={mover.login} src={mover.profileImageUrl} alt="" />
              <span className="hub-live-rail-movers__name">{name}</span>
              <span className="hub-live-rail-movers__bar-track" aria-hidden="true">
                <span
                  className="hub-live-rail-movers__bar-fill"
                  data-bar-login={mover.login}
                  style={{ width: `${widthPct}%` }}
                />
              </span>
              <span className="hub-live-rail-movers__metric">{velocity.emoteLabel}</span>
              {delta ? (
                <span
                  className={`hub-live-rail-movers__rank-delta${
                    delta.startsWith('▲')
                      ? ' hub-live-rail-movers__rank-delta--up'
                      : ' hub-live-rail-movers__rank-delta--down'
                  }`}
                  aria-hidden="true"
                >
                  {delta}
                </span>
              ) : (
                <span className="hub-live-rail-movers__rank-delta hub-live-rail-movers__rank-delta--none" />
              )}
              <MomentumBadge
                pct={mover.trendPct}
                hasSignal={mover.trendSignal}
                classPrefix="hub-live-rail-movers__trend"
              />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
