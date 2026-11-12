// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { vodFrameInPage } from '../src/background/vodFrameInject.ts'

const FPS = 30
const TICKS = 90_000 / FPS
const FIRST_PTS = 900_000
const SPS = [0x67, 0x42, 0xc0, 0x1e, 0xaa, 0xaa]

/** One H.264 access unit as Annex B NAL units: a keyframe carries the SPS, PPS and an IDR slice. */
function accessUnit(key: boolean): number[] {
  const nal = (bytes: number[]) => [0, 0, 0, 1, ...bytes]
  const slice = new Array<number>(400).fill(0xaa)
  return [...nal([0x09, 0xf0]), ...(key ? [...nal(SPS), ...nal([0x68, 0xce]), ...nal([0x65, ...slice])] : nal([0x41, ...slice]))]
}

/**
 * An MPEG-TS segment muxed as Twitch's are: a PAT, a PMT naming an audio and an
 * H.264 stream, then one PES per access unit, its last packet stuffed by an
 * adaptation field. A keyframe every `keyEvery` frames.
 */
function segment(frames: number, keyEvery: number): Uint8Array {
  const packets: number[][] = []
  const packet = (pid: number, start: boolean, payload: number[]) => {
    const head = [0x47, (start ? 0x40 : 0) | (pid >> 8), pid & 0xff]
    if (payload.length >= 184) return packets.push([...head, 0x10, ...payload.slice(0, 184)])
    const stuffing = 183 - payload.length
    packets.push([...head, 0x30, stuffing, ...(stuffing > 0 ? [0x00, ...new Array<number>(stuffing - 1).fill(0xff)] : []), ...payload])
  }
  const crc = [0, 0, 0, 0]
  packet(0, true, [0, 0x00, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0x00, ...crc])
  packet(0x1000, true, [0, 0x02, 0xb0, 23, 0, 1, 0xc1, 0, 0, 0xe1, 0x00, 0xf0, 0x00, 0x0f, 0xe1, 0x01, 0xf0, 0x00, 0x1b, 0xe1, 0x00, 0xf0, 0x00, ...crc])
  for (let n = 0; n < frames; n++) {
    const pts = FIRST_PTS + n * TICKS
    const stamp = [((pts / 2 ** 29) & 0x0e) | 0x21, (pts >> 22) & 0xff, ((pts >> 14) & 0xfe) | 1, (pts >> 7) & 0xff, ((pts << 1) & 0xfe) | 1]
    let pes = [0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5, ...stamp, ...accessUnit(n % keyEvery === 0)]
    for (let first = true; pes.length > 0; first = false) {
      packet(0x100, first, pes.slice(0, 184))
      pes = pes.slice(184)
    }
  }
  return new Uint8Array(packets.flat())
}

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const ascii = (text: string) => [...text].map(char => char.charCodeAt(0))
const mp4Box = (type: string, ...payload: number[][]) => {
  const body = payload.flat()
  return [...be32(8 + body.length), ...ascii(type), ...body]
}
const full = (version: number, flags: number) => [version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]
/** An AVCDecoderConfigurationRecord: Main profile, level 1.2, 4-byte NAL lengths, one SPS and one PPS. */
const AVCC = [1, 0x4d, 0x40, 0x0c, 0xff, 0xe1, 0, 4, 0x67, 0x4d, 0x40, 0x0c, 1, 0, 2, 0x68, 0xce]

/** A fragmented MP4 init segment as Twitch's: an audio track, then the H.264 one, with trex defaults. */
function mp4Init(): Uint8Array {
  const trak = (id: number, handler: string, timescale: number, entry: number[]) => mp4Box('trak',
    mp4Box('tkhd', full(0, 3), be32(0), be32(0), be32(id), new Array<number>(68).fill(0)),
    mp4Box('mdia',
      mp4Box('mdhd', full(0, 0), be32(0), be32(0), be32(timescale), be32(0), [0x55, 0xc4, 0, 0]),
      mp4Box('hdlr', full(0, 0), be32(0), ascii(handler), new Array<number>(13).fill(0)),
      mp4Box('minf', mp4Box('stbl', mp4Box('stsd', full(0, 0), be32(1), entry)))))
  return new Uint8Array([
    ...mp4Box('ftyp', ascii('iso6'), be32(0)),
    ...mp4Box('moov',
      trak(2, 'soun', 48_000, mp4Box('mp4a', new Array<number>(28).fill(0))),
      trak(1, 'vide', 90_000, mp4Box('avc1', new Array<number>(78).fill(0), mp4Box('avcC', AVCC))),
      mp4Box('mvex',
        mp4Box('trex', full(0, 0), be32(2), be32(1), be32(1024), be32(0), be32(0)),
        mp4Box('trex', full(0, 0), be32(1), be32(1), be32(TICKS), be32(0), be32(0)))),
  ])
}

