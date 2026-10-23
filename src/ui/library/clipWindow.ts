/**
 * The window Preview's Clip picks before handing off to Twitch. Twitch makes
 * the clip with its own Clip button on the VOD; StreamPulse creates nothing,
 * so this is arithmetic on stream offsets in whole seconds.
 */
export const CLIP_LENGTHS = [30, 60] as const
export type ClipLength = (typeof CLIP_LENGTHS)[number]
export interface ClipWindow { start: number; length: ClipLength }

/** The window opens this long before the moment. */
export const CLIP_LEAD_SECONDS = 30
export const CLIP_NUDGE_SECONDS = 15
/** A click on the chart centres the window, snapped to this step. */
export const CLIP_SNAP_SECONDS = 5

const clampStart = (seconds: number) => Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0

export function defaultClipWindow(momentSeconds: number): ClipWindow {
  return { start: clampStart(momentSeconds - CLIP_LEAD_SECONDS), length: 60 }
}

export function nudgeClipWindow(window: ClipWindow, seconds: number): ClipWindow {
  return { ...window, start: clampStart(window.start + seconds) }
}

export function resizeClipWindow(window: ClipWindow, length: ClipLength): ClipWindow {
  return { ...window, length }
}

/** Centres the window on `seconds`, its start on a 5 s step and never before 0. */
export function centreClipWindow(window: ClipWindow, seconds: number): ClipWindow {
  return { ...window, start: clampStart(Math.round((seconds - window.length / 2) / CLIP_SNAP_SECONDS) * CLIP_SNAP_SECONDS) }
}

/** Twitch's `?t=` as hours, minutes and seconds: 1h02m05s, 0h00m30s. */
export function twitchTime(seconds: number): string {
  const value = clampStart(seconds)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(value / 3600)}h${pad(Math.floor(value / 60) % 60)}m${pad(value % 60)}s`
}

/** The VOD at the window's start, where Twitch's Clip button picks up; null without a numeric VOD id. */
export function clipOnTwitchUrl(vodId: string | null | undefined, window: ClipWindow): string | null {
  return vodId && /^\d+$/.test(vodId) ? `https://www.twitch.tv/videos/${vodId}?t=${twitchTime(window.start)}` : null
}
