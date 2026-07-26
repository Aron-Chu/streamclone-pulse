import { useCallback, useEffect, useState } from 'react'
import { getPrimaryVideo, seekVodOffset } from '../content/twitch.ts'

export type VodPlaybackSyncStatus = 'synced' | 'unavailable' | 'unknown'

export function useTwitchVodPlayback(enabled: boolean) {
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState<number | undefined>()
  const [isPlaying, setIsPlaying] = useState(false)
  const [syncStatus, setSyncStatus] = useState<VodPlaybackSyncStatus>('unknown')

  useEffect(() => {
    if (!enabled) {
      setSyncStatus('unknown')
      return
    }

    const tick = () => {
      const video = getPrimaryVideo()
      if (!video) {
        setSyncStatus('unavailable')
        return
      }
      setSyncStatus('synced')
      setCurrentTimeSeconds(Math.max(0, Math.floor(video.currentTime)))
      if (Number.isFinite(video.duration) && video.duration > 0 && video.duration !== Infinity) {
        setDurationSeconds(Math.floor(video.duration))
      }
      setIsPlaying(!video.paused && !video.ended)
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [enabled])

  const seekTo = useCallback((offsetSeconds: number) => {
    const result = seekVodOffset(getPrimaryVideo(), offsetSeconds)
    if (result.ok) {
      setCurrentTimeSeconds(Math.max(0, Math.floor(result.targetSeconds)))
    }
    return result
  }, [])

  return {
    currentTimeSeconds,
    durationSeconds,
    isPlaying,
    seekTo,
    syncStatus,
  }
}