/**
 * A fragmented MP4 media segment: an emsg, then moof + mdat fragments of
 * `perFragment` frames, each with an audio sample before the video ones.
 * Sample sizes come from trun, durations from trex.
 */
function mp4Segment(frames: number, keyEvery: number, perFragment: number): Uint8Array {
  const out = [...mp4Box('emsg', full(0, 0), new Array<number>(20).fill(0))]
  const audio = new Array<number>(10).fill(0x11)
  for (let first = 0; first < frames; first += perFragment) {
    const samples = Array.from({ length: Math.min(perFragment, frames - first) }, (_, k) => {
      const nal = [(first + k) % keyEvery === 0 ? 0x65 : 0x41, ...new Array<number>(400).fill(0xaa)]
      return [...be32(nal.length), ...nal]
    })
    const moof = (audioOffset: number, videoOffset: number) => mp4Box('moof',
      mp4Box('mfhd', full(0, 0), be32(first / perFragment + 1)),
      mp4Box('traf', mp4Box('tfhd', full(0, 0x20000), be32(2)), mp4Box('tfdt', full(1, 0), be32(0), be32(first * 1600)),
        mp4Box('trun', full(0, 0x201), be32(1), be32(audioOffset), be32(audio.length))),
      mp4Box('traf', mp4Box('tfhd', full(0, 0x20000), be32(1)), mp4Box('tfdt', full(1, 0), be32(0), be32(FIRST_PTS + first * TICKS)),
        mp4Box('trun', full(0, 0x201), be32(samples.length), be32(videoOffset), ...samples.map(sample => be32(sample.length)))))
    // Data offsets count from the moof's start; the mdat's payload follows the moof and its 8-byte header.
    const size = moof(0, 0).length
    out.push(...moof(size + 8, size + 8 + audio.length), ...mp4Box('mdat', audio, ...samples))
  }
  return new Uint8Array(out)
}

// The 160p BANDWIDTH is the TS fixture's own rate: 564 bytes a frame at 30 fps.
const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2"',
  'https://vod.example.ttvnw.net/abc/chunked/index-dvr.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=630000,RESOLUTION=640x360,CODECS="avc1.4D401E,mp4a.40.2"',
  'https://vod.example.ttvnw.net/abc/360p30/index-dvr.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=135000,RESOLUTION=284x160,CODECS="avc1.4D400C,mp4a.40.2"',
  'https://vod.example.ttvnw.net/abc/160p30/index-dvr.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2"',
  'https://vod.example.ttvnw.net/abc/audio_only/index-dvr.m3u8',
].join('\n')

function mediaPlaylist(segments: number, ended: boolean, mp4: boolean): string {
  return [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    ...(mp4 ? ['#EXT-X-MAP:URI="init-0.mp4"'] : []),
    ...Array.from({ length: segments }, (_, n) => [`#EXTINF:10.000,`, `${n}.${mp4 ? 'mp4' : 'ts'}`]).flat(),
    ...(ended ? ['#EXT-X-ENDLIST'] : []),
  ].join('\n')
}

/** Every URL fetched, and the Range of each segment read with the bytes it got. */
let fetched: string[] = []
let ranges: string[] = []
let pulled = 0

