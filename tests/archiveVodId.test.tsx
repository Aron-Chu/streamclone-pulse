// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import { useArchiveVodId } from '../src/ui/momentPicture.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const send = vi.mocked(sendBackgroundMessage)
const history = {
  type: 'PAST_VODS',
  items: [
    // The channel's latest VOD, from another stream: never taken.
    { streamId: 'stream-2', videoId: '2905060000', title: 'Later', analyticsStatus: 'ready' },
    { streamId: 'stream-1', videoId: '2905053845', title: 'This one', analyticsStatus: 'ready' },
  ],
}

describe('the VOD of an ended stream, from stream history', () => {
  let root: Root | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    globalThis.__pulseMomentFrames = undefined
    send.mockReset()
  })

  async function found(streamId: string | null, ask: boolean): Promise<string | null> {
    let vodId: string | null = null
    function Probe() {
      vodId = useArchiveVodId('test', streamId, ask)
      return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(<Probe />))
    return vodId
  }

  it('takes the VOD of the row whose stream id matches, never the latest', async () => {
    globalThis.__pulseMomentFrames = { start: vi.fn(), keep: vi.fn(), mount: vi.fn(), vod: vi.fn() } as never
    send.mockImplementation(async request => (request.type === 'LIST_PAST_VODS' ? history : { type: 'MOMENT_FRAMES_SCRIPT', ok: true }) as never)
    expect(await found('stream-1', true)).toBe('2905053845')
    expect(send).toHaveBeenCalledWith({ type: 'LIST_PAST_VODS', login: 'test', liveStreamId: 'stream-1', isLive: false })
    act(() => root?.unmount())
    expect(await found('stream-3', true)).toBeNull()
  })

  it('asks nothing with Moment pictures off, or where the payload names its VOD', async () => {
    send.mockResolvedValue({ type: 'MOMENT_FRAMES_SCRIPT', ok: false } as never)
    expect(await found('stream-1', true)).toBeNull()
    globalThis.__pulseMomentFrames = { start: vi.fn(), keep: vi.fn(), mount: vi.fn(), vod: vi.fn() } as never
    act(() => root?.unmount())
    expect(await found('stream-1', false)).toBeNull()
    expect(send.mock.calls.map(([request]) => request.type)).not.toContain('LIST_PAST_VODS')
  })
})
