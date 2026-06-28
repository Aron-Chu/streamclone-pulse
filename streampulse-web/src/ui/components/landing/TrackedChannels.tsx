import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PublicHub } from '../../../lib/publicHub'
import { compact, signedPct } from './landingData'
import { cn } from '../../primitives/cn'

interface ChannelRow {
  name: string
  category: string
  initial: string
  image?: string
  viewers: number
  chatPerMin: number
  seventvPerMin: number
  trendPct: number
  coverage: string
}

const FALLBACK_COUNTERS = {
  streamsTracked: 512,
  chatMessagesProcessed: 48_200_000,
  emotesIndexed: 1_320_000,
  momentsDetected: 214_000,
  vodsAnalyzed: 9_840,
}

const FALLBACK_CHANNELS: ChannelRow[] = [
  { name: 'caseoh_', category: 'Just Chatting', initial: 'C', viewers: 42_100, chatPerMin: 482, seventvPerMin: 196, trendPct: 62, coverage: 'synced' },
  { name: 'jynxzi', category: 'Rainbow Six Siege', initial: 'J', viewers: 38_400, chatPerMin: 410, seventvPerMin: 171, trendPct: 38, coverage: 'synced' },
  { name: 'kaicenat', category: 'Just Chatting', initial: 'K', viewers: 51_900, chatPerMin: 377, seventvPerMin: 142, trendPct: 19, coverage: 'synced' },
  { name: 'xQc', category: 'Just Chatting', initial: 'X', viewers: 29_700, chatPerMin: 299, seventvPerMin: 121, trendPct: -7, coverage: 'chat_only' },
  { name: 'fanum', category: 'Just Chatting', initial: 'F', viewers: 18_200, chatPerMin: 241, seventvPerMin: 98, trendPct: 11, coverage: 'synced' },
  { name: 'ludwig', category: 'Just Chatting', initial: 'L', viewers: 14_600, chatPerMin: 188, seventvPerMin: 73, trendPct: 0, coverage: 'synced' },
  { name: 'pokimane', category: 'Just Chatting', initial: 'P', viewers: 12_900, chatPerMin: 164, seventvPerMin: 61, trendPct: 5, coverage: 'viewer_only' },
  { name: 'shroud', category: 'VALORANT', initial: 'S', viewers: 11_300, chatPerMin: 142, seventvPerMin: 54, trendPct: -3, coverage: 'chat_only' },
]

const COVERAGE_LABEL: Record<string, string> = {
  synced: 'Synced',
  chat_only: 'Chat only',
  viewer_only: 'Viewers only',
  partial: 'Partial',
  stats_only: 'Stats only',
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Animated count-up from 0 to `value`, formatted compactly. Settles instantly under reduced motion / no rAF. */
function CountUp({ value, active }: { value: number; active: boolean }) {
  const [shown, setShown] = useState(active ? value : 0)
  const rafRef = useRef(0)
  useEffect(() => {
    if (!active) return
    if (
      prefersReducedMotion() ||
      typeof requestAnimationFrame === 'undefined' ||
      typeof performance === 'undefined'
    ) {
      setShown(value)
      return
    }
    const duration = 1200
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(value * eased)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, active])
  return <>{compact(Math.round(shown))}</>
}

/**
 * Channels-tracked numbers board for the landing page. A row of corpus counters
 * that tick up as the section enters view, plus a compact live leaderboard of
 * tracked channels with raw per-minute numbers. Backend data when present,
 * otherwise a representative fallback roster so the board never reads empty.
 */
export function TrackedChannels({ hub }: { hub: PublicHub | null }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setActive(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(true)
            io.disconnect()
            break
          }
        }
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const corpus = hub?.corpus
  const counters = [
    { key: 'streams', label: 'Channels tracked', value: corpus?.streamsTracked || FALLBACK_COUNTERS.streamsTracked },
    { key: 'chat', label: 'Chat msgs read', value: corpus?.chatMessagesProcessed || FALLBACK_COUNTERS.chatMessagesProcessed },
    { key: 'emotes', label: 'Emotes indexed', value: corpus?.emotesIndexed || FALLBACK_COUNTERS.emotesIndexed },
    { key: 'moments', label: 'Moments detected', value: corpus?.momentsDetected || FALLBACK_COUNTERS.momentsDetected },
    { key: 'vods', label: 'VODs analyzed', value: corpus?.vodsAnalyzed || FALLBACK_COUNTERS.vodsAnalyzed },
  ]

  const live = hub?.liveChannels ?? []
  const rows: ChannelRow[] =
    live.length > 0
      ? live.slice(0, 8).map((channel) => {
          const display = (channel.displayName ?? '').trim() || channel.login
          return {
            name: display,
            category: channel.category ?? '—',
            initial: (display.charAt(0) || '?').toUpperCase(),
            image: channel.profileImageUrl,
            viewers: channel.viewers,
            chatPerMin: channel.chatPerMin,
            seventvPerMin: channel.seventvPerMin,
            trendPct: channel.trendPct,
            coverage: channel.coverageState,
          }
        })
      : FALLBACK_CHANNELS

  const liveCount = hub?.coverage?.liveChannels || rows.length

  return (
    <div className={cn('sl-tc', active && 'is-in')} ref={rootRef}>
      <div className="sl-tc__counters">
        {counters.map((counter, index) => (
          <div className="sl-tc__counter" key={counter.key} style={{ '--d': `${index * 80}ms` } as CSSProperties}>
            <strong>
              <CountUp value={counter.value} active={active} />
            </strong>
            <span>{counter.label}</span>
          </div>
        ))}
      </div>

      <div className="sl-tc__board">
        <div className="sl-tc__head">
          <span className="sl-tc__live">
            <i aria-hidden="true" />
            {compact(liveCount)} live right now
          </span>
          <span className="sl-tc__col">Viewers</span>
          <span className="sl-tc__col">Chat/min</span>
          <span className="sl-tc__col sl-tc__col--sv">7TV/min</span>
          <span className="sl-tc__col">Trend</span>
        </div>

        {rows.map((row, index) => (
          <div
            className="sl-tc__row"
            key={`${row.name}-${index}`}
            style={{ '--d': `${120 + index * 55}ms` } as CSSProperties}
          >
            <span className="sl-tc__rank">{index + 1}</span>
            <span className="sl-tc__av" aria-hidden="true">
              {row.image ? <img src={row.image} alt="" loading="lazy" decoding="async" /> : row.initial}
            </span>
            <span className="sl-tc__id">
              <b>{row.name}</b>
              <small>
                {row.category}
                <i className={cn('sl-tc__cov', `is-${row.coverage}`)}>{COVERAGE_LABEL[row.coverage] ?? 'Tracked'}</i>
              </small>
            </span>
            <span className="sl-tc__num">{compact(row.viewers)}</span>
            <span className="sl-tc__num">{compact(row.chatPerMin)}</span>
            <span className="sl-tc__num sl-tc__num--sv">{compact(row.seventvPerMin)}</span>
            <span className={cn('sl-tc__trend', row.trendPct > 1 && 'up', row.trendPct < -1 && 'dn')}>
              {signedPct(row.trendPct)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