function twitch(options: { variants?: string; segments?: number; ended?: boolean; token?: boolean; mp4?: boolean; ignoreRange?: boolean } = {}) {
  const data = options.mp4 ? mp4Segment(10 * FPS, FPS / 2, FPS) : segment(10 * FPS, FPS / 2)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    fetched.push(url)
    if (url === 'https://gql.twitch.tv/gql') {
      return Response.json({ data: { videoPlaybackAccessToken: options.token === false ? null : { value: '{"vod_id":1}', signature: 'sig' } } })
    }
    if (url.startsWith('https://usher.ttvnw.net/')) return new Response(options.variants ?? MASTER)
    if (url.endsWith('index-dvr.m3u8')) return new Response(mediaPlaylist(options.segments ?? 6, options.ended ?? true, options.mp4 ?? false))
    if (url.endsWith('init-0.mp4')) return new Response(mp4Init())
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('Range') ?? '')
    if (!range || options.ignoreRange) return new Response(data)
    ranges.push(range[0])
    const start = Number(range[1])
    if (start >= data.length) return new Response(null, { status: 416 })
    const body = data.slice(start, Number(range[2]) + 1)
    pulled += body.length
    return new Response(body, { status: 206 })
  }))
  return data
}

/** A stand-in WebCodecs decoder: each chunk comes out as a frame with the chunk's timestamp. */
let configured: VideoDecoderConfig[] = []
let decoded: EncodedVideoChunk[] = []
let closedFrames = 0

