// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { SUPPORTER_BADGE_TENURES, SupporterBadge, supporterBadgeTenureForMonths } from '../src/ui/SupporterBadge.tsx'
import { PeakMark } from '../src/ui/PeakMark.tsx'
import {
  StreamPulseTitleBlock,
  streamPulseHeaderChrome,
  streamPulseHeaderChromeSidebar,
} from '../src/ui/StreamPulseTitleBlock.tsx'
import { finishStroke, PEAK_STROKE, supporterFinish, SUPPORTER_FINISH_IDS } from '../src/ui/supporterFinish.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  act(() => createRoot(host).render(node))
  return host
}

/** Every numeric pair in a path `d`, as viewBox coordinates. */
function coordinates(d: string): Array<[number, number]> {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const pairs: Array<[number, number]> = []
  // H segments carry a single x. Split on commands so a lone x is not paired
  // with the next segment's x and read as a y.
  let index = 0
  for (const segment of d.match(/[MLHQ][^MLHQ]*/g) ?? []) {
    const count = (segment.match(/-?\d+(?:\.\d+)?/g) ?? []).length
    if (segment[0] === 'H') {
      for (let k = 0; k < count; k += 1) pairs.push([numbers[index + k], 9])
    } else {
      for (let k = 0; k + 1 < count; k += 2) pairs.push([numbers[index + k], numbers[index + k + 1]])
    }
    index += count
  }
  return pairs
}

