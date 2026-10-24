import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { MAX_PLOTTED_EMOTES } from '@streampulse/pulse-charts'
import type { AnalyticsTopEmote } from '../../apiTypes.ts'
import { PlotOnChartStrip } from './PlotOnChartStrip.tsx'

afterEach(() => cleanup())

const EMOTES = ['KEKW', 'LUL', 'Pog', 'OMEGALUL', 'monkaS', 'Kappa', 'xdx'].map(
  (name, index) => ({ key: name, name, count: 1000 - index * 100, provider: 'twitch' }) as unknown as AnalyticsTopEmote,
)

function Harness({ initial = [] as string[], topEmotes = EMOTES }: { initial?: string[]; topEmotes?: AnalyticsTopEmote[] }) {
  const [plotted, setPlotted] = useState<string[]>(initial)
  return (
    <div data-testid="plotted" data-keys={plotted.join(',')}>
      <PlotOnChartStrip
        topEmotes={topEmotes}
        plottedKeys={plotted}
        onToggleEmote={key => setPlotted(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))}
        onClear={() => setPlotted([])}
        onReset={() => setPlotted(['KEKW'])}
      />
    </div>
  )
}

const keys = () => screen.getByTestId('plotted').getAttribute('data-keys')
const manage = () => screen.getByRole('button', { name: /^Emote overlays/ })
const chip = (container: HTMLElement, key: string) =>
  container.querySelector<HTMLButtonElement>(`[data-chart-overlay-chip="${key}"]`)!

describe('PlotOnChartStrip (Emote overlays under the session chart)', () => {
  it('opens a wide panel of the top emotes from a bar that shows the plotted ones', () => {
    const { container } = render(<Harness initial={['Pog']} />)
    expect(manage().getAttribute('aria-expanded')).toBe('false')
    expect(manage().textContent).toContain('1 active')
    expect([...container.querySelectorAll('[data-chart-overlay-plotted]')].map(e => e.getAttribute('data-chart-overlay-plotted'))).toEqual(['Pog'])
    expect(container.querySelector('[data-chart-overlay-chip]')).toBeNull()

    fireEvent.click(manage())
    expect(manage().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[data-chart-overlay-chip]')).toHaveLength(EMOTES.length)
    expect(chip(container, 'Pog').getAttribute('aria-pressed')).toBe('true')
    expect(chip(container, 'LUL').getAttribute('aria-pressed')).toBe('false')
    // The wheel zooms the chart over the bar and scrolls over the open panel.
    expect(container.querySelector('[data-chart-overlay-selector]')!.hasAttribute('data-chart-wheel-exempt')).toBe(false)
    expect(document.getElementById(manage().getAttribute('aria-controls')!)!.hasAttribute('data-chart-wheel-exempt')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Plot LUL on chart' }))
    expect(keys()).toBe('Pog,LUL')
    fireEvent.click(screen.getByRole('button', { name: 'Unplot Pog on chart' }))
    expect(keys()).toBe('LUL')
  })

  it('caps the plotted emotes at six: the other chips disable until one is unplotted', () => {
    expect(MAX_PLOTTED_EMOTES).toBe(6)
    const { container } = render(<Harness initial={['KEKW', 'LUL', 'Pog', 'OMEGALUL', 'monkaS']} />)
    fireEvent.click(manage())
    expect(chip(container, 'xdx').disabled).toBe(false)
    fireEvent.click(chip(container, 'Kappa'))
    expect(keys()).toBe('KEKW,LUL,Pog,OMEGALUL,monkaS,Kappa')
    expect(chip(container, 'xdx').disabled).toBe(true)
    expect(chip(container, 'xdx').title).toBe('Max 6 emotes on chart')
    expect(chip(container, 'KEKW').disabled).toBe(false)
    fireEvent.click(chip(container, 'KEKW'))
    expect(chip(container, 'xdx').disabled).toBe(false)
  })

  it('clears every lane and restores the defaults', () => {
    render(<Harness initial={['Pog', 'LUL']} />)
    fireEvent.click(manage())
    fireEvent.click(screen.getByRole('button', { name: 'Clear emote lanes' }))
    expect(keys()).toBe('')
    expect(screen.getByRole('button', { name: 'Clear emote lanes' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Restore default emote lanes' }))
    expect(keys()).toBe('KEKW')
  })

  it('matches a rollup key to its summary emote by provider and name, as the chart does', () => {
    const topEmotes = [
      { key: 'seventv:9ceb7717:LOL', name: 'LOL', count: 900, provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/x/4x.webp' },
      { key: 'seventv:328172f0:LO', name: 'LO', count: 800, provider: 'seventv' },
    ] as unknown as AnalyticsTopEmote[]
    const { container } = render(<Harness initial={['seventv:LOL:LOL']} topEmotes={topEmotes} />)
    expect(container.querySelector('[data-chart-overlay-plotted="seventv:LOL:LOL"]')!.getAttribute('title')).toBe('LOL')
    fireEvent.click(manage())
    expect(chip(container, 'seventv:9ceb7717:LOL').getAttribute('aria-pressed')).toBe('true')
    expect(chip(container, 'seventv:328172f0:LO').getAttribute('aria-pressed')).toBe('false')
    // Unplotting removes the plotted (rollup) key, not a second copy of the summary key.
    fireEvent.click(chip(container, 'seventv:9ceb7717:LOL'))
    expect(keys()).toBe('')
    fireEvent.click(chip(container, 'seventv:9ceb7717:LOL'))
    expect(keys()).toBe('seventv:9ceb7717:LOL')
  })

  it('keeps a 7TV and a BTTV emote with the same name as two chips that toggle apart', () => {
    const topEmotes = [
      { key: 'seventv:62a3bf57:Clap', name: 'Clap', count: 900, provider: 'seventv' },
      { key: 'bttv:55b6f480:Clap', name: 'Clap', count: 700, provider: 'bttv' },
    ] as unknown as AnalyticsTopEmote[]
    const { container } = render(<Harness initial={['bttv:Clap:Clap']} topEmotes={topEmotes} />)
    fireEvent.click(manage())
    const seventv = () => chip(container, 'seventv:62a3bf57:Clap')
    const bttv = () => chip(container, 'bttv:55b6f480:Clap')
    expect(seventv().getAttribute('aria-pressed')).toBe('false')
    expect(bttv().getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(seventv())
    expect(keys()).toBe('bttv:Clap:Clap,seventv:62a3bf57:Clap')
    expect(container.querySelectorAll('[data-chart-overlay-plotted]')).toHaveLength(2)
    fireEvent.click(bttv())
    expect(keys()).toBe('seventv:62a3bf57:Clap')
    expect(seventv().getAttribute('aria-pressed')).toBe('true')
    expect(bttv().getAttribute('aria-pressed')).toBe('false')
  })

  it('renders nothing without top emotes or the lane buttons', () => {
    const { container } = render(<PlotOnChartStrip topEmotes={[]} plottedKeys={[]} onToggleEmote={() => {}} />)
    expect(container.querySelector('[data-chart-overlay-selector]')).toBeNull()
  })
})
