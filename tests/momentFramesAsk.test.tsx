// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import { MOMENT_FRAMES_READY_EVENT, type MomentFramesApi } from '../src/shared/momentFramesContract.ts'
import { MOMENT_PICTURES_KEY } from '../src/shared/storage.ts'

vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
const send = vi.mocked(sendBackgroundMessage)
let hooks: typeof import('../src/ui/momentPicture.ts')
let listeners: Set<StorageListener>
let root: Root
let container: HTMLDivElement
const video = () => null

function Slot() {
  const ref = hooks.useMomentPicture<HTMLDivElement>({ kind: 'card', from: 30, to: 120, peak: 60 })
  return <div ref={ref} />
}

function Capture() {
  hooks.useMomentCapture({ key: 'stream-1', live: false, vod: true }, [60], video)
  return null
}

async function change(on: boolean | undefined, oldValue = !on, area = 'sync', key = MOMENT_PICTURES_KEY) {
  await act(async () => {
    for (const listener of [...listeners]) listener({ [key]: { oldValue, newValue: on } }, area)
  })
}

beforeEach(async () => {
  vi.resetModules()
  hooks = await import('../src/ui/momentPicture.ts')
  listeners = new Set()
  vi.stubGlobal('chrome', { storage: { onChanged: {
    addListener: (listener: StorageListener) => listeners.add(listener),
    removeListener: (listener: StorageListener) => listeners.delete(listener),
  } } })
  send.mockReset()
  send.mockResolvedValue({ type: 'MOMENT_FRAMES_SCRIPT', ok: false })
  globalThis.__pulseMomentFrames = undefined
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  globalThis.__pulseMomentFrames = undefined
  vi.unstubAllGlobals()
})

describe('asking for Moment pictures after enabling them', () => {
  it('asks once while off, retries once on enable, and fills mounted slots on ready', async () => {
    await act(async () => root.render(<><Capture /><Slot /><Slot /></>))
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'MOMENT_FRAMES_SCRIPT' })

    await change(false, true)
    expect(send).toHaveBeenCalledTimes(1)
    await change(true)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.every(([request]) => request.type === 'MOMENT_FRAMES_SCRIPT')).toBe(true)

    const frames: MomentFramesApi = {
      start: vi.fn(() => vi.fn()), keep: vi.fn(), vod: vi.fn(async () => null),
      mount: vi.fn(element => {
        element.textContent = 'picture'
        return () => { element.textContent = '' }
      }),
    }
    await act(async () => {
      globalThis.__pulseMomentFrames = frames
      dispatchEvent(new Event(MOMENT_FRAMES_READY_EVENT))
    })
    expect(container.textContent).toBe('picturepicture')
    expect(frames.mount).toHaveBeenCalledTimes(2)
    expect(frames.start).toHaveBeenCalledTimes(1)
    expect(frames.keep).toHaveBeenCalledWith([[30, 150]])
    expect(listeners.size).toBe(0)

    await change(false)
    await change(true)
    await act(async () => root.render(<><Capture /><Slot /><Slot /><Slot /></>))
    expect(send).toHaveBeenCalledTimes(2)
    expect(frames.mount).toHaveBeenCalledTimes(3)
  })

  it('ignores unrelated, local and unchanged settings; only retries while a slot waits', async () => {
    await change(true)
    expect(send).not.toHaveBeenCalled()
    await act(async () => root.render(<><Slot key="one" /><Slot key="two" /></>))
    expect(listeners.size).toBe(1)
    await change(true, false, 'local')
    await change(true, false, 'sync', 'autoUpdateEnabled')
    await change(true, true)
    await change(false)
    expect(send).toHaveBeenCalledTimes(1)

    await act(async () => root.render(<Slot key="one" />))
    await change(true)
    expect(send).toHaveBeenCalledTimes(2)
    await change(false)
    await change(undefined, false)
    expect(send).toHaveBeenCalledTimes(3)
    await act(async () => root.render(null))
    expect(listeners.size).toBe(0)
    await change(false)
    await change(true)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('can retry a rejected request on the next enable without an automatic loop', async () => {
    send.mockRejectedValueOnce(new Error('worker unavailable'))
    await act(async () => root.render(<Slot />))
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<Slot />))
    expect(send).toHaveBeenCalledTimes(1)
    await change(true)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not ask for a script already present before mounting', async () => {
    globalThis.__pulseMomentFrames = {
      start: vi.fn(), keep: vi.fn(), mount: vi.fn(), vod: vi.fn(),
    } as never
    await act(async () => root.render(<Slot />))
    await change(false)
    await change(true)
    expect(send).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })

  it('mounts a picture again when the stream’s timing correction changes', async () => {
    const deltas: Array<number | undefined> = []
    const unmount = vi.fn()
    const frames: MomentFramesApi = {
      start: vi.fn(() => vi.fn()), keep: vi.fn(), vod: vi.fn(async () => null),
      mount: vi.fn((_element, _view, at) => {
        deltas.push(at?.vodOriginDeltaSeconds)
        return unmount
      }),
    }
    globalThis.__pulseMomentFrames = frames
    function Timed({ delta }: { delta: number }) {
      hooks.useMomentCapture({ key: 'stream-1', live: false, vod: true, vodOriginDeltaSeconds: delta }, [60], video)
      return null
    }
    await act(async () => root.render(<><Timed delta={0} /><Slot /></>))
    await act(async () => root.render(<><Timed delta={12} /><Slot /></>))
    expect(deltas).toEqual([0, 12])
    expect(unmount).toHaveBeenCalledTimes(1)
  })
})
