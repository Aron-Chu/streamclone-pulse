/**
 * One frame of a VOD second, read in the VOD's Twitch tab the way Twitch's own
 * player reads the VOD: a playback token, the VOD's playlist, then the one
 * ~10 s segment of a small rendition that holds the second (MPEG-TS, or
 * fragmented MP4 after its init segment). The segment is read in Range steps
 * only until the frame can be decoded, decoded with WebCodecs and drawn to a
 * JPEG. It works
 * while Twitch is still recording the VOD. The picture goes back to the asking
 * tab only (src/content/momentFrames.ts); nothing is stored or sent to Pulse.
 */
export interface VodFrame {
  /** A data:image/jpeg URL. */
  image: string
  width: number
  height: number
  /** The VOD second the frame shows. */
  at: number
}

/** Self-contained for MAIN world injection: no imports or outer names. */
export async function vodFrameInPage(vodId: string, seconds: number, minHeight: number): Promise<VodFrame | { error: string }> {
  // Twitch's public web Client-ID, as in gqlDiscoverVodInPage.
  const clientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
  // Read on until a frame this far past the second starts: frames can be shown out of decode order.
  const pastTarget = 0.5

  interface Segment { start: number; duration: number; url: string; init?: string }
  interface Playlist {
    segments: Segment[]
    live: boolean
    fetched: number
    /** The rendition's bytes per second, from its BANDWIDTH. */
    rate: number
    /** Fragmented MP4 init segments, read once each. */
    inits: Map<string, Promise<Track>>
  }
  /** The H.264 track of a fragmented MP4 VOD, from its init segment. */
  interface Track {
    id: number
    timescale: number
    config: VideoDecoderConfig
    lengthSize: number
    defaultDuration: number
    defaultSize: number
  }
  interface Unit { pts: number; data: Uint8Array }

  async function text(url: string, init?: RequestInit): Promise<string> {
    const res = await fetch(url, { ...init, credentials: 'omit' })
    if (!res.ok) throw new Error(`http_${res.status}`)
    return res.text()
  }

  async function readPlaylist(): Promise<Playlist> {
    const body = JSON.parse(await text('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': clientId, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        query: 'query PulseVodFrameToken($id: ID!) { videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }',
        variables: { id: vodId },
      }),
    })) as { data?: { videoPlaybackAccessToken?: { value: string; signature: string } | null } }
    const token = body.data?.videoPlaybackAccessToken
    if (!token) throw new Error('no_token')
    const query = new URLSearchParams({ allow_source: 'true', nauth: token.value, nauthsig: token.signature, player: 'twitchweb', p: String(Math.floor(Math.random() * 1e6)) })
    const master = await text(`https://usher.ttvnw.net/vod/${vodId}.m3u8?${query}`)
    const variants = [...master.matchAll(/#EXT-X-STREAM-INF:([^\n]*)\r?\n([^\n]+)/g)]
      .map(([, info, uri]) => ({
        height: Number(/RESOLUTION=\d+x(\d+)/.exec(info!)?.[1] ?? 0),
        rate: Number(/(?:^|,)BANDWIDTH=(\d+)/.exec(info!)?.[1] ?? 0) / 8,
        uri: uri!.trim(),
      }))
      .filter(variant => variant.height > 0)
      .sort((a, b) => a.height - b.height)
    const variant = variants.find(item => item.height >= minHeight) ?? variants[variants.length - 1]
    if (!variant) throw new Error('no_rendition')
    // A VOD with only source quality would cost several MB a frame: no frame then.
    if (variant.height > 480) throw new Error('no_small_rendition')
    const media = await text(variant.uri)
    const segments: Segment[] = []
    let at = 0
    let duration: number | null = null
    let init: string | undefined
    for (const line of media.split(/\r?\n/)) {
      const map = /^#EXT-X-MAP:.*URI="([^"]+)"/.exec(line)
      const info = /^#EXTINF:([\d.]+)/.exec(line)
      if (map) init = new URL(map[1]!, variant.uri).href
      else if (info) duration = Number(info[1])
      else if (duration != null && line.trim() && !line.startsWith('#')) {
        segments.push({ start: at, duration, url: new URL(line.trim(), variant.uri).href, init })
        at += duration
        duration = null
      }
    }
    return { segments, live: !media.includes('#EXT-X-ENDLIST'), fetched: Date.now(), rate: variant.rate, inits: new Map() }
  }

  // ISO BMFF boxes: a 32-bit size (1: a 64-bit one follows the type; 0: to the end) and a 4-letter type.
  const u32 = (d: Uint8Array, o: number) => ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0
  const box = (d: Uint8Array, o: number, end: number) => {
    let size = u32(d, o)
    let head = 8
    if (size === 1) {
      size = u32(d, o + 8) * 2 ** 32 + u32(d, o + 12)
      head = 16
    } else if (size === 0) size = end - o
    return { type: String.fromCharCode(d[o + 4]!, d[o + 5]!, d[o + 6]!, d[o + 7]!), start: o + head, end: o + size }
  }
  const children = (d: Uint8Array, start: number, end: number) => {
    const found: ReturnType<typeof box>[] = []
    for (let o = start; o + 8 <= end;) {
      const child = box(d, o, end)
      if (child.end <= o || child.end > end) break
      found.push(child)
      o = child.end
    }
    return found
  }
  const child = (d: Uint8Array, parent: { start: number; end: number }, type: string) => children(d, parent.start, parent.end).find(item => item.type === type)

  async function readTrack(url: string): Promise<Track> {
    const res = await fetch(url, { credentials: 'omit' })
    if (!res.ok) throw new Error(`http_${res.status}`)
    const d = new Uint8Array(await res.arrayBuffer())
    const moov = children(d, 0, d.length).find(item => item.type === 'moov')
    if (!moov) throw new Error('no_moov')
    for (const trak of children(d, moov.start, moov.end).filter(item => item.type === 'trak')) {
      const tkhd = child(d, trak, 'tkhd')
      const mdia = child(d, trak, 'mdia')
      const hdlr = mdia && child(d, mdia, 'hdlr')
      const mdhd = mdia && child(d, mdia, 'mdhd')
      if (!tkhd || !hdlr || !mdhd || String.fromCharCode(...d.subarray(hdlr.start + 8, hdlr.start + 12)) !== 'vide') continue
      const minf = child(d, mdia, 'minf')
      const stbl = minf && child(d, minf, 'stbl')
      const stsd = stbl && child(d, stbl, 'stsd')
      // A sample entry's own fields take 78 bytes before its boxes.
      const entry = stsd && children(d, stsd.start + 8, stsd.end)[0]
      if (!entry || (entry.type !== 'avc1' && entry.type !== 'avc3')) throw new Error('codec_unsupported')
      const avcC = child(d, { start: entry.start + 78, end: entry.end }, 'avcC')
      if (!avcC) throw new Error('codec_unsupported')
      const description = d.slice(avcC.start, avcC.end)
      const hex = (n: number) => description[n]!.toString(16).padStart(2, '0')
      const id = u32(d, tkhd.start + (d[tkhd.start] === 1 ? 20 : 12))
      const mvex = children(d, moov.start, moov.end).find(item => item.type === 'mvex')
      const trex = mvex && children(d, mvex.start, mvex.end).find(item => item.type === 'trex' && u32(d, item.start + 4) === id)
      return {
        id,
        timescale: u32(d, mdhd.start + (d[mdhd.start] === 1 ? 20 : 12)),
        config: { codec: `avc1.${hex(1)}${hex(2)}${hex(3)}`, description, optimizeForLatency: true, hardwareAcceleration: 'prefer-software' },
        lengthSize: (description[4]! & 3) + 1,
        defaultDuration: trex ? u32(d, trex.start + 12) : 0,
        defaultSize: trex ? u32(d, trex.start + 16) : 0,
      }
    }
    throw new Error('no_video')
  }

  try {
    if (typeof VideoDecoder !== 'function' || typeof OffscreenCanvas !== 'function') return { error: 'no_webcodecs' }

    // Calls for the same VOD share its playlist; a still-recording one is read again after a minute, or for a later second.
    const page = window as unknown as { __pulseVodFramePlaylists?: Map<string, Promise<Playlist>> }
    const cache = (page.__pulseVodFramePlaylists ??= new Map())
    const key = `${vodId}:${minHeight}`
    const end = (list: Playlist) => {
      const last = list.segments[list.segments.length - 1]
      return last ? last.start + last.duration : 0
    }
    let list: Playlist | null = await (cache.get(key) ?? Promise.reject(new Error('none'))).catch(() => null)
    if (!list || (list.live && (Date.now() - list.fetched > 60_000 || seconds >= end(list)))) {
      const asked = readPlaylist()
      cache.set(key, asked)
      list = await asked
    }
    const segment = list.segments.find(item => seconds >= item.start && seconds < item.start + item.duration)
    if (!segment) return { error: list.live ? 'not_recorded_yet' : 'outside_vod' }
    let track: Track | null = null
    if (segment.init) {
      const inits = list.inits
      let asked = inits.get(segment.init)
      if (!asked) {
        asked = readTrack(segment.init)
        inits.set(segment.init, asked)
        asked.catch(() => inits.delete(segment.init!))
      }
      track = await asked
    }
    const timescale = track?.timescale ?? 90_000

    // The segment, read in Range steps from its start and parsed into H.264 access units in
    // decode order: the first step to a second past the frame, by the rendition's bit rate,
    // then a second of video or a quarter of what is read, whichever is more (a VOD still
    // recording undersells its bit rate by up to a third). Once a unit starts well past the
    // second, and every unit before it is whole, nothing more is read. (A streamed read
    // cancelled early still pulls whatever the CDN sent ahead; a range stops where asked.)
    const rate = list.rate > 0 ? Math.max(1 << 13, list.rate) : 1 << 17
    let want = Math.ceil(rate * (seconds - segment.start + pastTarget + 1))
    let received = 0
    let last = false
    /** The segment's next bytes, to `want` or one more step; null past its end. */
    const more = async (): Promise<Uint8Array | null> => {
      if (last) return null
      const stop = Math.max(want, received + Math.ceil(Math.max(rate, received / 4)))
      want = 0
      const res = await fetch(segment.url, { credentials: 'omit', headers: { Range: `bytes=${received}-${stop - 1}` } })
      // 416: the step before ended exactly at the segment's end.
      if (res.status === 416) return null
      if (!res.ok) throw new Error(`http_${res.status}`)
      let data = new Uint8Array(await res.arrayBuffer())
      // A server that ignores Range sends the whole segment.
      if (res.status !== 206) data = data.subarray(received)
      last = res.status !== 206 || data.length < stop - received
      received += data.length
      return data
    }
    let target = Infinity
    let enough = false
    const units: Unit[] = []
    /** Sets the target from the segment's first unit; true once `pts` is well past it. */
    const past = (pts: number) => {
      if (target === Infinity) target = pts + (seconds - segment.start) * timescale
      return pts > target + pastTarget * timescale
    }

    if (track) {
      // Fragmented MP4: each moof lists its samples and where they sit in the mdat after it.
      const video = track
      let buffer = new Uint8Array(1 << 18)
      let length = 0
      let parsed = 0
      const samples: { pts: number; offset: number; size: number }[] = []
      let cut = -1
      while (!enough) {
        const chunk = await more()
        if (!chunk) break
        if (length + chunk.length > buffer.length) {
          const grown = new Uint8Array(Math.max(buffer.length * 2, length + chunk.length))
          grown.set(buffer.subarray(0, length))
          buffer = grown
        }
        buffer.set(chunk, length)
        length += chunk.length
        const d = buffer
        while (parsed + 16 <= length) {
          const top = box(d, parsed, Infinity)
          if (top.end <= parsed) throw new Error('bad_box')
          if (top.type === 'moof') {
            if (top.end > length) break
            for (const traf of children(d, top.start, top.end).filter(item => item.type === 'traf')) {
              const tfhd = child(d, traf, 'tfhd')
              if (!tfhd || u32(d, tfhd.start + 4) !== video.id) continue
              const flags = u32(d, tfhd.start) & 0xffffff
              let o = tfhd.start + 8
              let base = parsed
              if (flags & 1) {
                base = u32(d, o) * 2 ** 32 + u32(d, o + 4)
                o += 8
              }
              if (flags & 2) o += 4
              const defaultDuration = flags & 8 ? u32(d, o) : video.defaultDuration
              if (flags & 8) o += 4
              const defaultSize = flags & 0x10 ? u32(d, o) : video.defaultSize
              const tfdt = child(d, traf, 'tfdt')
              let dts = tfdt ? (d[tfdt.start] === 1 ? u32(d, tfdt.start + 4) * 2 ** 32 + u32(d, tfdt.start + 8) : u32(d, tfdt.start + 4)) : 0
              let offset = base
              for (const trun of children(d, traf.start, traf.end).filter(item => item.type === 'trun')) {
                const runFlags = u32(d, trun.start) & 0xffffff
                const count = u32(d, trun.start + 4)
                let r = trun.start + 8
                if (runFlags & 1) {
                  offset = base + (u32(d, r) | 0)
                  r += 4
                }
                if (runFlags & 4) r += 4
                for (let n = 0; n < count; n++) {
                  const duration = runFlags & 0x100 ? u32(d, r) : defaultDuration
                  if (runFlags & 0x100) r += 4
                  const size = runFlags & 0x200 ? u32(d, r) : defaultSize
                  if (runFlags & 0x200) r += 4
                  if (runFlags & 0x400) r += 4
                  const shift = runFlags & 0x800 ? (d[trun.start] === 1 ? u32(d, r) | 0 : u32(d, r)) : 0
                  if (runFlags & 0x800) r += 4
                  samples.push({ pts: dts + shift, offset, size })
                  dts += duration
                  offset += size
                }
              }
            }
          }
          parsed = top.end
        }
        cut = samples.findIndex(sample => past(sample.pts))
        enough = cut >= 0 && samples.slice(0, cut).every(sample => sample.offset + sample.size <= length)
      }
      for (const sample of cut >= 0 ? samples.slice(0, cut) : samples) {
        if (sample.offset + sample.size > length) break
        units.push({ pts: sample.pts, data: buffer.slice(sample.offset, sample.offset + sample.size) })
      }
    } else {
      // MPEG-TS: the H.264 stream's PES packets, one access unit each.
      const stamp = (d: Uint8Array, o: number) => (d[o]! & 0x0e) * 536870912 + d[o + 1]! * 4194304 + (d[o + 2]! >> 1) * 32768 + d[o + 3]! * 128 + (d[o + 4]! >> 1)
      let pmtPid = -1
      let videoPid = -1
      let rest = new Uint8Array(0)
      const parts: Uint8Array[][] = []
      while (!enough) {
        const chunk = await more()
        if (!chunk) break
        const d = new Uint8Array(rest.length + chunk.length)
        d.set(rest)
        d.set(chunk, rest.length)
        let i = 0
        for (; i + 188 <= d.length && !enough; i += 188) {
          if (d[i] !== 0x47) continue
          const pid = ((d[i + 1]! & 0x1f) << 8) | d[i + 2]!
          const first = (d[i + 1]! & 0x40) !== 0
          const control = (d[i + 3]! >> 4) & 3
          if (!(control & 1)) continue
          let p = i + 4 + (control & 2 ? 1 + d[i + 4]! : 0)
          if (pid === 0 && pmtPid < 0 && first) {
            p += 1 + d[p]!
            pmtPid = ((d[p + 10]! & 0x1f) << 8) | d[p + 11]!
          } else if (pid === pmtPid && videoPid < 0 && first) {
            p += 1 + d[p]!
            const sectionEnd = p + 3 + (((d[p + 1]! & 0x0f) << 8) | d[p + 2]!) - 4
            for (let q = p + 12 + (((d[p + 10]! & 0x0f) << 8) | d[p + 11]!); q < sectionEnd; q += 5 + (((d[q + 3]! & 0x0f) << 8) | d[q + 4]!)) {
              if (d[q] === 0x1b) {
                videoPid = ((d[q + 1]! & 0x1f) << 8) | d[q + 2]!
                break
              }
            }
          } else if (pid === videoPid) {
            if (first) {
              const pts = stamp(d, p + 9)
              if (past(pts)) {
                enough = true
                break
              }
              units.push({ pts, data: new Uint8Array(0) })
              parts.push([])
              p += 9 + d[p + 8]!
            }
            parts[parts.length - 1]?.push(d.slice(p, i + 188))
          }
        }
        rest = d.slice(i)
      }
      units.forEach((unit, n) => {
        unit.data = new Uint8Array(parts[n]!.reduce((total, part) => total + part.length, 0))
        let o = 0
        for (const part of parts[n]!) {
          unit.data.set(part, o)
          o += part.length
        }
      })
    }
    if (units.length === 0) return { error: 'no_video' }

    // The NAL unit types in an access unit: 5 is a keyframe slice, 7 the SPS that names a TS stream's codec.
    // TS units are Annex B (start codes); MP4 samples are length-prefixed.
    const nal = (au: Uint8Array, type: number): number => {
      if (track) {
        for (let k = 0; k + track.lengthSize < au.length;) {
          let size = 0
          for (let b = 0; b < track.lengthSize; b++) size = size * 256 + au[k + b]!
          if ((au[k + track.lengthSize]! & 0x1f) === type) return k + track.lengthSize + 1
          k += track.lengthSize + size
        }
        return -1
      }
      for (let k = 0; k + 3 < au.length; k++) if (au[k] === 0 && au[k + 1] === 0 && au[k + 2] === 1 && (au[k + 3]! & 0x1f) === type) return k + 4
      return -1
    }
    const firstPts = units[0]!.pts
    const keys = units.flatMap((unit, n) => (nal(unit.data, 5) >= 0 ? [n] : []))
    if (keys.length === 0) return { error: 'no_keyframe' }
    const from = keys.filter(n => units[n]!.pts <= target).pop() ?? keys[0]!
    const to = keys.find(n => n > from) ?? units.length
    let config = track?.config
    if (!config) {
      const sps = nal(units[from]!.data, 7)
      if (sps < 0) return { error: 'no_sps' }
      const hex = (n: number) => units[from]!.data[sps + n]!.toString(16).padStart(2, '0')
      // Profile, constraint flags and level: the SPS's first three bytes after its header.
      // Software decoding: the frames are small, and no GPU decoder is held.
      config = { codec: `avc1.${hex(0)}${hex(1)}${hex(2)}`, optimizeForLatency: true, hardwareAcceleration: 'prefer-software' }
    }
    if (!(await VideoDecoder.isConfigSupported(config)).supported) return { error: 'codec_unsupported' }

    // From the keyframe at or before the second; the frame nearest the second wins, and only it stays open.
    const micros = (pts: number) => Math.round(((pts - firstPts) * 1e6) / timescale)
    const wanted = micros(target)
    let best: VideoFrame | null = null
    let failed: string | null = null
    const decoder = new VideoDecoder({
      output: frame => {
        if (!best || Math.abs(frame.timestamp - wanted) < Math.abs(best.timestamp - wanted)) {
          best?.close()
          best = frame
        } else frame.close()
      },
      error: error => {
        failed = error.message
      },
    })
    decoder.configure(config)
    for (let n = from; n < to; n++) {
      decoder.decode(new EncodedVideoChunk({ type: n === from ? 'key' : 'delta', timestamp: micros(units[n]!.pts), data: units[n]!.data }))
    }
    await decoder.flush().catch(() => undefined)
    if (decoder.state !== 'closed') decoder.close()
    const frame = best as VideoFrame | null
    if (!frame) return { error: failed ?? 'no_frame' }
    const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
    canvas.getContext('2d')!.drawImage(frame, 0, 0)
    const shown = segment.start + frame.timestamp / 1e6
    frame.close()
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    return { image, width: canvas.width, height: canvas.height, at: Math.round(shown * 10) / 10 }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'failed' }
  }
}
