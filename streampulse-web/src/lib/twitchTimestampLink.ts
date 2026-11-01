export type TimestampLinkResult =
  | { ok: true; url: string; videoId: string; seconds: number; displayTime: string }
  | { ok: false; field: 'video' | 'time'; message: string }

/** Parse whole-second offsets without evaluating expressions or guessing wall-clock time. */
export function parseVodTimestamp(input: string): number | null {
  const value = input.trim().toLowerCase()
  if (!value || value.length > 64) return null
  let seconds: number
  if (/^\d+$/.test(value)) seconds = Number(value)
  else if (/^\d+:\d{2}(?::\d{2})?$/.test(value)) {
    const parts = value.split(':').map(Number)
    if (parts[parts.length - 1] >= 60 || (parts.length === 3 && parts[1] >= 60)) return null
    seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
  } else {
    const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
    if (!units || !units.slice(1).some(part => part !== undefined)) return null
    seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)
  }
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null
}

export function buildTwitchTimestampLink(video: string, timestamp: string): TimestampLinkResult {
  const input = video.trim()
  let videoId: string
  let existingTime: string | null = null
  if (/^[1-9]\d{0,29}$/.test(input)) videoId = input
  else {
    try {
      const url = new URL(/^(?:www\.|m\.)?twitch\.tv\//i.test(input) ? `https://${input}` : input)
      if (input.length > 2048 || url.protocol !== 'https:' || !['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(url.hostname) || url.port || url.username || url.password) throw new Error('Not a Twitch VOD URL')
      const match = /^\/videos\/([1-9]\d{0,29})\/?$/.exec(url.pathname)
      if (!match || url.searchParams.getAll('t').length > 1) throw new Error('Not one unambiguous VOD')
      videoId = match[1]
      existingTime = url.searchParams.get('t')
    } catch {
      return { ok: false, field: 'video', message: 'Enter a Twitch past-broadcast link, such as twitch.tv/videos/ followed by its video ID, or the numeric video ID. Live-channel and clip links are different.' }
    }
  }
  const seconds = parseVodTimestamp(timestamp.trim() || existingTime || '')
  if (seconds === null) return { ok: false, field: 'time', message: 'Enter a whole-second start time: 1:23:45, 23:45, 5025, or 1h23m45s. In colon times, seconds and the middle minutes must be below 60.' }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const remainder = seconds % 60
  return { ok: true, videoId, seconds,
    displayTime: `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`,
    url: `https://www.twitch.tv/videos/${videoId}?t=${hours}h${minutes}m${remainder}s`,
  }
}