beforeEach(() => {
  fetched = []
  ranges = []
  pulled = 0
  configured = []
  decoded = []
  closedFrames = 0
  class Decoder {
    state = 'unconfigured'
    constructor(private readonly init: VideoDecoderInit) {}
    static async isConfigSupported(config: VideoDecoderConfig) { return { supported: config.codec.startsWith('avc1.'), config } }
    configure(config: VideoDecoderConfig) { configured.push(config); this.state = 'configured' }
    decode(chunk: EncodedVideoChunk) { decoded.push(chunk) }
    async flush() {
      for (const chunk of decoded) {
        this.init.output({ timestamp: chunk.timestamp, displayWidth: 284, displayHeight: 160, close: () => { closedFrames++ } } as unknown as VideoFrame)
      }
    }
    close() { this.state = 'closed' }
  }
  vi.stubGlobal('VideoDecoder', Decoder)
  vi.stubGlobal('EncodedVideoChunk', class {
    constructor(init: EncodedVideoChunkInit) { Object.assign(this, init) }
  })
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return { drawImage: () => undefined } }
    async convertToBlob() { return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }) }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('vodFrameInPage', () => {
  it('reads the smallest rendition that is tall enough, and decodes the frame of the second from the keyframe before it', async () => {
    const data = twitch()
    // Second 20.6 is 0.6 s into the third 10 s segment: frame 18, after the keyframe at frame 15.
    const frame = await vodFrameInPage('2906185982', 20.6, 160)

    expect(frame).toEqual({ image: 'data:image/jpeg;base64,/9j/2Q==', width: 284, height: 160, at: 20.6 })
    expect(fetched.slice(1)).toEqual([
      expect.stringMatching(/^https:\/\/usher\.ttvnw\.net\/vod\/2906185982\.m3u8\?allow_source=true&nauth=.*&nauthsig=sig&player=twitchweb&p=\d+$/),
      'https://vod.example.ttvnw.net/abc/160p30/index-dvr.m3u8',
      'https://vod.example.ttvnw.net/abc/160p30/2.ts',
    ])
    // The SPS's profile, constraints and level name the codec; decoded in software.
    expect(configured).toEqual([{ codec: 'avc1.42c01e', optimizeForLatency: true, hardwareAcceleration: 'prefer-software' }])
    expect(decoded.map(chunk => chunk.type)).toEqual(['key', ...new Array<string>(14).fill('delta')])
    expect(decoded[0]!.timestamp).toBe(500_000)
    // Every frame but the one drawn is closed, and that one too once drawn.
    expect(closedFrames).toBe(15)
    // One Range read, to a second past the frame by the rendition's bit rate: 2.1 s at 16,875 bytes a second.
    expect(ranges).toEqual(['bytes=0-35437'])
    expect(pulled).toBeLessThan(data.length * 0.25)
  })

  it('reads on in growing steps when the bit rate undersells the segment, and copes with a server that ignores Range', async () => {
    twitch({ variants: MASTER.replace('BANDWIDTH=135000', 'BANDWIDTH=80000') })
    // 4.5 s in: the first step reaches 6 s at 10,000 bytes a second, which this segment's 16,920 outruns;
    // each step after is a quarter of what is read by then. Frame 151, past the second, starts at byte 85,540.
    expect(await vodFrameInPage('2906185989', 24.5, 160)).toMatchObject({ at: 24.5 })
    expect(ranges).toEqual(['bytes=0-59999', 'bytes=60000-74999', 'bytes=75000-93749'])
    expect(decoded.map(chunk => chunk.type)).toEqual(['key', ...new Array<string>(14).fill('delta')])

    twitch({ ignoreRange: true })
    expect(await vodFrameInPage('2906185990', 24.5, 160)).toMatchObject({ at: 24.5 })
    expect(fetched.filter(url => url.endsWith('.ts'))).toHaveLength(4)
  })

  it('reads a fragmented MP4 VOD the same way, after its init segment, which it reads once', async () => {
    const data = twitch({ mp4: true })
    const frame = await vodFrameInPage('2906185988', 20.6, 160)

    expect(frame).toEqual({ image: 'data:image/jpeg;base64,/9j/2Q==', width: 284, height: 160, at: 20.6 })
    expect(fetched.slice(3)).toEqual(['https://vod.example.ttvnw.net/abc/160p30/init-0.mp4', 'https://vod.example.ttvnw.net/abc/160p30/2.mp4'])
    // The init segment's avcC names the codec and goes to the decoder; its samples are the chunks.
    expect(configured).toEqual([{ codec: 'avc1.4d400c', description: new Uint8Array(AVCC), optimizeForLatency: true, hardwareAcceleration: 'prefer-software' }])
    expect(decoded.map(chunk => chunk.type)).toEqual(['key', ...new Array<string>(14).fill('delta')])
    expect(decoded.map(chunk => chunk.timestamp)).toEqual(Array.from({ length: 15 }, (_, n) => Math.round(((15 + n) * 1e6) / FPS)))
    expect([...(decoded[0]!.data as Uint8Array).slice(0, 5)]).toEqual([0, 0, 1, 0x91, 0x65])
    expect(ranges).toEqual(['bytes=0-35437'])
    expect(pulled).toBeLessThan(data.length * 0.4)

    await vodFrameInPage('2906185988', 41, 160)
    expect(fetched.filter(url => url.endsWith('init-0.mp4'))).toHaveLength(1)
  })

  it('asks for 360p for a card, and never reads a rendition taller than 480p', async () => {
    twitch()
    await vodFrameInPage('2906185983', 5, 360)
    expect(fetched).toContain('https://vod.example.ttvnw.net/abc/360p30/0.ts')

    twitch({ variants: MASTER.split('\n').slice(0, 3).join('\n') })
    expect(await vodFrameInPage('2906185984', 5, 160)).toEqual({ error: 'no_small_rendition' })
    expect(fetched.filter(url => url.endsWith('.ts'))).toEqual(['https://vod.example.ttvnw.net/abc/360p30/0.ts'])
  })

  it('reads a VOD Twitch is still recording, and says when the second is not recorded yet', async () => {
    twitch({ segments: 3, ended: false })
    expect(await vodFrameInPage('2906185985', 21, 160)).toMatchObject({ at: 21 })
    expect(await vodFrameInPage('2906185985', 3600, 160)).toEqual({ error: 'not_recorded_yet' })
    // A second past the recorded end reads the playlist again; one inside it does not.
    expect(fetched.filter(url => url.endsWith('index-dvr.m3u8'))).toHaveLength(2)
    await vodFrameInPage('2906185985', 12, 160)
    expect(fetched.filter(url => url.endsWith('index-dvr.m3u8'))).toHaveLength(2)
  })

  it('gives up without a playback token or WebCodecs', async () => {
    twitch({ token: false })
    expect(await vodFrameInPage('2906185986', 5, 160)).toEqual({ error: 'no_token' })
    vi.stubGlobal('VideoDecoder', undefined)
    expect(await vodFrameInPage('2906185987', 5, 160)).toEqual({ error: 'no_webcodecs' })
  })
})
