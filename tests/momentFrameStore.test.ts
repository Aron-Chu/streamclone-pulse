import { describe, expect, it } from 'vitest'
import { MomentFrameStore, nearestFrameIndex } from '../src/content/momentFrameStore.ts'

function setup(overrides: Partial<{ windowMs: number; maxKept: number }> = {}) {
  let now = 0
  const revoked: string[] = []
  const store = new MomentFrameStore({
    windowMs: overrides.windowMs ?? 60_000,
    maxKept: overrides.maxKept ?? 100,
    minGapSeconds: 3,
    revoke: url => { revoked.push(url) },
    now: () => now,
  })
  store.useStream('stream-1')
  return { store, revoked, tick: (ms: number) => { now += ms } }
}

/**
 * Moment pictures keep frames of what the tab played. They must stay small
 * (a rolling window), keep what a ranked moment needs, and never mix streams.
 */
describe('MomentFrameStore', () => {
  it('keeps frames sorted by stream offset whatever order they arrive in', () => {
    const { store } = setup()
    store.add(120, 'b')
    store.add(100, 'a')
    store.add(140, 'c')
    expect(store.inRange(0, 1_000).map(frame => frame.url)).toEqual(['a', 'b', 'c'])
    expect(store.inRange(110, 130).map(frame => frame.url)).toEqual(['b'])
  })

  it('skips a capture that lands on a frame it already has', () => {
    const { store } = setup()
    store.add(100, 'a')
    expect(store.has(102)).toBe(true)
    expect(store.has(98)).toBe(true)
    expect(store.has(104)).toBe(false)
  })

  it('drops and revokes frames older than the window unless a kept span covers them', () => {
    const { store, revoked, tick } = setup({ windowMs: 60_000 })
    store.add(100, 'kept')
    store.add(500, 'rolled')
    store.keep([[80, 200]])
    tick(61_000)
    store.add(600, 'new')
    expect(store.inRange(0, 1_000).map(frame => frame.url)).toEqual(['kept', 'new'])
    expect(revoked).toEqual(['rolled'])
  })

  it('holds a moment\'s frames after it drops out of the ranked lists for a poll', () => {
    // Live re-scoring reshuffles tied moments: 1:24:44 on xQc left the top 20
    // for one poll after the window and came back without its picture.
    const { store, revoked, tick } = setup({ windowMs: 60_000 })
    store.add(100, 'a')
    store.keep([[80, 200]])
    tick(61_000)
    store.keep([])
    store.add(500, 'b')
    expect(store.inRange(0, 1_000).map(frame => frame.url)).toEqual(['a', 'b'])
    store.keep([[80, 200]])
    expect(store.inRange(80, 200).map(frame => frame.url)).toEqual(['a'])
    expect(revoked).toEqual([])
  })

  it('at the cap, drops frames of moments no longer ranked before ranked ones', () => {
    const { store, revoked, tick } = setup({ maxKept: 2 })
    store.keep([[0, 150], [250, 400]])
    store.add(300, 'ranked-old')
    tick(1)
    store.add(100, 'dropped-out')
    store.keep([[250, 400]])
    tick(1)
    store.add(320, 'ranked-new')
    expect(store.inRange(0, 1_000).map(frame => frame.url)).toEqual(['ranked-old', 'ranked-new'])
    expect(revoked).toEqual(['dropped-out'])
  })

  it('forgets held moments when the stream changes', () => {
    const { store, tick } = setup({ windowMs: 60_000 })
    store.keep([[80, 200]])
    store.useStream('stream-2')
    store.add(100, 'other-stream')
    tick(61_000)
    store.add(500, 'new')
    expect(store.inRange(0, 1_000).map(frame => frame.url)).toEqual(['new'])
  })

  it('caps kept frames, dropping the oldest captures first', () => {
    const { store, revoked, tick } = setup({ maxKept: 2 })
    store.keep([[0, 1_000]])
    store.add(300, 'first')
    tick(1)
    store.add(100, 'second')
    tick(1)
    store.add(200, 'third')
    expect(store.inRange(0, 1_000).map(frame => frame.url)).toEqual(['second', 'third'])
    expect(revoked).toEqual(['first'])
  })

  it('drops every frame when the stream changes, and tells listeners', () => {
    const { store, revoked } = setup()
    let calls = 0
    store.subscribe(() => { calls++ })
    store.add(100, 'a')
    store.useStream('stream-1')
    expect(store.size).toBe(1)
    store.useStream('stream-2')
    expect(store.size).toBe(0)
    expect(revoked).toEqual(['a'])
    expect(calls).toBe(2)
  })

  it('finds the frame nearest an offset', () => {
    const frames = [100, 104, 120].map(offset => ({ offset, url: `${offset}`, at: 0 }))
    expect(nearestFrameIndex(frames, 103)).toBe(1)
    expect(nearestFrameIndex(frames, 500)).toBe(2)
    expect(nearestFrameIndex([], 5)).toBe(-1)
  })
})
