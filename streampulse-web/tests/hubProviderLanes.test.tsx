import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SpFrame } from '@streampulse/pulse-charts/spchart'
import type { HubActivityPoint } from '../src/lib/publicHub'
import {
  HubProviderLanes,
  buildProviderLanes,
  providerLaneName,
  providerLanePath,
} from '../src/ui/components/hub/HubProviderLanes'
import { buildHubActivitySpModel } from '../src/ui/components/hub/hubActivitySpModel'

const MIN = 60_000
const END = Date.UTC(2026, 9, 13, 18, 0, 0)

function points(more: (index: number) => Partial<HubActivityPoint> = () => ({})): HubActivityPoint[] {
  return Array.from({ length: 12 }, (_, index) => ({
    t: END - (11 - index) * 6 * MIN,
    chat: 600,
    emotes: 300 + index * 6,
    seventv: 120 + index * 6,
    viewers: 1_000,
    hasChatRollup: true,
    bucketComplete: true,
    ...more(index),
  }))
}

function fakeFrame(offset: number, scale: number) {
  const listeners = new Set<(frame: SpFrame) => void>()
  const frame = {
    range: { startIndex: 0, endIndex: 11 },
    scale,
    offset,
    moving: false,
    xOfIndex: (index: number) => offset + scale * index,
    xOfMs: () => 0,
    subscribe(cb: (f: SpFrame) => void) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return {
    frame: frame as unknown as SpFrame,
    move(nextOffset: number, nextScale: number) {
      Object.assign(frame, { offset: nextOffset, scale: nextScale })
      for (const listener of listeners) listener(frame as unknown as SpFrame)
    },
    listeners,
  }
}

describe('provider lanes', () => {
  it('names a lane with ≥ only when its counts are lower bounds', () => {
    expect(providerLaneName('7TV', false)).toBe('7TV')
    expect(providerLaneName('other', true)).toBe('≥ other')
  })

  it('draws one closed column per measured sample, in sample units, scaled to the lane max', () => {
    expect(providerLanePath([0, 2, Number.NaN, 4])).toBe('M0 19V18.5H1V19ZM1 19V10.5H2V19ZM3 19V2H4V19Z')
    expect(providerLanePath([Number.NaN, 0])).toBe('')
  })

  it('builds two lanes, 7TV and other (emotes − 7TV), neutral and unlabeled by colour', () => {
    const model = buildHubActivitySpModel(points(), 72, { bucketMinutes: 6 })!
    const lanes = buildProviderLanes(model)
    expect(lanes.map((lane) => lane.key)).toEqual(['sevenTv', 'other'])
    expect(lanes.map((lane) => lane.name)).toEqual(['7TV', 'other'])
    expect(lanes.every((lane) => lane.path.length > 0)).toBe(true)
  })

  it('follows the chart frame with one transform and no re-render', () => {
    const model = buildHubActivitySpModel(points((index) => (index === 3 ? { providerCountsLowerBound: true } : {})), 72, { bucketMinutes: 6 })!
    const live = fakeFrame(-20, 50)
    const getFrame = () => live.frame
    const { container } = render(<HubProviderLanes model={model} plotWidth={600} frame={getFrame} />)
    const group = container.querySelector('[data-hub-provider-lanes]')!
    expect(group.getAttribute('aria-label')).toBe('Emote uses by provider, per minute')
    const names = [...container.querySelectorAll('.lane .nm')].map((node) => node.textContent)
    expect(names).toEqual(['7TV', '≥ other'])
    const gs = container.querySelectorAll('.lane svg > g')
    expect(gs).toHaveLength(2)
    expect(gs[0]!.getAttribute('transform')).toBe('translate(-20 0) scale(50 1)')
    live.move(-40, 60)
    expect(gs[1]!.getAttribute('transform')).toBe('translate(-40 0) scale(60 1)')
    expect((container.querySelector('.lane svg') as SVGSVGElement).getAttribute('width')).toBe('600')
  })
})
