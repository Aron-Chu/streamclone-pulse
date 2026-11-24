import { useContext, useEffect, useRef, useState } from 'react'
import type { PublicHub } from '../../../lib/publicHub'
import { useMatchMedia } from '../../hooks/useMatchMedia'
import { HubV5SearchContext } from '../hub/v5/hubV5SearchStore'
import type { HeroBackdropController } from './heroBackdrop/engine'

/** landing.css hides .sl-chatbg at max-width 960px; keep this query in step. */
export const CHAT_BACKDROP_QUERY = '(min-width: 961px)'
/** The rain only moves, so under reduced motion it is not mounted and its pictures never download. */
const MOTION_QUERY = '(prefers-reduced-motion: no-preference)'

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

/**
 * The front page's background (Aron's mix 03, 11-22): counted chat columns in the gutters, a faint shuffled
 * emote rain, and the chat ridge at the bottom of the first screen, all drawn from the hub read the page
 * already makes. Client only: it mounts after the page, stays out of the prerendered HTML, and its code is
 * a chunk loaded once the page is idle. Decorative, so hidden from assistive technology.
 */
export function HeroBackdrop({ data }: { data: PublicHub | null | undefined }) {
  const store = useContext(HubV5SearchContext)
  const wide = useMatchMedia(CHAT_BACKDROP_QUERY)
  const motion = useMatchMedia(MOTION_QUERY)
  const [mounted, setMounted] = useState(false)
  const [engine, setEngine] = useState<HeroBackdropController | null>(null)
  const rainRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const ridgeRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    let alive = true
    let ctl: HeroBackdropController | null = null
    const w = window as IdleWindow
    const load = () => {
      void import('./heroBackdrop/engine').then(({ createHeroBackdrop }) => {
        if (!alive) return
        ctl = createHeroBackdrop({ isSearchInput: (t) => !!t && !!store && (t === store.inputs.hero || t === store.inputs.dock) })
        setEngine(ctl)
      }).catch(() => {})
    }
    // Some browsers (and jsdom) have no idle callback; a short timer stands in.
    const idleApi = typeof w.requestIdleCallback === 'function' && typeof w.cancelIdleCallback === 'function'
    const idle = idleApi ? w.requestIdleCallback!(load, { timeout: 2500 }) : window.setTimeout(load, 900)
    return () => {
      alive = false
      if (idleApi) w.cancelIdleCallback!(idle)
      else window.clearTimeout(idle)
      ctl?.dispose()
      // Drop the disposed engine too, so no later effect hands it a stage before the next one loads.
      setEngine(null)
    }
  }, [mounted, store])

  useEffect(() => {
    engine?.setRain(motion ? rainRef.current : null)
  }, [engine, motion])

  useEffect(() => {
    if (!engine) return
    const stage = stageRef.current
    const ridge = ridgeRef.current
    engine.setStage(
      stage && ridge ? { stage, ridge, chat: wide ? chatRef.current : null } : null,
      {
        live: data?.liveChannels ?? [],
        points: data?.activity?.points ?? [],
        moments: data?.livePulseMoments ?? [],
        generatedAt: data?.generatedAt,
        bucketMinutes: data?.activity?.bucketMinutes,
      },
      !motion,
    )
  }, [engine, data, wide, motion])

  if (!mounted) return null
  // Decoration only: hidden from screen readers, and data-nosnippet keeps the channel names and moment labels it
  // draws out of search-result snippets for the front page.
  return (
    <>
      {motion ? <div className="sl-fx" ref={rainRef} aria-hidden="true" data-nosnippet="" /> : null}
      <div className="sl-herobg" ref={stageRef} aria-hidden="true" data-nosnippet="">
        {wide ? <div className="sl-chatbg" ref={chatRef} /> : null}
        <canvas className="sl-ridge" ref={ridgeRef} />
      </div>
    </>
  )
}
