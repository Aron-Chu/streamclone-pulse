import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact, coverageMeta, coveragePctMeta, displayName, initial, twitchLivePreviewUrl } from './hubFormat'

interface HubLiveCarouselProps {
  channels: HubLiveChannel[]
  loading?: boolean
}

function coveragePercent(state: HubLiveChannel['coverageState']): number {
  switch (state) {
    case 'synced':
      return 100
    case 'partial':
    case 'chat_only':
    case 'viewer_only':
      return 62
    case 'stats_only':
      return 28
    default:
      return 45
  }
}

export function HubLiveCarousel({ channels, loading = false }: HubLiveCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)
  const pausedRef = useRef(false)

  const updateButtons = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    setCanPrev(track.scrollLeft > 2)
    setCanNext(track.scrollLeft < track.scrollWidth - track.clientWidth - 2)
  }, [])

  const step = useCallback((multiplier: number) => {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelector<HTMLElement>('.hub-chan')
    const distance = card ? card.getBoundingClientRect().width + 13 : 240
    track.scrollBy({ left: distance * multiplier, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    updateButtons()
  }, [channels, updateButtons])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || channels.length <= 1) return

    let direction = 1
    const timer = window.setInterval(() => {
      if (pausedRef.current) return
      const max = track.scrollWidth - track.clientWidth
      if (track.scrollLeft >= max - 1) direction = -1
      else if (track.scrollLeft <= 1) direction = 1
      step(direction)
    }, 3200)
    return () => window.clearInterval(timer)
  }, [channels, step])

  if (loading) {
    return (
      <div className="hub-rail">
        <div className="hub-skelrow">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="hub-skelcard" radius="0.9rem" />
          ))}
        </div>
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="hub-empty">
        <Radio size={22} aria-hidden="true" />
        <strong>No channels live right now</strong>
        <span>Search any Twitch login above to open its hosted analytics console.</span>
      </div>
    )
  }

  return (
    <div className="hub-rail">
      <button
        type="button"
        className="hub-railbtn hub-railbtn--float hub-railbtn--prev"
        aria-label="Scroll live channels left"
        onClick={() => step(-1.5)}
        disabled={!canPrev}
      >
        <ChevronLeft size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="hub-railbtn hub-railbtn--float hub-railbtn--next"
        aria-label="Scroll live channels right"
        onClick={() => step(1.5)}
        disabled={!canNext}
      >
        <ChevronRight size={17} aria-hidden="true" />
      </button>
      <div className="hub-rail__mask">
        <div
          className="hub-rail__track"
          ref={trackRef}
          tabIndex={0}
          role="group"
          aria-label="Live channels carousel"
          onScroll={updateButtons}
          onMouseEnter={() => (pausedRef.current = true)}
          onMouseLeave={() => (pausedRef.current = false)}
          onFocusCapture={() => (pausedRef.current = true)}
          onBlurCapture={() => (pausedRef.current = false)}
        >
          {channels.map((channel) => {
            const cov = coveragePercent(channel.coverageState)
            const covMeta = coveragePctMeta(cov)
            const status = coverageMeta(channel.coverageState)
            const name = displayName(channel.login, channel.displayName)
            return (
              <Link
                key={channel.login}
                to={`/analytics/${encodeURIComponent(channel.login.toLowerCase())}`}
                className="hub-chan"
              >
                <span className="hub-chan__thumb">
                  <img
                    src={twitchLivePreviewUrl(channel.login)}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                  <span className="hub-chan__livebadge">
                    <i aria-hidden="true" />
                    LIVE
                  </span>
                  <span className="hub-chan__views">{compact(channel.viewers)} watching</span>
                </span>
                <div className="hub-chan__top">
                  <span className="hub-chan__av">
                    {channel.profileImageUrl ? (
                      <img src={channel.profileImageUrl} alt="" loading="lazy" />
                    ) : (
                      initial(name)
                    )}
                  </span>
                  <span className="hub-chan__id">
                    <strong>{name}</strong>
                    <span className="cat">{channel.category?.trim() || 'Live channel'}</span>
                  </span>
                </div>
                <div className="hub-chan__mets">
                  <span className="hub-chan__met">
                    <b>{compact(channel.viewers)}</b>
                    <span>Viewers</span>
                  </span>
                  <span className="hub-chan__met">
                    <b>{compact(channel.chatPerMin)}</b>
                    <span>Chat·min</span>
                  </span>
                </div>
                <div className="hub-chan__foot">
                  <span className="hub-chan__cov" title={`Coverage ${cov}%`}>
                    <i style={{ width: `${cov}%`, background: covMeta.color }} />
                  </span>
                  <span className={`hub-stat hub-stat--${status.tone}`}>
                    <span className="d" />
                    {status.label}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

