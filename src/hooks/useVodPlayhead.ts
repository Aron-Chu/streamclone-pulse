import { useEffect, useState } from 'react'
import { getPrimaryVideo } from '../content/twitch.ts'
import { keptVodOriginDelta } from '../shared/vodOriginAlignment.ts'

/** Where the VOD player is: whole seconds of VOD time, and whether it is paused. */
export type VodPlayhead = { seconds: number; paused: boolean }

const PLAYER_EVENTS = ['timeupdate', 'seeked', 'play', 'pause'] as const

/**
 * VOD time -> the stream offset the chart draws. The archive can start after
 * the stream did (`vodOriginDeltaSeconds`); a delta it cannot trust draws no
 * line rather than one in the wrong place.
 */
export function vodPlayheadOffset(vodSeconds: number, delta: number | null | undefined): number | null {
  if (!(vodSeconds >= 0)) return null
  const shift = delta == null || delta === 0 ? 0 : keptVodOriginDelta(delta)
  return shift === undefined ? null : Math.floor(vodSeconds) + shift
}

/**
 * Follows this tab's Twitch player while `enabled`: its events, not a timer,
 * so a paused video costs nothing. Twitch swaps the <video> element (ads,
 * quality changes), so the player is looked up again every few seconds.
 */
export function useVodPlayhead(enabled: boolean): VodPlayhead | null {
  const [playhead, setPlayhead] = useState<VodPlayhead | null>(null)

  useEffect(() => {
    if (!enabled) {
      setPlayhead(null)
      return
    }
    let video: HTMLVideoElement | null = null
    const read = () => {
      const time = video?.currentTime
      if (!video || !(time! >= 0)) return
      const seconds = Math.floor(time!)
      const paused = video.paused
      setPlayhead(current => current?.seconds === seconds && current.paused === paused ? current : { seconds, paused })
    }
    const listen = (on: boolean) => PLAYER_EVENTS.forEach(name => video?.[on ? 'addEventListener' : 'removeEventListener'](name, read))
    const attach = () => {
      const next = getPrimaryVideo()
      if (next === video) return
      listen(false)
      video = next
      listen(true)
      read()
    }
    attach()
    const timer = window.setInterval(attach, 3000)
    return () => {
      window.clearInterval(timer)
      listen(false)
    }
  }, [enabled])

  return playhead
}
