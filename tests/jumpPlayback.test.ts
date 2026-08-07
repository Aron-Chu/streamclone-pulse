import { describe, expect, it } from 'vitest'
import { confirmJumpSeek } from '../src/ui/confirmJumpSeek.ts'

class FakeVideo extends EventTarget {
  currentTime = 100
  duration = 3600
  paused = false
  readyState = 4
  networkState = 1
  seeking = false
  isConnected = true
}

class CountingVideo extends FakeVideo {
  activeListeners = 0

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.activeListeners += 1
    super.addEventListener(type, callback, options)
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    this.activeListeners = Math.max(0, this.activeListeners - 1)
    super.removeEventListener(type, callback, options)
  }
}

describe('confirmJumpSeek', () => {
  it('does not treat currentTime assignment as playback confirmation', async () => {
    const video = new FakeVideo()
    const result = await confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      timeoutMs: 250,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('timeout')
  })

  it('requires playback to advance after seeked before reporting success', async () => {
    const video = new FakeVideo()
    const pending = confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      timeoutMs: 500,
    })

    video.dispatchEvent(new Event('seeking'))
    video.dispatchEvent(new Event('seeked'))
    setTimeout(() => {
      video.currentTime = 100.5
      video.dispatchEvent(new Event('timeupdate'))
    }, 20)

    const result = await pending
    expect(result).toMatchObject({ ok: true, reason: 'played' })
    expect(result.events).toEqual(expect.arrayContaining(['seeked', 'timeupdate']))
    expect(result.progressSeconds).toBeGreaterThanOrEqual(0.35)
  })

  it('does not treat a clock still before the target as forward playback', async () => {
    const video = new FakeVideo()
    video.currentTime = 95
    const pending = confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      timeoutMs: 250,
    })
    video.dispatchEvent(new Event('seeked'))

    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('timeout')
  })

  it('allows a deliberately paused player to confirm a usable seeked frame', async () => {
    const video = new FakeVideo()
    video.paused = true
    const pending = confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      wasPaused: true,
      timeoutMs: 500,
    })
    video.dispatchEvent(new Event('seeked'))

    await expect(pending).resolves.toMatchObject({ ok: true, reason: 'paused_seeked' })
  })

  it('fails immediately on a media error and retains the event trace', async () => {
    const video = new FakeVideo()
    const pending = confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      timeoutMs: 500,
    })
    video.dispatchEvent(new Event('waiting'))
    video.dispatchEvent(new Event('error'))

    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('media_error')
    expect(result.events).toEqual(expect.arrayContaining(['waiting', 'error']))
  })

  it('reports a persistent post-seek stall separately from a generic timeout', async () => {
    const video = new FakeVideo()
    const pending = confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      timeoutMs: 2_000,
      stallGraceMs: 250,
    })
    video.dispatchEvent(new Event('seeked'))
    video.dispatchEvent(new Event('stalled'))

    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('stalled')
    expect(result.events).toContain('stalled')
  })

  it('rejects a seek that snaps back away from the target after seeked', async () => {
    const video = new FakeVideo()
    const pending = confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      timeoutMs: 300,
    })
    video.currentTime = 100
    video.dispatchEvent(new Event('seeked'))
    setTimeout(() => {
      video.currentTime = 20
      video.dispatchEvent(new Event('timeupdate'))
    }, 20)

    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('timeout')
  })

  it('removes every media listener after a failed attempt', async () => {
    const video = new CountingVideo()
    const pending = confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      timeoutMs: 500,
    })
    video.dispatchEvent(new Event('error'))

    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'media_error' })
    expect(video.activeListeners).toBe(0)
  })

  it('detects Twitch replacing the video element', async () => {
    const video = new FakeVideo()
    let current: FakeVideo | null = video
    const pending = confirmJumpSeek(video as unknown as HTMLVideoElement, 100, {
      baselineSeconds: 20,
      timeoutMs: 500,
      isCurrentVideo: () => current === video,
    })
    current = new FakeVideo()

    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'video_replaced' })
  })
})
