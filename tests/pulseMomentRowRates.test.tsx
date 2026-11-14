// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { PulseMomentRow } from '../src/ui/PulseMomentRow.tsx'
import { panelComponentCss } from '../src/ui/panelComponentStyles.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * A row's figures stay on one line. When they don't fit, the viewer figure
 * drops first, then the rate the reason doesn't name: a chat spike keeps
 * chat/min, any other reason keeps emotes/min.
 */
const point: LiveHeatPoint = {
  minuteTs: '2026-06-11T13:00:00.000Z',
  offsetSeconds: 3600,
  score: 95,
  estimated: false,
  reason: 'chat_spike',
  reasonLabel: 'Chat spike',
  chatCount: 1204,
  emoteCount: 340,
  viewerCount: 11300,
  topEmotes: [],
  collecting: false,
}

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  host = null
  root = null
})

function row(value: LiveHeatPoint) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<PulseMomentRow point={value} backendUrl="https://api.streampulse.stream" selected={false} onSelect={() => undefined} onHighlight={() => undefined} />))
  const counts = host.querySelector<HTMLElement>('.pulse-mr-counts')!
  return { counts, viewers: counts.firstElementChild!.textContent, rates: [...counts.querySelectorAll('.pulse-mr-rates > span')].map(span => span.textContent) }
}

describe('moment row figures', () => {
  it('names the reason on the figures, viewers apart from the rates', () => {
    const { counts, viewers, rates } = row(point)
    expect(counts.getAttribute('data-reason')).toBe('chat_spike')
    expect(viewers).toMatch(/ viewers$/)
    expect(rates).toHaveLength(2)
    expect(rates[0]).toMatch(/ chat\/min$/)
    expect(rates[1]).toBe('340 emotes/min')
  })

  it('keeps chat/min last to drop on a chat spike, emotes/min on any other reason', () => {
    const css = panelComponentCss()
    // Other reasons: the rates run reversed, so emotes/min is the one that stays.
    expect(css).toMatch(/\.pulse-mr-counts, \.pulse-mr-rates \{[^}]*flex-flow: row-reverse wrap;/)
    // A chat spike runs them forward, so chat/min stays.
    expect(css).toMatch(/\[data-reason='chat_spike'\] \.pulse-mr-rates \{[^}]*flex-direction: row;/)
    expect(row({ ...point, reason: 'emote_spike', reasonLabel: 'Emote spike' }).counts.getAttribute('data-reason')).toBe('emote_spike')
  })

  it('says it is counting while the minute collects, with no viewer figure', () => {
    const { viewers, counts } = row({ ...point, collecting: true })
    expect(viewers).toBe('')
    expect(counts.querySelector('.pulse-mr-rates')?.textContent).toBe('Counting this minute…')
  })
})