describe('supporter recognition', () => {
  it('uses stable, user-facing tenure IDs for the full recognition ladder', () => {
    expect(SUPPORTER_BADGE_TENURES).toEqual([
      { id: 'new', months: 0, label: 'New' },
      { id: '3m', months: 3, label: '3 months' },
      { id: '6m', months: 6, label: '6 months' },
      { id: '12m', months: 12, label: '12 months' },
      { id: '24m', months: 24, label: '24 months' },
    ])
  })

  it('maps support periods to the highest earned published milestone', () => {
    expect(supporterBadgeTenureForMonths(-1)).toBe('new')
    expect(supporterBadgeTenureForMonths(2)).toBe('new')
    expect(supporterBadgeTenureForMonths(3)).toBe('3m')
    expect(supporterBadgeTenureForMonths(11)).toBe('6m')
    expect(supporterBadgeTenureForMonths(18)).toBe('12m')
    expect(supporterBadgeTenureForMonths(24)).toBe('24m')
    expect(supporterBadgeTenureForMonths(Number.NaN)).toBe('new')
  })

  it('carries no background, so the header plate cannot detach from the panel', () => {
    // The finish is a line colour. A background here is what made the previous
    // treatment repaint the header against an unchanged #202024 body.
    for (const id of SUPPORTER_FINISH_IDS) {
      expect(typeof supporterFinish[id]).toBe('string')
      expect(supporterFinish[id]).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(finishStroke(null)).toBe(PEAK_STROKE)
    expect(finishStroke('etched')).toBe(supporterFinish.etched)
  })

  it('renders the badge at 18px across the supported tenure ladder', () => {
    const standard = render(<SupporterBadge />)
    const svg = standard.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('18')
    expect(svg.getAttribute('height')).toBe('18')
    expect(svg.getAttribute('viewBox')).toBe('0 0 18 18')
    expect(svg.getAttribute('data-supporter-badge')).toBe('new')
    // The first milestone is the minimal silhouette.
    expect(standard.querySelector('polygon')).not.toBeNull()

    for (const option of SUPPORTER_BADGE_TENURES) {
      const host = render(<SupporterBadge tenure={option.id} />)
      expect(host.querySelector('svg')!.getAttribute('data-supporter-badge')).toBe(option.id)
      expect(host.querySelectorAll('path').length).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps every milestone black with a bright distinct rim and a white pulse', () => {
    const colours = new Set<string | null>()
    for (const tenure of SUPPORTER_BADGE_TENURES.map(option => option.id)) {
      const host = render(<SupporterBadge tenure={tenure} />)
      const polygon = host.querySelector('polygon')!
      expect(polygon.getAttribute('fill')).toBe('#08080a')
      expect(polygon.getAttribute('stroke-width')).toBe('1.5')
      colours.add(polygon.getAttribute('stroke'))
      expect(host.querySelector('path:last-child')!.getAttribute('stroke')).toBe('#ffffff')
    }
    expect(colours.size).toBe(5)
  })

  it('keeps the 24-month silhouette inside its native footprint', () => {
    const host = render(<SupporterBadge tenure="24m" />)
    const polygon = host.querySelector('polygon')!
    for (const value of polygon.getAttribute('points')!.split(/[ ,]+/).map(Number)) {
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(17)
    }
  })

  it('keeps every badge stroke inside the 18x18 footprint', () => {
    for (const tenure of SUPPORTER_BADGE_TENURES.map(option => option.id)) {
      const host = render(<SupporterBadge tenure={tenure} />)
      for (const path of host.querySelectorAll('path')) {
        const width = Number(path.getAttribute('stroke-width'))
        const margin = width / 2
        for (const [x, y] of coordinates(path.getAttribute('d')!)) {
          expect(x - margin).toBeGreaterThanOrEqual(0)
          expect(x + margin).toBeLessThanOrEqual(18)
          expect(y - margin).toBeGreaterThanOrEqual(0)
          expect(y + margin).toBeLessThanOrEqual(18)
        }
      }
      // No glow: a filter or a second offset stroke would overflow the box that
      // Twitch reserves for a badge.
      expect(host.querySelector('filter')).toBeNull()
      expect(host.innerHTML).not.toContain('blur')
    }
  })

  it('uses equipped finishes on the rim without reducing pulse contrast', () => {
    const plain = render(<SupporterBadge />)
    expect(plain.querySelector('polygon')!.getAttribute('stroke')).toBe('#55f5c3')
    const halo = render(<SupporterBadge finish="halo" />)
    expect(halo.querySelector('polygon')!.getAttribute('stroke')).toBe(supporterFinish.halo)
    expect(halo.querySelector('svg')!.getAttribute('data-supporter-finish')).toBe('halo')
    for (const finish of SUPPORTER_FINISH_IDS) {
      for (const tenure of SUPPORTER_BADGE_TENURES) {
        const host = render(<SupporterBadge tenure={tenure.id} finish={finish} />)
        expect(host.querySelector('polygon')!.getAttribute('fill')).toBe('#08080a')
      }
    }
  })

  it('gives the header no fill and no bottom rule, in both placements', () => {
    // The panel is darker than #202024 and every card is darker still. A fill
    // here is what turned the header into a banner.
    for (const chrome of [streamPulseHeaderChrome, streamPulseHeaderChromeSidebar]) {
      expect(chrome.background).toBeUndefined()
      expect(chrome.backgroundColor).toBeUndefined()
      expect(chrome.borderBottom).toBeUndefined()
      expect(chrome.boxShadow).toBeUndefined()
      expect(chrome.borderTop).toBeUndefined()
    }
  })

  it('shows the mark only for a Supporter, and the status pill either way', () => {
    const free = render(<StreamPulseTitleBlock statusLabel="Live chart" statusTone="live" />)
    expect(free.querySelector('svg')).toBeNull()
    expect(free.querySelector('h2')!.textContent).toBe('Stream Pulse')
    expect(free.textContent).toContain('Live chart')

    const supporter = render(<StreamPulseTitleBlock finish="glass" statusLabel="Live chart" statusTone="live" />)
    expect(supporter.querySelector('svg')).not.toBeNull()
    expect(supporter.querySelector('path')!.getAttribute('stroke')).toBe(supporterFinish.glass)
  })

  it('draws the header mark on the same grid as the badge', () => {
    const host = render(<PeakMark size={14} stroke={supporterFinish.glass} />)
    const svg = host.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 18 18')
    expect(svg.getAttribute('width')).toBe('14')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const path = svg.querySelector('path')!
    expect(path.getAttribute('stroke')).toBe(supporterFinish.glass)
    const margin = Number(path.getAttribute('stroke-width')) / 2
    for (const [x, y] of coordinates(path.getAttribute('d')!)) {
      expect(x - margin).toBeGreaterThanOrEqual(0)
      expect(x + margin).toBeLessThanOrEqual(18)
      expect(y - margin).toBeGreaterThanOrEqual(0)
      expect(y + margin).toBeLessThanOrEqual(18)
    }
  })
})
